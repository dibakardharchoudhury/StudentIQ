import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Camera, Mesh, MeshStandardMaterial, Scene } from 'three';
import Teacher from './Teacher';
import { defaultAvatar } from './avatar-style';

const state = vi.hoisted(() => ({
  unavailable: true,
  renderFails: false,
  reduced: false,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  renderers: [] as {
    domElement: HTMLCanvasElement;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
  }[],
  disconnects: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      render = vi.fn((_scene: Scene, _camera: Camera) => {
        if (state.renderFails) throw new Error('Rendering failed');
      });
      dispose = vi.fn();
      setSize = vi.fn();
      setPixelRatio = vi.fn();
      constructor() {
        if (state.unavailable) throw new Error('WebGL unavailable');
        state.renderers.push(this);
      }
    },
  };
});

beforeAll(async () => { await import('three'); });

beforeEach(() => {
  state.unavailable = true;
  state.renderFails = false;
  state.reduced = false;
  state.frames.clear();
  state.renderers.length = 0;
  state.disconnects.length = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = ++state.nextFrame;
    state.frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => state.frames.delete(id)));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return state.reduced; } })));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor() { state.disconnects.push(this.disconnect); }
  });
  document.documentElement.style.setProperty('--cp-accent', '#b11f4b');
  document.documentElement.style.setProperty('--cp-warning', '#ffc857');
  document.documentElement.style.setProperty('--cp-success', '#42a88a');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

function tick(time: number) {
  act(() => {
    const callbacks = [...state.frames.values()];
    state.frames.clear();
    callbacks.forEach(callback => callback(time));
  });
}

it('shows the human fallback immediately, before the asynchronous renderer can load', () => {
  const { container, unmount } = render(<Teacher speaking={false} label="Ready to learn" />);
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  expect(container.querySelector('.teacher-canvas')).toHaveAttribute('hidden');
  expect(state.renderers).toHaveLength(0);
  unmount();
});

it('updates the live renderer and illustrated fallback together when the child changes style', async () => {
  state.unavailable = false;
  const view = render(<Teacher speaking={false} label="Learning companion" />);
  await waitFor(() => expect(state.renderers).toHaveLength(1));
  const previous = state.renderers[0];
  view.rerender(<Teacher speaking={false} label="Learning companion"
    customization={{ ...defaultAvatar, shirt: 'blue', hair: 'purple', hairLength: 'short', glasses: true }} />);
  await waitFor(() => expect(state.renderers).toHaveLength(2));
  expect(previous.dispose).toHaveBeenCalledOnce();
  const scene = state.renderers[1].render.mock.calls[0][0] as Scene;
  const teacher = scene.children.find(child => child.type === 'Group')!;
  const cardigan = teacher.children[0] as Mesh;
  const color = (cardigan.material as MeshStandardMaterial).color;
  expect(color.b).toBeGreaterThan(color.r);
  act(() => state.renderers[1].domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  expect(view.container.querySelector('.teacher-fallback svg g[fill="#386eb0"]')).toBeInTheDocument();
  expect(view.container.querySelector('.teacher-fallback svg g[fill="#7352bc"]')).toBeInTheDocument();
  expect(view.container.querySelectorAll('.teacher-fallback svg g[fill="none"] circle')).toHaveLength(2);
});

it('shows a human illustration with an accessible label when WebGL is unavailable', async () => {
  const { container } = render(<Teacher speaking={false} label="Your learning companion" />);
  expect(screen.getByRole('img', { name: 'Your learning companion' })).toBeInTheDocument();
  await act(async () => {});
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  expect(container.querySelector('.teacher-canvas')).toHaveAttribute('hidden');
  expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false');
  expect(container.querySelector('.teacher-fallback')).toHaveAttribute('aria-hidden', 'true');
});

it('keeps fallback appearance, expression and speech responsive to preferences', async () => {
  const { container, rerender } = render(<Teacher speaking={false} label="Hello" appearance="mint" mood="calm" />);
  await act(async () => {});
  const drawing = () => container.querySelector('svg')!;
  const calm = drawing().innerHTML;
  expect(calm).toContain('var(--cp-success)');
  rerender(<Teacher speaking={false} label="Hello" appearance="sunny" mood="cheerful" />);
  expect(drawing().innerHTML).toContain('var(--cp-warning)');
  expect(drawing().innerHTML).not.toEqual(calm);
  const cheerful = drawing().innerHTML;
  rerender(<Teacher speaking label="Speaking" appearance="rose" mood="gentle" />);
  expect(drawing().innerHTML).toContain('var(--cp-accent)');
  expect(drawing().innerHTML).not.toEqual(cheerful);
  expect(screen.getByRole('img', { name: 'Speaking' })).toBeInTheDocument();
  await act(async () => {});
});

it('replaces the fallback only after a frame, and restores it throughout context loss', async () => {
  state.unavailable = false;
  const { container, unmount } = render(<Teacher speaking={false} label="Hello" />);
  await waitFor(() => expect(container.querySelector('canvas')).toBeInTheDocument());
  const renderer = state.renderers[0];
  expect(renderer.render).toHaveBeenCalled();
  expect(container.querySelector('.teacher-fallback')).not.toBeInTheDocument();
  expect(container.querySelector('.teacher-canvas')).not.toHaveAttribute('hidden');
  expect(renderer.domElement).toHaveAttribute('aria-hidden', 'true');
  const loss = new Event('webglcontextlost', { cancelable: true });
  act(() => { renderer.domElement.dispatchEvent(loss); });
  expect(loss.defaultPrevented).toBe(true);
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  expect(container.querySelector('.teacher-canvas')).toHaveAttribute('hidden');
  expect(state.frames.size).toBe(0);
  const renders = renderer.render.mock.calls.length;
  tick(1000);
  expect(renderer.render).toHaveBeenCalledTimes(renders);
  act(() => { renderer.domElement.dispatchEvent(new Event('webglcontextrestored')); });
  expect(renderer.render).toHaveBeenCalledTimes(renders + 1);
  expect(container.querySelector('.teacher-fallback')).not.toBeInTheDocument();
  expect(state.frames.size).toBe(1);

  const scene = renderer.render.mock.calls[0][0] as Scene;
  const resources = new Set<{ dispose(): void }>();
  scene.traverse(object => {
    if ('geometry' in object) resources.add(object.geometry as { dispose(): void });
    if ('material' in object) resources.add(object.material as { dispose(): void });
  });
  const disposal = [...resources].map(resource => vi.spyOn(resource, 'dispose'));
  unmount();
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.domElement.isConnected).toBe(false);
  expect(state.frames.size).toBe(0);
  disposal.forEach(spy => expect(spy).toHaveBeenCalledOnce());
  state.disconnects.forEach(spy => expect(spy).toHaveBeenCalledOnce());
  act(() => { renderer.domElement.dispatchEvent(new Event('webglcontextrestored')); });
  expect(state.frames.size).toBe(0);
});

it('does not hide the fallback if a restored context still cannot render', async () => {
  state.unavailable = false;
  const { container } = render(<Teacher speaking={false} label="Hello" />);
  await waitFor(() => expect(container.querySelector('.teacher-fallback')).not.toBeInTheDocument());
  const renderer = state.renderers[0];
  act(() => { renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
  state.renderFails = true;
  act(() => { renderer.domElement.dispatchEvent(new Event('webglcontextrestored')); });
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  expect(state.frames.size).toBe(0);
});

it('updates the 3D cardigan when theme tokens change without rebuilding the portrait', async () => {
  state.unavailable = false;
  const { container, unmount } = render(<Teacher speaking={false} label="Hello" />);
  await waitFor(() => expect(container.querySelector('.teacher-fallback')).not.toBeInTheDocument());
  const renderer = state.renderers[0];
  const scene = renderer.render.mock.calls[0][0] as Scene;
  const teacher = scene.children.find(object => object.type === 'Group')!;
  const cardigan = (teacher.children[0] as Mesh).material as MeshStandardMaterial;
  const previous = cardigan.color.clone();
  await act(async () => {
    document.documentElement.style.setProperty('--cp-accent', '#f4a1bf');
    document.documentElement.dataset.theme = 'dark';
  });
  expect(cardigan.color.equals(previous)).toBe(false);
  expect(state.renderers).toHaveLength(1);
  unmount();
  const finalColor = cardigan.color.clone();
  await act(async () => {
    document.documentElement.style.setProperty('--cp-accent', '#b11f4b');
    document.documentElement.dataset.theme = 'light';
  });
  expect(cardigan.color.equals(finalColor)).toBe(true);
});

it('keeps a still portrait with reduced motion and disposes the previous customization', async () => {
  state.unavailable = false;
  state.reduced = true;
  const { container, rerender } = render(<Teacher speaking label="Hello" />);
  await waitFor(() => expect(container.querySelector('.teacher-fallback')).not.toBeInTheDocument());
  const renderer = state.renderers[0];
  const scene = renderer.render.mock.calls[0][0] as Scene;
  const positions = () => {
    const transforms: number[][] = [];
    scene.traverse(object => transforms.push([...object.position.toArray(), ...object.scale.toArray()]));
    return transforms;
  };
  const still = positions();
  tick(4580);
  expect(positions()).toEqual(still);
  state.reduced = false;
  tick(1000);
  expect(positions()).not.toEqual(still);
  const renders = renderer.render.mock.calls.length;
  vi.spyOn(document, 'hidden', 'get').mockReturnValueOnce(true);
  tick(2000);
  expect(renderer.render).toHaveBeenCalledTimes(renders);
  rerender(<Teacher speaking={false} label="Hello" appearance="mint" mood="cheerful" />);
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  await waitFor(() => expect(state.renderers).toHaveLength(2));
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.domElement.isConnected).toBe(false);
  expect(state.frames.size).toBe(1);
});

it('cleans up a renderer whose initial frame fails and retains the human illustration', async () => {
  state.unavailable = false;
  state.renderFails = true;
  const { container } = render(<Teacher speaking={false} label="Hello" />);
  await waitFor(() => expect(state.renderers[0]?.dispose).toHaveBeenCalledOnce());
  expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument();
  expect(container.querySelector('canvas')).not.toBeInTheDocument();
});

it('does not create a renderer after an early unmount', async () => {
  state.unavailable = false;
  const { unmount } = render(<Teacher speaking={false} label="Hello" />);
  unmount();
  await act(async () => {});
  expect(state.renderers).toHaveLength(0);
  expect(state.frames.size).toBe(0);
});

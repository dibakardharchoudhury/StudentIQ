import { useEffect, useRef, useState } from 'react';
import type { Material } from 'three';
import type { Preferences } from './api';

export default function Teacher({ speaking, label, appearance = 'rose', mood = 'gentle' }: {
  speaking: boolean; label: string; appearance?: Preferences['appearance']; mood?: Preferences['mood'];
}) {
  const host = useRef<HTMLDivElement>(null);
  const talking = useRef(speaking);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { talking.current = speaking; }, [speaking]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('three').then(THREE => {
      if (disposed || !host.current) return;
      const container = host.current;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch { setUnavailable(true); return; }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
      camera.position.set(0, .35, 6);
      camera.lookAt(0, .2, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      const css = () => getComputedStyle(document.documentElement);
      const color = (name: string) => css().getPropertyValue(name).trim();
      const appearanceColor = () => color(appearance === 'sunny' ? '--cp-warning' : appearance === 'mint' ? '--cp-success' : '--cp-accent');
      const face = new THREE.MeshStandardMaterial({ color: color('--cp-surface'), roughness: .8 });
      const rose = new THREE.MeshStandardMaterial({ color: appearanceColor(), roughness: .7 });
      const ink = new THREE.MeshBasicMaterial({ color: color('--cp-text') });
      const light = new THREE.HemisphereLight(color('--cp-surface'), color('--cp-text-muted'), 2.4);
      scene.add(light);
      const key = new THREE.DirectionalLight(color('--cp-surface'), 2.4);
      key.position.set(3, 5, 6);
      scene.add(key);
      const teacher = new THREE.Group();
      scene.add(teacher);
      const ball = new THREE.SphereGeometry(1, 32, 24);
      const part = (material: Material, scale: number[], position: number[], parent = teacher) => {
        const mesh = new THREE.Mesh(ball, material);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.position.set(position[0], position[1], position[2]);
        parent.add(mesh);
        return mesh;
      };
      part(rose, [.66, .7, .4], [0, -.62, 0]);
      part(face, [.22, .22, .22], [-.81, -.48, .1]);
      part(face, [.22, .22, .22], [.81, -.48, .1]);
      const head = new THREE.Group();
      head.position.set(0, .66, 0);
      teacher.add(head);
      part(face, [.83, .77, .59], [0, 0, 0], head);
      part(rose, [.88, .18, .63], [0, .6, -.02], head);
      part(rose, [.13, .13, .13], [0, .91, 0], head);
      const left = part(ink, [.075, .11, .045], [-.28, .05, .57], head);
      const right = part(ink, [.075, .11, .045], [.28, .05, .57], head);
      const leftGlint = part(face, [.022, .025, .02], [-.30, .09, .615], head);
      const rightGlint = part(face, [.022, .025, .02], [.26, .09, .615], head);
      part(rose, [.105, .045, .025], [-.49, -.15, .49], head);
      part(rose, [.105, .045, .025], [.49, -.15, .49], head);
      const mouth = part(ink, [.17, .035, .035], [0, -.27, .57], head);
      const smileGeometry = new THREE.TorusGeometry(.14, .022, 8, 24, Math.PI);
      const smile = new THREE.Mesh(smileGeometry, ink);
      smile.rotation.z = Math.PI;
      smile.position.set(0, -.20, .58);
      head.add(smile);
      const badge = part(face, [.16, .16, .06], [0, -.48, .4]);
      badge.rotation.z = Math.PI / 4;
      // The teacher looks at the virtual camera; no device camera is accessed.
      head.lookAt(camera.position);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      const resize = new ResizeObserver(() => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      resize.observe(container);
      const observer = new MutationObserver(() => {
        face.color.set(color('--cp-surface'));
        rose.color.set(appearanceColor());
        ink.color.set(color('--cp-text'));
        light.color.set(color('--cp-surface'));
        key.color.set(color('--cp-surface'));
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      let frame = 0;
      const animate = (time: number) => {
        frame = requestAnimationFrame(animate);
        if (document.hidden) return;
        const seconds = time / 1000;
        const blink = !reduced.matches && seconds % 4.7 > 4.52 ? .12 : 1;
        left.scale.y = right.scale.y = .11 * blink;
        leftGlint.scale.y = rightGlint.scale.y = .025 * blink;
        mouth.scale.y = talking.current && !reduced.matches ? .07 + Math.abs(Math.sin(seconds * 12)) * .09 : .035;
        smile.visible = mood !== 'calm' && !talking.current;
        mouth.visible = !smile.visible;
        teacher.position.y = reduced.matches ? 0 : Math.sin(seconds * (mood === 'calm' ? .8 : 1.6)) * (mood === 'cheerful' ? .035 : .02);
        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(animate);
      const contextLost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        observer.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        ball.dispose();
        smileGeometry.dispose();
        face.dispose(); rose.dispose(); ink.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; cleanup(); };
  }, [appearance, mood]);

  return <div className="teacher-stage" role="img" aria-label={label}>
    <div className="teacher-orbit" aria-hidden="true" />
    <div ref={host} className="teacher-canvas" hidden={unavailable} />
    {unavailable && <div className="teacher-fallback" aria-hidden="true">✦</div>}
    <span className="teacher-caption">{label}</span>
  </div>;
}

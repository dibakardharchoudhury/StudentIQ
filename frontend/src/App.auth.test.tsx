import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const state = vi.hoisted(() => ({ sessions: vi.fn(), me: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('./config', () => ({ loadConfig: vi.fn().mockResolvedValue({}) }));
vi.mock('./auth', () => ({
  ParentAuth: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    signIn = state.signIn;
    signOut = state.signOut;
  },
}));
vi.mock('./api', () => ({
  Api: class { sessions = state.sessions; me = state.me; },
}));
vi.mock('./Teacher', () => ({ default: () => <div>Animation test placeholder</div> }));
vi.mock('./speech', () => ({ Speech: class { cancel = vi.fn(); } }));
beforeEach(() => {
  state.sessions.mockReset(); state.signIn.mockReset(); state.signOut.mockReset();
  state.me.mockReset(); state.me.mockResolvedValue({ role: 'student' });
  state.signIn.mockResolvedValue(undefined); state.signOut.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('parent backend authorization gate', () => {
  it('does not open the workspace when Microsoft sign-in succeeds but the backend rejects the parent', async () => {
    state.sessions.mockRejectedValue(new Error('This parent is not allowed'));
    render(<App />);
    const signIn = await screen.findByRole('button', { name: /Administrator sign-in/ });
    await waitFor(() => expect(signIn).toBeEnabled());
    fireEvent.click(signIn);
    expect(await screen.findByRole('alert')).toHaveTextContent('This parent is not allowed');
    expect(screen.queryByRole('button', { name: /Progress/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('opens only after backend confirmation, and sign-out clears the private workspace immediately', async () => {
    let allow!: (value: []) => void;
    state.sessions.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    render(<App />);
    const signIn = await screen.findByRole('button', { name: /Administrator sign-in/ });
    await waitFor(() => expect(signIn).toBeEnabled());
    fireEvent.click(signIn);
    await screen.findByRole('button', { name: /Checking account access/ });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    allow([]);
    await screen.findByRole('heading', { name: 'What shall we discover today?' });
    expect(screen.queryByRole('button', { name: /Configuration/ })).not.toBeInTheDocument();
    state.signOut.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /Sign out & clear this screen/ }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(state.signOut).toHaveBeenCalledOnce();
  });
  it('does not expose Configuration until authenticated /api/me confirms admin', async () => {
    let confirm!: (value: { role: string }) => void;
    state.sessions.mockResolvedValue([]);
    state.me.mockReturnValue(new Promise(resolve => { confirm = resolve; }));
    render(<App />);
    const signIn = await screen.findByRole('button', { name: /Administrator sign-in/ });
    fireEvent.click(signIn);
    await waitFor(() => expect(state.me).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: /Configuration/ })).not.toBeInTheDocument();
    confirm({ role: 'admin' });
    expect(await screen.findByRole('button', { name: /Configuration/ })).toBeInTheDocument();
  });
  it('does not expose Configuration to an approved parent', async () => {
    state.sessions.mockResolvedValue([]);
    state.me.mockResolvedValue({ role: 'parent' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Administrator sign-in/ }));
    await screen.findByRole('heading', { name: 'What shall we discover today?' });
    expect(screen.queryByRole('button', { name: /Configuration/ })).not.toBeInTheDocument();
  });
  it('fails closed if the role request fails even when sessions would be allowed', async () => {
    state.sessions.mockResolvedValue([]);
    state.me.mockRejectedValue(new Error('Role unavailable'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Administrator sign-in/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Role unavailable');
    expect(screen.queryByRole('button', { name: /Configuration/ })).not.toBeInTheDocument();
  });
  it('asks before clearing an unsent question when changing interface language', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    state.sessions.mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Administrator sign-in/ }));
    const talk = await screen.findByRole('button', { name: 'Talk to teacher' });
    await waitFor(() => expect(talk).toBeEnabled());
    fireEvent.click(talk);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Keep my question' } });
    const language = screen.getByRole('combobox', { name: 'Learning language' });
    fireEvent.change(language, { target: { value: 'nb' } });
    expect(confirm).toHaveBeenCalledOnce();
    expect(language).toHaveValue('en');
    expect(input).toHaveValue('Keep my question');
    confirm.mockReturnValue(true);
    fireEvent.change(language, { target: { value: 'nb' } });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(language).toHaveValue('nb');
  });
});

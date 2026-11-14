import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AccessManagement from './AccessManagement';
import { ApiError } from './api';

const request = { id: 'a'.repeat(64), provider: 'microsoft' as const, subject: 'account-123',
  email: 'person@example.com', requestedAt: '2026-11-14T12:00:00Z' };
const parent = { ...request, role: 'parent' as const, admin: false };
const snapshot = (accounts = [] as typeof parent[], requests = [request]) => ({ accounts, requests });
afterEach(() => vi.restoreAllMocks());

it('accepts email and approves a signature-checked request with optional parent administrator rights', async () => {
  const api = {
    accessDirectory: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot([{ ...parent, admin: true }], [])),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined), removeSocialAccount: vi.fn(),
  };
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByRole('button', { name: 'Use this request: person@example.com' });
  const email = screen.getByLabelText('Email address') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'person@example.com' } });
  expect(email.checkValidity()).toBe(true);
  expect(screen.getByLabelText('Sign-in request')).toHaveValue(request.id);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'parent' } });
  const admin = screen.getByRole('checkbox', { name: 'Give administrator rights (optional)' });
  expect(admin).not.toBeChecked();
  fireEvent.click(admin);
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith({
    provider: 'microsoft', requestId: request.id, email: 'person@example.com', role: 'parent', admin: true,
  }, expect.any(AbortSignal)));
  expect(confirm).toHaveBeenCalledOnce();
  expect(await screen.findByText('Account approved. Ask the person to sign in again.')).toBeVisible();
  expect(email).toHaveValue('');
  expect(screen.getByText('Administrator', { selector: 'span' })).toBeVisible();
});

it('never grants rights from an email without a request or carries administrator rights into a student role', async () => {
  const api = { accessDirectory: vi.fn().mockResolvedValue(snapshot()), saveSocialAccount: vi.fn(), removeSocialAccount: vi.fn() };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByRole('button', { name: 'Use this request: person@example.com' });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'unknown@example.com' } });
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeDisabled();
  expect(api.saveSocialAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this request: person@example.com' }));
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'parent' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'student' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'student', admin: false }), expect.any(AbortSignal),
  ));
});

it('clears stale email matches and requires explicit selection for duplicate provider labels', async () => {
  const duplicate = { ...request, id: 'b'.repeat(64), subject: 'another-account' };
  const other = { ...request, id: 'c'.repeat(64), subject: 'unique-account', email: 'unique@example.com' };
  const api = { accessDirectory: vi.fn().mockResolvedValue(snapshot([], [request, duplicate, other])),
    saveSocialAccount: vi.fn(), removeSocialAccount: vi.fn() };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByRole('button', { name: 'Use this request: unique@example.com' });
  const email = screen.getByLabelText('Email address');
  const selection = screen.getByLabelText('Sign-in request');
  fireEvent.change(email, { target: { value: 'unique@example.com' } });
  expect(selection).toHaveValue(other.id);
  fireEvent.change(email, { target: { value: 'person@example.com' } });
  expect(selection).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeDisabled();
  fireEvent.change(selection, { target: { value: duplicate.id } });
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeEnabled();
  fireEvent.change(email, { target: { value: 'unknown@example.com' } });
  expect(selection).toHaveValue('');
  fireEvent.change(selection, { target: { value: other.id } });
  expect(email).toHaveValue('unique@example.com');
});

it('lets an administrator grant, revoke, and remove parent access with explicit confirmation', async () => {
  const api = {
    accessDirectory: vi.fn().mockResolvedValueOnce(snapshot([parent], []))
      .mockResolvedValueOnce(snapshot([{ ...parent, admin: true }], []))
      .mockResolvedValueOnce(snapshot([parent], [])).mockResolvedValueOnce(snapshot([], [])),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined), removeSocialAccount: vi.fn().mockResolvedValue(undefined),
  };
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  const grant = await screen.findByRole('button', { name: 'Give administrator rights: person@example.com' });
  fireEvent.click(grant);
  expect(api.saveSocialAccount).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(grant);
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    { provider: 'microsoft', subject: 'account-123', role: 'parent', admin: true }, expect.any(AbortSignal),
  ));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove administrator rights: person@example.com' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenLastCalledWith(
    { provider: 'microsoft', subject: 'account-123', role: 'parent', admin: false }, expect.any(AbortSignal),
  ));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove access: person@example.com' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Remove access: person@example.com' }));
  expect(api.removeSocialAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal: person@example.com' }));
  await waitFor(() => expect(api.removeSocialAccount).toHaveBeenCalledWith(parent.id, expect.any(AbortSignal)));
  expect(await screen.findByText('Access removed.')).toBeVisible();
});

it('blocks changes after an uncertain mutation until a complete successful refresh', async () => {
  const api = {
    accessDirectory: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(snapshot()),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined), removeSocialAccount: vi.fn(),
  };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use this request: person@example.com' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change may have been saved');
  expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com');
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve account' })).toBeEnabled());
});

it('shows localized failures and offline state, denies expired access, and aborts reads on unmount', async () => {
  const denied = vi.fn();
  const api = { accessDirectory: vi.fn().mockRejectedValue(new ApiError('Forbidden', 403)), saveSocialAccount: vi.fn(), removeSocialAccount: vi.fn() };
  const view = render(<AccessManagement api={api} language="nb" online={false} onAccessDenied={denied} />);
  expect(screen.getByText(/Du er frakoblet/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Oppdater listen' })).toBeDisabled();
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  view.unmount();
  const pending = { ...api, accessDirectory: vi.fn().mockImplementation((_signal: AbortSignal) => new Promise(() => {})) };
  const waiting = render(<AccessManagement api={pending} language="en" online onAccessDenied={denied} />);
  const signal = pending.accessDirectory.mock.calls[0][0];
  expect(signal.aborted).toBe(false);
  waiting.unmount();
  expect(signal.aborted).toBe(true);
});

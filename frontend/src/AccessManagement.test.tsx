import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AccessManagement from './AccessManagement';
import { ApiError } from './api';

const parent = { id: 'a'.repeat(64), provider: 'google' as const, subject: 'account-123', role: 'parent' as const };
const student = { ...parent, role: 'student' as const };

it('guides approval using the exact provider and subject, then changes and removes access', async () => {
  const api = {
    socialAccounts: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([parent]).mockResolvedValueOnce([student]).mockResolvedValueOnce([]),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined), removeSocialAccount: vi.fn().mockResolvedValue(undefined),
  };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByText('No accounts have been approved yet.');
  expect(screen.getByText(/No invitation is sent/)).toBeVisible();
  expect(screen.getByText(/account ID on the sign-in page is unverified/)).toBeVisible();
  expect(screen.getByText(/Neither can manage access or the calendar/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Sign-in provider'), { target: { value: 'google' } });
  const input = screen.getByLabelText('Account ID') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'person@example.com' } });
  expect(input.checkValidity()).toBe(false);
  fireEvent.change(input, { target: { value: 'account-123' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'parent' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    { provider: 'google', subject: 'account-123', role: 'parent' }, expect.any(AbortSignal),
  ));
  expect(await screen.findByText('Account approved. Ask the person to sign in again.')).toBeVisible();
  expect(input).toHaveValue('');
  const account = within(screen.getByRole('region', { name: 'Approved accounts (1)' })).getByRole('listitem');
  expect(within(account).getByText('Google')).toBeVisible();
  expect(within(account).getByText('Parent')).toBeVisible();
  expect(within(account).getByText('account-123')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Change to student: Google · account-123/ }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    { provider: 'google', subject: 'account-123', role: 'student' }, expect.any(AbortSignal),
  ));
  expect(await screen.findByText('Role updated. The person must sign in again.')).toBeVisible();
  expect(screen.getByText('Student', { selector: 'span' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Remove access: Google · account-123/ }));
  expect(api.removeSocialAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.removeSocialAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Remove access: Google · account-123/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm removal: Google · account-123/ }));
  await waitFor(() => expect(api.removeSocialAccount).toHaveBeenCalledWith(parent.id, expect.any(AbortSignal)));
  expect(await screen.findByText('Access removed.')).toBeVisible();
});

it('blocks changes after an uncertain mutation until a successful refresh', async () => {
  const api = {
    socialAccounts: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([parent]),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined), removeSocialAccount: vi.fn(),
  };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByText('No accounts have been approved yet.');
  fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'account-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change may have been saved');
  expect(screen.getByLabelText('Account ID')).toHaveValue('account-123');
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeDisabled();
  expect(screen.queryByText(/Account approved/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
  await screen.findByText('account-123');
  expect(screen.getByRole('button', { name: 'Approve account' })).toBeEnabled();
});

it('shows Norwegian loading, failure, offline and recovery states', async () => {
  let rejectLoad!: (error: Error) => void;
  const api = {
    socialAccounts: vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLoad = reject; })).mockResolvedValueOnce([]),
    saveSocialAccount: vi.fn(), removeSocialAccount: vi.fn(),
  };
  const { rerender } = render(<AccessManagement api={api} language="nb" online onAccessDenied={vi.fn()} />);
  expect(screen.getByText('Laster tilgangslisten…')).toBeVisible();
  rejectLoad(new Error('network'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kunne ikke laste tilgangslisten');
  rerender(<AccessManagement api={api} language="nb" online={false} onAccessDenied={vi.fn()} />);
  expect(screen.getByText(/Du er frakoblet/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Oppdater listen' })).toBeDisabled();
  expect(screen.getByText(/Det sendes ingen invitasjon/)).toBeVisible();
  expect(screen.getByText(/Konto-ID-en på innloggingssiden er ubekreftet/)).toBeVisible();
  rerender(<AccessManagement api={api} language="nb" online onAccessDenied={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Oppdater listen' }));
  expect(await screen.findByText('Ingen kontoer er godkjent ennå.')).toBeVisible();
});

it('reports authorization failures and aborts in-flight requests on unmount', async () => {
  const denied = vi.fn();
  const api = { socialAccounts: vi.fn().mockRejectedValue(new ApiError('Forbidden', 403)), saveSocialAccount: vi.fn(), removeSocialAccount: vi.fn() };
  const { unmount } = render(<AccessManagement api={api} language="en" online onAccessDenied={denied} />);
  await waitFor(() => expect(denied).toHaveBeenCalledOnce());
  unmount();
  const pending = { ...api, socialAccounts: vi.fn().mockImplementation(() => new Promise(() => {})) };
  const view = render(<AccessManagement api={pending} language="en" online onAccessDenied={denied} />);
  const signal = pending.socialAccounts.mock.calls[0][0] as AbortSignal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AccessManagement from './AccessManagement';

it('allows an administrator to approve a parent and explicitly confirm removal', async () => {
  const account = { id: 'a'.repeat(64), provider: 'google' as const, subject: 'account-123', role: 'parent' as const };
  const api = {
    socialAccounts: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([account]),
    saveSocialAccount: vi.fn().mockResolvedValue(undefined),
    removeSocialAccount: vi.fn().mockResolvedValue(undefined),
  };
  render(<AccessManagement api={api} language="en" online onAccessDenied={vi.fn()} />);
  await screen.findByText('No accounts have been approved yet.');
  expect(screen.getByText(/The ID is not an email address/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Sign-in provider'), { target: { value: 'google' } });
  fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'account-123' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'parent' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    { provider: 'google', subject: 'account-123', role: 'parent' }, expect.any(AbortSignal),
  ));
  expect(await screen.findByText('Google · Parent')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change to student' }));
  await waitFor(() => expect(api.saveSocialAccount).toHaveBeenCalledWith(
    { provider: 'google', subject: 'account-123', role: 'student' }, expect.any(AbortSignal),
  ));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove access' }));
  expect(api.removeSocialAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(api.removeSocialAccount).toHaveBeenCalledWith(account.id, expect.any(AbortSignal)));
});

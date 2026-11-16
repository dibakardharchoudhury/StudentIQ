import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import GoogleSignIn from './GoogleSignIn';

vi.mock('./auth', () => ({ makeNonce: vi.fn().mockReturnValueOnce('first-nonce').mockReturnValue('retry-nonce') }));

afterEach(() => { delete window.google; vi.clearAllMocks(); });

it('offers a localized retry and passes the new nonce with the credential', () => {
  const onCredential = vi.fn();
  render(<GoogleSignIn clientId="test-client" disabled={false} language="nb" onCredential={onCredential} />);
  const first = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')!;
  fireEvent.error(first);
  expect(screen.getByRole('alert')).toHaveTextContent('Google-innlogging');
  fireEvent.click(screen.getByRole('button', { name: 'Prøv Google-innlogging på nytt' }));
  expect(first.isConnected).toBe(false);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  const initialize = vi.fn();
  const renderButton = vi.fn();
  window.google = { accounts: { id: { initialize, renderButton } } };
  const retry = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')!;
  fireEvent.load(retry);
  expect(initialize).toHaveBeenCalledOnce();
  const options = initialize.mock.calls[0][0];
  expect(options).toMatchObject({ client_id: 'test-client', nonce: 'retry-nonce' });
  options.callback({ credential: 'test-credential' });
  expect(onCredential).toHaveBeenCalledWith('test-credential', 'retry-nonce');
  expect(renderButton).toHaveBeenCalledOnce();
  expect(renderButton.mock.calls[0][1]).toMatchObject({
    text: 'continue_with', shape: 'rectangular', width: 360, locale: 'no',
  });
});

it('reports a script that loads without the Google API', () => {
  render(<GoogleSignIn clientId="test-client" disabled={false} language="en" onCredential={vi.fn()} />);
  fireEvent.load(document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')!);
  expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in could not load');
});

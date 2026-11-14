import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BuildStatus from './BuildStatus';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_APP_VERSION', 'current-build');
  vi.stubEnv('VITE_BUILD_TIME', '2026-11-14T12:00:00.000Z');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows Norwegian local build time and checks the deployed version without caching or cookies', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: 'current-build', builtAt: '2026-11-14T12:00:00Z' })));
  render(<BuildStatus language="en" busy={false} hasDraft={false} />);
  expect(screen.getByText(/Built/)).toHaveTextContent('13:00:00');
  expect(screen.getByText(/Built/)).toHaveTextContent('Europe/Oslo');
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('version.json'),
    expect.objectContaining({ cache: 'no-store', credentials: 'omit' })));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('offers an explicit update without interrupting work and asks before discarding a draft', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ version: 'new-build', builtAt: '2026-11-14T13:00:00Z' })));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { rerender } = render(<BuildStatus language="en" busy hasDraft />);
  const update = await screen.findByRole('button', { name: /New version ready/ });
  expect(update).toBeDisabled();
  rerender(<BuildStatus language="en" busy={false} hasDraft />);
  fireEvent.click(update);
  expect(confirm).toHaveBeenCalledOnce();
  expect(update).toBeInTheDocument();
});

it('reports a malformed version response instead of claiming an update and retries on reconnect', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(
    new Response(JSON.stringify({ version: 'new-build', builtAt: '2026-11-14T13:00:00Z' })));
  render(<BuildStatus language="nb" busy={false} hasDraft={false} />);
  expect(await screen.findByRole('status')).toHaveTextContent('Kunne ikke sjekke');
  fireEvent(window, new Event('online'));
  expect(await screen.findByRole('button', { name: /Ny versjon klar/ })).toBeInTheDocument();
  expect(screen.queryByText(/Kunne ikke sjekke/)).not.toBeInTheDocument();
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Preferences, type Reminder } from './api';
import PlanningCalendar from './PlanningCalendar';
import TeacherSettings from './TeacherSettings';

describe('canonical in-app planning items', () => {
  it('creates, completes, edits and deletes only through backend mutations followed by canonical reads', async () => {
    let stored: Reminder[] = [];
    const api = {
      reminders: vi.fn(async () => [...stored]),
      saveReminder: vi.fn(async (input: Partial<Reminder>) => {
        const item = { id: 'backend-created-id', completed: false, ...input } as Reminder;
        stored = [item];
      }),
      deleteReminder: vi.fn(async () => { stored = []; }),
    };
    render(<PlanningCalendar api={api as unknown as Api} language="en" online onBusyChange={vi.fn()} onAccessDenied={vi.fn()} />);
    await screen.findByText('The service returned no planning items for this view.');
    fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
    fireEvent.change(screen.getByLabelText('What would you like to plan?'), { target: { value: 'Read a map' } });
    fireEvent.change(screen.getByLabelText('Date', { exact: true }), { target: { value: '2026-11-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add planning item' }));
    expect(await screen.findByText('Read a map')).toBeInTheDocument();
    expect(api.saveReminder.mock.calls[0][0]).toEqual({ title: 'Read a map', date: '2026-11-14' });
    expect(api.reminders).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete: Read a map' }));
    await screen.findByRole('checkbox', { name: 'Mark not complete: Read a map' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('What would you like to plan?'), { target: { value: 'Explore a map' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Explore a map')).toBeInTheDocument();
    expect(stored[0].completed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmation = screen.getByRole('group', { name: 'Delete this planning item?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Explore a map')).not.toBeInTheDocument());
    expect(api.deleteReminder).toHaveBeenCalledWith('backend-created-id', expect.anything());
    expect(api.reminders).toHaveBeenCalledTimes(5);
  });
  it('clears planning data and notifies the parent workspace when server authorization is revoked', async () => {
    const denied = vi.fn();
    const api = {
      reminders: vi.fn().mockResolvedValue([{ id: 'private-item', title: 'Private fixture plan', date: '2026-11-14', completed: false }]),
      saveReminder: vi.fn().mockRejectedValue(new ApiError('Forbidden', 403)),
    };
    render(<PlanningCalendar api={api as unknown as Api} language="en" online onBusyChange={vi.fn()} onAccessDenied={denied} />);
    fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
    await screen.findByText('Private fixture plan');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete: Private fixture plan' }));
    await waitFor(() => expect(denied).toHaveBeenCalledOnce());
    expect(screen.queryByText('Private fixture plan')).not.toBeInTheDocument();
  });
});

describe('backend-synchronized teacher customization', () => {
  const initial: Preferences = { appearance: 'rose', voice: 'default', mood: 'gentle' };
  it('does not apply an unsaved draft and applies only the canonical server result after saving', async () => {
    const changed = vi.fn();
    const canonical: Preferences = { appearance: 'mint', voice: 'alternate', mood: 'calm' };
    const api = { preferences: vi.fn().mockResolvedValue(initial), savePreferences: vi.fn().mockResolvedValue(canonical) };
    render(<TeacherSettings api={api as unknown as Api} language="en" online disabled={false} onChange={changed} onBusyChange={vi.fn()} />);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(initial));
    fireEvent.click(screen.getByText('Make your teacher feel like yours'));
    fireEvent.change(screen.getByLabelText('Teacher appearance'), { target: { value: 'mint' } });
    fireEvent.change(screen.getByLabelText('Teacher voice'), { target: { value: 'alternate' } });
    fireEvent.change(screen.getByLabelText('Teacher mood'), { target: { value: 'calm' } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Unsaved choices/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save teacher preferences' }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(canonical));
    expect(api.savePreferences).toHaveBeenCalledWith(canonical, expect.anything());
  });
  it('shows unsynchronized defaults and blocks blind resubmission when saving fails', async () => {
    const changed = vi.fn();
    const api = { preferences: vi.fn().mockResolvedValue(initial), savePreferences: vi.fn().mockRejectedValue(new Error('Service unavailable')) };
    render(<TeacherSettings api={api as unknown as Api} language="en" online disabled={false} onChange={changed} onBusyChange={vi.fn()} />);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(initial));
    fireEvent.click(screen.getByText('Make your teacher feel like yours'));
    fireEvent.click(screen.getByRole('button', { name: 'Save teacher preferences' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/Using unsynchronized defaults/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save teacher preferences' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload saved preferences' })).toBeEnabled();
  });
});

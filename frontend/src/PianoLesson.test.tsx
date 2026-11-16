import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Midi } from '@tonejs/midi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PianoLesson from './PianoLesson';

vi.mock('./piano-audio', () => ({
  PianoAudio: class { start = vi.fn().mockResolvedValue(undefined); stopAll = vi.fn(); dispose = vi.fn(); },
}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('real piano phrase lessons', () => {
  it.each([
    { language: 'en' as const, playback: 'Playback', navigation: 'Notes and phrases', progress: 'Phrase progress',
      importer: 'Your notes and MIDI', picker: 'Choose a piece or theme' },
    { language: 'nb' as const, playback: 'Avspilling', navigation: 'Noter og fraser', progress: 'Fremdrift i frasen',
      importer: 'Egne noter og MIDI', picker: 'Velg et stykke eller tema' },
  ])('keeps practice ready and advanced import disclosed in $language', labels => {
    render(<PianoLesson language={labels.language} active onContext={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/E4, 1; E4, 1; F4, 1/);
    expect(screen.getByRole('group', { name: labels.playback })).toBeVisible();
    expect(screen.getByRole('group', { name: labels.navigation })).toBeVisible();
    const progress = screen.getByRole('progressbar', { name: labels.progress });
    expect(progress).toHaveAttribute('value', '1');
    const importer = screen.getByText(labels.importer).closest('details');
    expect(importer).not.toHaveAttribute('open');
    expect(screen.getByRole('checkbox')).not.toBeVisible();
    fireEvent.change(screen.getByLabelText(labels.picker), { target: { value: 'custom' } });
    expect(importer).toHaveAttribute('open');
    expect(screen.getByRole('checkbox')).toBeVisible();
  });

  it('finds a full public-domain score by an accent-free title and prepares actual imported notes automatically', async () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 76, ticks: 0, durationTicks: 480 });
    const data = Uint8Array.from(midi.toArray()).buffer;
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(data));
    render(<PianoLesson language="en" active onContext={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Song or composer'), { target: { value: 'Fur Elise' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find a verified piece' }));
    fireEvent.click(screen.getByRole('button', { name: /Full MIDI source/ }));
    await waitFor(() => expect(screen.getByText(/^Play now:/)).toHaveTextContent('E5'));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('scores/fur-elise.mid'),
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    expect(screen.getByRole('link', { name: 'Source score and public-domain information' })).toBeInTheDocument();
  });

  it('requires rights confirmation before importing a full-range custom MIDI without uploading it', async () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 84, ticks: 0, durationTicks: 480 });
    const request = vi.spyOn(globalThis, 'fetch');
    render(<PianoLesson language="en" active onContext={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Choose a piece or theme'), { target: { value: 'custom' } });
    const input = screen.getByLabelText('Import an authorized MIDI file (up to 1 MB)');
    expect(input).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/These are my own notes/));
    const file = new File([], 'authorized.mid', { type: 'audio/midi' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => Uint8Array.from(midi.toArray()).buffer });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/^Play now:/)).toHaveTextContent('C6'));
    expect(request).not.toHaveBeenCalled();
  });

  it('finds a verified theme by composer and switches its visible staff and current note', () => {
    render(<PianoLesson language="en" active onContext={vi.fn()} />);
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('E4');
    fireEvent.change(screen.getByLabelText('Song or composer'), { target: { value: 'Mozart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find a verified piece' }));
    fireEvent.click(screen.getByRole('button', { name: /Ah! vous dirai-je, maman/ }));
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('C4');
    expect(screen.getByRole('img', { name: /Treble staff/ })).toHaveAccessibleName(/C4, 1; C4, 1; G4, 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Next note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next note' }));
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('G4');
    fireEvent.click(screen.getByRole('button', { name: 'Repeat phrase' }));
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('C4');
  });

  it('advances according to tempo and beat lengths, and pauses when the lesson becomes inactive', () => {
    vi.useFakeTimers();
    const props = { language: 'en' as const, active: true, onContext: vi.fn() };
    const { rerender } = render(<PianoLesson {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow notes slowly' }));
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('F4');
    rerender(<PianoLesson {...props} active={false} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(/^Play now:/)).toHaveTextContent('F4');
    expect(screen.getByRole('button', { name: 'Follow notes slowly' })).toBeDisabled();
  });

  it('refuses unknown titles rather than fabricating a song, and validates custom note ranges and durations', () => {
    render(<PianoLesson language="en" active onContext={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Song or composer'), { target: { value: 'Unknown new song' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find a verified piece' }));
    expect(screen.getByText(/No matching verified piece/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a piece or theme'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Notes and beat lengths'), { target: { value: 'C4:1 D4:2 C6:1' } });
    fireEvent.click(screen.getByLabelText(/These are my own notes/));
    fireEvent.click(screen.getByRole('button', { name: 'Load my practice notes' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No notes were loaded');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes and beat lengths'), { target: { value: 'C4:0.5 D4:2 E4:1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load my practice notes' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/C4, 0.5; D4, 2; E4, 1.5/);
  });
});

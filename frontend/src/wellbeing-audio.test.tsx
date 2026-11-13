import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GentleCheckIn from './GentleCheckIn';
import { PianoAudio } from './piano-audio';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('optional non-attention check-in', () => {
  it('is off by default, resets on interaction, offers once, and never pauses without a choice', () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    render(<GentleCheckIn language="en" paused={false} onBreak={pause} />);
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.queryByText(/This page has been quiet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Optional gentle check-in'));
    act(() => vi.advanceTimersByTime(4 * 60_000));
    fireEvent.keyDown(document, { key: 'a' });
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(screen.queryByText(/This page has been quiet/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(/This page has been quiet/)).toBeInTheDocument();
    expect(pause).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(screen.queryByText(/This page has been quiet/)).not.toBeInTheDocument();
    expect(pause).not.toHaveBeenCalled();
  });
  it('can offer a check-in after a long hidden-tab period without making any gaze inference', () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const pause = vi.fn();
    render(<GentleCheckIn language="en" paused={false} onBreak={pause} />);
    fireEvent.click(screen.getByLabelText('Optional gentle check-in'));
    hidden = true; fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(screen.queryByText(/This page has been quiet/)).not.toBeInTheDocument();
    hidden = false; fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByText(/This page has been quiet/)).toBeInTheDocument();
    expect(screen.getByText(/No gaze, distraction or attention detection/)).toBeInTheDocument();
    expect(pause).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Take a break' }));
    expect(pause).toHaveBeenCalledOnce();
  });
});

describe('gesture-only sample-free piano audio', () => {
  it('creates no AudioContext until a note gesture, synthesizes the note, and releases audio resources', async () => {
    const created = vi.fn();
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext', class {
      state = 'running'; currentTime = 0; destination = {};
      constructor() { created(); }
      createOscillator = () => oscillator; createGain = () => gain; close = close;
    });
    const piano = new PianoAudio();
    expect(created).not.toHaveBeenCalled();
    await piano.start('A4');
    expect(created).toHaveBeenCalledOnce();
    expect(oscillator.frequency.value).toBe(440);
    expect(oscillator.start).toHaveBeenCalledOnce();
    piano.stopAll(); piano.dispose();
    expect(oscillator.stop).toHaveBeenLastCalledWith(.04);
    expect(close).toHaveBeenCalledOnce();
  });
});

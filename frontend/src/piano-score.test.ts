import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { pitchMidi, readPianoScore } from './piano-score';

describe('MIDI piano practice', () => {
  it('converts an authorized score across the piano range, retaining rests and reducing simultaneous starts explicitly', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.name = 'Right hand';
    track.addNote({ midi: 76, ticks: 0, durationTicks: 240 });
    track.addNote({ midi: 72, ticks: 0, durationTicks: 240 });
    track.addNote({ midi: 108, ticks: 480, durationTicks: 480 });
    const data = midi.toArray();
    const lines = readPianoScore(Uint8Array.from(data).buffer);
    expect(lines[0].name).toBe('Right hand');
    expect(lines[0].phrases[0]).toEqual([
      { pitch: 'E5', beats: .5 },
      { pitch: 'C8', beats: 1, restBefore: .5 },
    ]);
    expect(pitchMidi('A0')).toBe(21);
    expect(pitchMidi('C8')).toBe(108);
    expect(() => pitchMidi('C#8')).toThrow();
  });

  it('parses both bundled public-domain works into complete practice lines instead of invented excerpts', () => {
    for (const [file, opening] of [['fur-elise.mid', 'E5'], ['mozart-menuet-k2.mid', 'F5']]) {
      const buffer = readFileSync(resolve(process.cwd(), 'public', 'scores', file));
      const lines = readPianoScore(Uint8Array.from(buffer).buffer);
      expect(lines[0].phrases[0][0].pitch).toBe(opening);
      expect(lines[0].phrases.flat().length).toBeGreaterThan(30);
    }
  });

  it('rejects broken, excessive and non-piano-range data rather than fabricating notes', () => {
    expect(() => readPianoScore(new ArrayBuffer(8))).toThrow();
    expect(() => readPianoScore(new ArrayBuffer(1_048_577))).toThrow();
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 120, ticks: 0, durationTicks: 240 });
    expect(() => readPianoScore(Uint8Array.from(midi.toArray()).buffer)).toThrow(/outside/);
  });
});

import { Midi } from '@tonejs/midi';

export type ScorePitch = `${'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'}${'' | '#'}${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type ScoreNote = { pitch: ScorePitch; beats: number; finger?: number; restBefore?: number };
export type ScoreLine = { name: string; phrases: ScoreNote[][] };
export const scoreSources = [
  { id: 'fur-elise', title: 'Für Elise', artist: 'Ludwig van Beethoven', file: 'fur-elise.mid',
    source: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931' },
  { id: 'menuet-k2', title: 'Menuet K. 2', artist: 'Wolfgang Amadeus Mozart', file: 'mozart-menuet-k2.mid',
    source: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1770' },
] as const;

export function pitchMidi(pitch: string): number {
  const match = /^([A-G])(#?)([0-8])$/.exec(pitch);
  if (!match) throw new Error('Unsupported piano pitch.');
  const offsets: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (Number(match[3]) + 1) * 12 + offsets[match[1]] + (match[2] ? 1 : 0);
  if (midi < 21 || midi > 108) throw new Error('Pitch is outside the 88-key piano.');
  return midi;
}

export function readPianoScore(data: ArrayBuffer): ScoreLine[] {
  if (data.byteLength < 14 || data.byteLength > 1_048_576) throw new Error('MIDI file must be at most 1 MB.');
  const midi = new Midi(data);
  if (!Number.isFinite(midi.header.ppq) || midi.header.ppq <= 0 ||
      midi.tracks.length > 64 || midi.tracks.reduce((sum, track) => sum + track.notes.length, 0) > 20_000) {
    throw new Error('MIDI score is too large or has unsupported timing.');
  }
  const lines: ScoreLine[] = [];
  for (const [index, track] of midi.tracks.entries()) {
    if (track.instrument.percussion || !track.notes.length) continue;
    const onsets = new Map<number, typeof track.notes[number]>();
    for (const note of track.notes) {
      if (!Number.isFinite(note.ticks) || !Number.isFinite(note.durationTicks) || note.ticks < 0 || note.durationTicks <= 0) {
        throw new Error('MIDI score contains invalid timing.');
      }
      if (note.midi < 21 || note.midi > 108) throw new Error('MIDI score contains notes outside the 88-key piano.');
      const previous = onsets.get(note.ticks);
      if (!previous || previous.midi < note.midi) onsets.set(note.ticks, note);
    }
    let previousEnd = 0;
    const ordered = [...onsets.values()].sort((a, b) => a.ticks - b.ticks);
    const notes: ScoreNote[] = ordered.map((note, position) => {
      pitchMidi(note.name);
      const restBefore = Math.max(0, (note.ticks - previousEnd) / midi.header.ppq);
      const duration = Math.min(note.durationTicks, ordered[position + 1] ? ordered[position + 1].ticks - note.ticks : note.durationTicks);
      const beats = duration / midi.header.ppq;
      previousEnd = note.ticks + duration;
      return { pitch: note.name as ScorePitch, beats, ...(restBefore ? { restBefore } : {}) };
    });
    const phrases: ScoreNote[][] = [];
    for (let offset = 0; offset < notes.length; offset += 8) phrases.push(notes.slice(offset, offset + 8));
    lines.push({ name: track.name.trim().slice(0, 80) || `Piano ${index + 1}`, phrases });
  }
  if (!lines.length) throw new Error('No playable piano notes were found.');
  return lines;
}

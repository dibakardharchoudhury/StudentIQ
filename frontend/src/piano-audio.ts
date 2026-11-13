import { pianoNotes, type PianoNote } from './api';

type Voice = { oscillator?: OscillatorNode; gain?: GainNode };

export class PianoAudio {
  private context?: AudioContext;
  private voices = new Map<PianoNote, Voice>();
  private disposed = false;

  async start(note: PianoNote) {
    if (this.disposed || this.voices.has(note)) return;
    // Called only from pointer/keyboard gestures, never from mounting or backend replies.
    const Audio = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is unavailable. You can still select a note for practice.');
    this.context ??= new Audio();
    const context = this.context;
    const voice: Voice = {};
    this.voices.set(note, voice);
    try {
      if (context.state === 'suspended') await context.resume();
      if (this.disposed || this.voices.get(note) !== voice) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      voice.oscillator = oscillator; voice.gain = gain;
      oscillator.type = 'triangle';
      oscillator.frequency.value = 440 * 2 ** ((60 + pianoNotes.indexOf(note) - 69) / 12);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(.12, context.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.025, context.currentTime + 1.8);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect();
        if (this.voices.get(note) === voice) this.voices.delete(note);
      };
      oscillator.start();
      oscillator.stop(context.currentTime + 2);
    } catch {
      this.stop(note);
      throw new Error('Piano sound could not start. Check sound permissions or use silent note selection.');
    }
  }
  stop(note: PianoNote) {
    const voice = this.voices.get(note);
    this.voices.delete(note);
    if (!voice?.oscillator || !voice.gain || !this.context) return;
    const time = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setTargetAtTime(0, time, .01);
    try { voice.oscillator.stop(time + .04); } catch { /* Already ended. */ }
  }
  stopAll() { for (const note of this.voices.keys()) this.stop(note); }
  dispose() {
    this.disposed = true; this.stopAll();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}

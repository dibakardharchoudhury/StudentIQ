import { useEffect, useRef, useState } from 'react';
import { pianoNotes, targetNotes, type Api, type Language, type PianoAttempt, type PianoNote, type TargetNote } from './api';
import { copy } from './i18n';
import { PianoAudio } from './piano-audio';

const shortcuts = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];
const sharpPositions: Partial<Record<PianoNote, number>> = { 'C#4': 12.5, 'D#4': 25, 'F#4': 50, 'G#4': 62.5, 'A#4': 75 };

export default function Piano({ api, language, disabled, online, onBusyChange }: {
  api: Api; language: Language; disabled: boolean; online: boolean; onBusyChange(busy: boolean): void;
}) {
  const c = copy(language);
  const [sound, setSound] = useState(true);
  const [practice, setPractice] = useState(false);
  const [target, setTarget] = useState<TargetNote>('C4');
  const [active, setActive] = useState<Set<PianoNote>>(new Set());
  const [attempts, setAttempts] = useState<PianoAttempt[] | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const audio = useRef<PianoAudio | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const hold = useRef(new Set<PianoNote>());

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    audio.current = new PianoAudio();
    void refresh();
    const silence = () => { audio.current?.stopAll(); hold.current.clear(); setActive(new Set()); };
    const hidden = () => { if (document.hidden) silence(); };
    const leave = () => { silence(); request.current?.abort(); };
    window.addEventListener('blur', silence);
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false; request.current?.abort(); request.current = null;
      audio.current?.dispose(); hold.current.clear();
      window.removeEventListener('blur', silence);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [api]);
  useEffect(() => {
    if (disabled) { audio.current?.stopAll(); hold.current.clear(); setActive(new Set()); }
  }, [disabled]);

  async function refresh(selectedNote?: PianoNote) {
    if (request.current || (selectedNote && (blocked || !online))) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    if (selectedNote) setFeedback(c.pianoChecking);
    try {
      if (selectedNote) {
        const result = await api.pianoPractice({ targetNote: target, selectedNote }, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setFeedback(result.correct ? c.pianoCorrect : c.pianoTry);
      }
      const result = await api.pianoAttempts(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setAttempts(result); setStale(false); setBlocked(false);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(`${error instanceof Error ? error.message : c.pianoUnavailable}${selectedNote ? ` ${c.pianoAmbiguous}` : ''}`);
      setStale(true);
      if (selectedNote) { setBlocked(true); setFeedback(''); }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function down(note: PianoNote) {
    if (disabled || hold.current.has(note) || (practice && (busy || blocked || !online))) return;
    hold.current.add(note); setActive(new Set(hold.current));
    if (sound) void audio.current?.start(note).catch(error => {
      if (mounted.current) setError(error instanceof Error ? error.message : c.pianoUnavailable);
    });
    if (practice) void refresh(note);
  }
  function up(note: PianoNote) {
    hold.current.delete(note); audio.current?.stop(note); setActive(new Set(hold.current));
  }
  return <section className="piano-panel" aria-label={c.piano}>
    <h2>{c.pianoTitle}</h2><p className="small">{c.pianoNote}</p>
    <div className="piano-options">
      <button type="button" aria-pressed={sound} onClick={() => {
        if (sound) audio.current?.stopAll();
        setSound(value => !value);
      }}>{sound ? c.pianoMute : c.pianoUnmute}</button>
      <label><input type="checkbox" checked={practice} disabled={disabled || busy || !online}
        onChange={event => { setPractice(event.target.checked); setFeedback(''); }} />{c.pianoPractice}</label>
      <label>{c.pianoTarget}<select value={target} disabled={disabled || busy}
        onChange={event => { setTarget(event.target.value as TargetNote); setFeedback(''); }}>
        {targetNotes.map(note => <option value={note} key={note}>{note}</option>)}
      </select></label>
    </div>
    <p>{c.pianoHelp}</p>
    {practice && <p className="target-note">{c.pianoTarget}: <strong>{target}</strong></p>}
    <div className="piano-scroll">
      <div className="piano-keyboard" role="group" aria-label={c.pianoKeys}
        onKeyDown={event => {
          if (event.ctrlKey || event.altKey || event.metaKey) return;
          const index = shortcuts.indexOf(event.key.toLowerCase());
          if (index >= 0) { event.preventDefault(); if (!event.repeat) down(pianoNotes[index]); }
        }}
        onKeyUp={event => {
          const index = shortcuts.indexOf(event.key.toLowerCase());
          if (index >= 0) { event.preventDefault(); up(pianoNotes[index]); }
        }}>
        {pianoNotes.map((note, index) => <button key={note} type="button"
          className={`piano-key ${note.includes('#') ? 'sharp' : 'natural'}${active.has(note) ? ' active' : ''}`}
          style={note.includes('#') ? { left: `${sharpPositions[note]}%` } : undefined}
          aria-label={`${note} · ${shortcuts[index].toUpperCase()}`} aria-pressed={active.has(note)}
          disabled={disabled || (practice && (busy || blocked || !online) && !active.has(note))}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus();
            event.currentTarget.setPointerCapture?.(event.pointerId); down(note);
          }}
          onPointerUp={() => up(note)} onPointerCancel={() => up(note)}
          onLostPointerCapture={() => up(note)} onBlur={() => up(note)}
          onKeyDown={event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) down(note); }
          }}
          onKeyUp={event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); up(note); }
          }}>
          <span>{note}</span><small>{shortcuts[index].toUpperCase()}</small>
        </button>)}
      </div>
    </div>
    <p className="piano-feedback" role="status">{feedback}</p>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {stale && <p className="notice">{c.pianoStale}</p>}
    <div className="piano-progress" aria-live="polite">
      {attempts !== null && <p><strong>{attempts.length}</strong> {c.pianoStored} · {attempts.filter(attempt => attempt.correct).length} {c.storedCorrect}</p>}
      {busy && <p>{c.pianoLoading}</p>}
      <button type="button" disabled={busy || !online} onClick={() => void refresh()}>{c.pianoRefresh}</button>
    </div>
    <p className="small">{c.pianoProgressNote}</p>
  </section>;
}

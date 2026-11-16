import { useEffect, useRef, useState } from 'react';
import { pianoNotes, type Language } from './api';
import { copy } from './i18n';
import { PianoAudio } from './piano-audio';
import { readPianoScore, scoreSources, type ScoreLine, type ScoreNote, type ScorePitch } from './piano-score';

type Note = ScoreNote;
type Piece = { id: string; title: string; credit: string; phrases: Note[][]; tip: { en: string; nb: string }; source?: string };
const searchKey = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const notes = (pitches: string, lastBeats = 2): Note[] => pitches.split(' ').map((pitch, index, all) => ({
  pitch: pianoNotes.find(note => note === pitch)!,
  beats: index === all.length - 1 ? lastBeats : 1,
}));
const pieces: Piece[] = [
  {
    id: 'beethoven', title: 'Ode to Joy', credit: 'Ludwig van Beethoven · Symphony No. 9, Op. 125 · public-domain theme',
    phrases: [
      notes('E4 E4 F4 G4 G4 F4 E4 D4', 1),
      [...notes('C4 C4 D4 E4', 1), { pitch: 'E4' as const, beats: 1.5 }, { pitch: 'D4' as const, beats: .5 }, { pitch: 'D4' as const, beats: 2 }],
    ].map(phrase => phrase.map(note => ({ ...note, finger: ['C4', 'D4', 'E4', 'F4', 'G4'].indexOf(note.pitch) + 1 }))),
    tip: {
      en: 'Right hand: place your thumb (1) on middle C (C4), then fingers 2–5 on D, E, F and G. Try one phrase slowly, then join the phrases. This is a simplified melody in C, not the full orchestral score.',
      nb: 'Høyre hånd: legg tommelen (1) på enstrøken C (C4), og fingrene 2–5 på D, E, F og G. Øv sakte på én frase, og sett dem sammen. Dette er en forenklet melodi i C, ikke hele orkesterpartituret.',
    },
  },
  {
    id: 'mozart', title: 'Ah! vous dirai-je, maman', credit: 'Traditional French melody · theme used by Mozart in K. 265 · public domain',
    phrases: [notes('C4 C4 G4 G4 A4 A4 G4'), notes('F4 F4 E4 E4 D4 D4 C4')],
    tip: {
      en: 'Find middle C. Notice the jump from C to G, then the step up to A. Move your hand comfortably; do not stretch or force it. This is the traditional theme Mozart varied, not a transcription of his variations.',
      nb: 'Finn enstrøken C. Legg merke til spranget fra C til G, og trinnet opp til A. Flytt hånden behagelig; ikke strekk eller press. Dette er den tradisjonelle melodien Mozart varierte, ikke en avskrift av variasjonene.',
    },
  },
  {
    id: 'original', title: 'Little stepping stones', credit: 'StudentIQ · original pop-style beginner exercise',
    phrases: [notes('C4 E4 G4 E4 F4 E4 D4 C4'), notes('D4 F4 A4 F4 E4 D4 C4')],
    tip: {
      en: 'Keep a gentle, even beat. Play softly and let your hand relax between phrases. An original practice melody, not a song by a recording artist.',
      nb: 'Hold en rolig, jevn puls. Spill mykt og la hånden slappe av mellom frasene. En original øvingsmelodi, ikke en sang av en plateartist.',
    },
  },
];

function Staff({ phrase, current, label }: { phrase: Note[]; current: number; label: string }) {
  const y = (pitch: ScorePitch) => 110 - ('CDEFGAB'.indexOf(pitch[0]) + (Number(pitch.at(-1)) - 4) * 7) * 6;
  const top = Math.min(36, ...phrase.map(note => y(note.pitch) - 40));
  const bottom = Math.max(160, ...phrase.map(note => y(note.pitch) + 35));
  return <svg className="piano-lesson-staff" viewBox={`0 ${top - 12} 640 ${bottom - top + 12}`} role="img" aria-label={`${label}: ${phrase.map(note => `${note.pitch}, ${note.beats}`).join('; ')}`}>
    <text x="4" y="90" className="treble-clef">&#119070;</text>
    {[50, 62, 74, 86, 98].map(line => <line key={line} x1="25" x2="625" y1={line} y2={line} className="staff-line" />)}
    {phrase.map((note, index) => {
      const x = 58 + index * 72, cy = y(note.pitch);
      return <g key={index} className={index === current ? 'current-note' : ''}>
        {index === current && <rect x={x - 24} y={top} width="56" height={bottom - top} rx="8" className="note-highlight" />}
        {Array.from({ length: Math.max(0, Math.floor((cy - 98) / 12)) }, (_, line) =>
          <line key={`below-${line}`} x1={x - 15} x2={x + 15} y1={110 + line * 12} y2={110 + line * 12} className="staff-line" />)}
        {Array.from({ length: Math.max(0, Math.floor((50 - cy) / 12)) }, (_, line) =>
          <line key={`above-${line}`} x1={x - 15} x2={x + 15} y1={38 - line * 12} y2={38 - line * 12} className="staff-line" />)}
        {note.pitch.includes('#') && <text x={x - 24} y={cy + 5}>#</text>}
        <ellipse cx={x} cy={cy} rx="8" ry="5.5" className={note.beats >= 2 ? 'note-head open' : 'note-head'} />
        {note.beats < 4 && <line x1={x + 7} x2={x + 7} y1={cy} y2={cy - 33} className="note-stem" />}
        {note.beats === .5 && <path d={`M${x + 7} ${cy - 33}q18 8 6 22`} className="note-flag" />}
        {(note.beats === 1.5 || note.beats === 3) && <circle cx={x + 15} cy={cy - 2} r="2" className="note-head" />}
        <text x={x} y={bottom - 22} textAnchor="middle">{note.pitch}</text>
        {note.finger && <text x={x} y={bottom - 7} textAnchor="middle" className="note-finger">{note.finger}</text>}
      </g>;
    })}
  </svg>;
}

export default function PianoLesson({ language, active, onContext, soundAllowed = true }: {
  language: Language; active: boolean; onContext(context: string): void; soundAllowed?: boolean;
}) {
  const c = copy(language);
  const [selected, setSelected] = useState('beethoven');
  const [custom, setCustom] = useState<Piece | null>(null);
  const [score, setScore] = useState<Piece | null>(null);
  const [lines, setLines] = useState<ScoreLine[]>([]);
  const [lineIndex, setLineIndex] = useState(0);
  const [loadingScore, setLoadingScore] = useState(false);
  const scoreRequest = useRef<AbortController | null>(null);
  const scoreGeneration = useRef(0);
  const [customTitle, setCustomTitle] = useState('');
  const [source, setSource] = useState('');
  const [permission, setPermission] = useState(false);
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState(0);
  const [tempo, setTempo] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<PianoAudio | null>(null);
  const piece = selected === 'custom' ? custom : selected === 'score' ? score : pieces.find(value => value.id === selected)!;
  const phrase = piece?.phrases[phraseIndex];
  const note = phrase?.[noteIndex];
  const matches = pieces.filter(value => `${value.title} ${value.credit} ${value.id === 'mozart' ? 'Twinkle Twinkle Little Star Mozart' : ''}`
    .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const matchingScores = scoreSources.filter(value => searchKey(`${value.title} ${value.artist}`).includes(searchKey(search)));
  useEffect(() => {
    audio.current = new PianoAudio();
    const pause = () => { setPlaying(false); audio.current?.stopAll(); };
    const hidden = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      scoreGeneration.current++;
      scoreRequest.current?.abort();
      audio.current?.dispose();
      window.removeEventListener('blur', pause);
      window.removeEventListener('pagehide', pause);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    if (!active) {
      setPlaying(false); audio.current?.stopAll();
      scoreGeneration.current++; scoreRequest.current?.abort(); setLoadingScore(false);
    }
  }, [active]);
  useEffect(() => { if (!soundAllowed) audio.current?.stopAll(); }, [soundAllowed]);
  useEffect(() => {
    if (!playing || !active || !note || !phrase) return;
    const timer = setTimeout(() => {
      if (noteIndex + 1 < phrase.length) setNoteIndex(value => value + 1);
      else setPlaying(false);
    }, (note.beats + (phrase[noteIndex + 1]?.restBefore ?? 0)) * 60_000 / tempo);
    return () => clearTimeout(timer);
  }, [playing, active, note, noteIndex, phrase, tempo]);
  useEffect(() => {
    onContext(piece && note ? `Piano piece: ${piece.title}. Phrase ${phraseIndex + 1}. Current note: ${note.pitch}, ${note.beats} beats. ${piece.tip[language]}` : '');
  }, [piece, note, phraseIndex, language, onContext]);

  function reset() {
    scoreGeneration.current++; scoreRequest.current?.abort(); setLoadingScore(false);
    setPlaying(false); audio.current?.stopAll(); setPhraseIndex(0); setNoteIndex(0); setError('');
  }
  async function loadScore(source: typeof scoreSources[number] | File) {
    reset();
    const generation = scoreGeneration.current;
    const controller = new AbortController();
    scoreRequest.current = controller;
    setLoadingScore(true);
    try {
      let data: ArrayBuffer;
      if (source instanceof File) {
        if (!permission || source.size > 1_048_576) throw new Error(c.pianoScoreError);
        data = await source.arrayBuffer();
      } else {
        const response = await fetch(`${import.meta.env.BASE_URL}scores/${source.file}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          credentials: 'omit', cache: 'no-store', redirect: 'error',
        });
        if (!response.ok || Number(response.headers.get('Content-Length')) > 1_048_576) throw new Error(c.pianoScoreError);
        data = await response.arrayBuffer();
      }
      if (controller.signal.aborted || generation !== scoreGeneration.current) return;
      const available = readPianoScore(data);
      const uploaded = source instanceof File;
      setLines(available); setLineIndex(0);
      setScore({ id: 'score', title: uploaded ? customTitle.trim() || c.pianoLessonCustom : source.title,
        credit: uploaded ? c.pianoLessonOwn : `${source.artist} · Mutopia · Public Domain`,
        ...(uploaded ? {} : { source: source.source }), phrases: available[0].phrases,
        tip: { en: copy('en').pianoScoreTip, nb: copy('nb').pianoScoreTip } });
      setSelected('score'); setSearched(false);
    } catch {
      if (!controller.signal.aborted && generation === scoreGeneration.current) setError(c.pianoScoreError);
    } finally {
      if (generation === scoreGeneration.current) { setLoadingScore(false); scoreRequest.current = null; }
    }
  }
  function loadCustom() {
    const tokens = source.trim().split(/\s+/);
    if (!permission || !source.trim() || tokens.length > 128) { setError(c.pianoLessonInvalid); return; }
    const parsed: Note[] = [];
    for (const token of tokens) {
      const match = /^([A-G]#?[45])(?::(0\.5|1|1\.5|2|3|4))?$/.exec(token);
      const pitch = pianoNotes.find(value => value === match?.[1]);
      if (!pitch) { setError(c.pianoLessonInvalid); return; }
      parsed.push({ pitch, beats: match?.[2] ? Number(match[2]) : 1 });
    }
    const phrases: Note[][] = [];
    for (let index = 0; index < parsed.length; index += 8) phrases.push(parsed.slice(index, index + 8));
    reset();
    setCustom({ id: 'custom', title: customTitle.trim() || c.pianoLessonCustom, credit: c.pianoLessonOwn,
      phrases, tip: { en: 'Practise one small phrase slowly. Ask a piano teacher for suitable fingering.', nb: 'Øv sakte på én liten frase. Spør en pianolærer om passende fingersetting.' } });
  }

  return <section className="piano-lesson" aria-label={c.pianoLessonTitle}>
    <h3>{c.pianoLessonTitle}</h3>
    <p>{c.pianoLessonIntro}</p>
    <form onSubmit={event => { event.preventDefault(); setSearched(true); }}>
      <label>{c.pianoLessonSearch}<input value={search} maxLength={100} disabled={!active}
        onChange={event => { setSearch(event.target.value); setSearched(false); }} /></label>
      <button type="submit" disabled={!active || !search.trim()}>{c.pianoLessonFind}</button>
    </form>
    {loadingScore && <p role="status">{c.pianoScoreLoading}</p>}
    {searched && <div role="status">
      {matches.map(match => <button key={match.id} type="button" disabled={!active}
        onClick={() => { reset(); setSelected(match.id); setSearched(false); }}>{match.title} · {match.credit}</button>)
      }
      {matchingScores.map(match => <button key={match.id} type="button" disabled={!active || loadingScore}
        onClick={() => void loadScore(match)}>{match.title} · {match.artist} · {c.pianoScoreFull}</button>)}
      {!matches.length && !matchingScores.length && <p>{c.pianoLessonNoMatch}</p>}
    </div>}
    <label>{c.pianoLessonTheme}<select value={selected} disabled={!active} onChange={event => { reset(); setSelected(event.target.value); }}>
      <option value="beethoven">Beethoven · Ode to Joy</option>
      <option value="mozart">Mozart · Ah! vous dirai-je, maman</option>
      <option value="original">{c.pianoLessonOriginal}</option>
      <option value="custom">{c.pianoLessonCustom}</option>
      {score && <option value="score">{score.title}</option>}
    </select></label>
    {selected === 'custom' && <div className="piano-custom">
      <p className="small">{c.pianoLessonRights}</p>
      <label>{c.pianoLessonName}<input value={customTitle} maxLength={80} onChange={event => setCustomTitle(event.target.value)} /></label>
      <label>{c.pianoLessonNotes}<textarea value={source} maxLength={1600} rows={3} onChange={event => setSource(event.target.value)} /></label>
      <p className="small">{c.pianoLessonFormat}</p>
      <label><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)} />{c.pianoLessonPermission}</label>
      <button type="button" disabled={!active} onClick={loadCustom}>{c.pianoLessonLoad}</button>
      <label>{c.pianoScoreUpload}<input type="file" accept=".mid,.midi,audio/midi,audio/x-midi"
        disabled={!active || !permission || loadingScore} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void loadScore(file);
          event.target.value = '';
        }} /></label>
    </div>}
    {piece && phrase && note && <>
      <h4>{piece.title}</h4>
      <p className="small">{piece.credit}</p>
      {piece.source && <a href={piece.source} target="_blank" rel="noopener noreferrer">{c.pianoScoreSource}</a>}
      {selected === 'score' && <label>{c.pianoScoreLine}<select value={lineIndex} disabled={!active || loadingScore}
        onChange={event => {
          const index = Number(event.target.value);
          reset(); setLineIndex(index); setScore(value => value ? { ...value, phrases: lines[index].phrases } : value);
        }}>{lines.map((line, index) => <option key={index} value={index}>{line.name}</option>)}</select></label>}
      <p>{piece.tip[language]}</p>
      <p>{c.pianoLessonPhrase} {phraseIndex + 1} / {piece.phrases.length} · {c.pianoLessonBeat} {note.beats}</p>
      <div className="staff-scroll"><Staff phrase={phrase} current={noteIndex} label={c.pianoLessonNotation} /></div>
      <p className="current-piano-note" aria-live={playing ? 'off' : 'polite'}>{c.pianoLessonPlay}: <strong>{note.pitch}</strong>
        {note.finger ? ` · ${c.pianoLessonFinger} ${note.finger}` : ''}</p>
      {!!note.restBefore && <p className="small">{c.pianoScoreRest}: {Number(note.restBefore.toFixed(2))} {c.pianoLessonBeat}</p>}
      <label>{c.pianoLessonTempo}<input type="range" min={30} max={100} step={5} value={tempo}
        disabled={!active || playing} onChange={event => setTempo(Number(event.target.value))} /> {tempo} BPM</label>
      <div className="teacher-session-actions">
        <button type="button" disabled={!active || playing || noteIndex === 0} onClick={() => setNoteIndex(value => value - 1)}>{c.pianoLessonPrevious}</button>
        <button type="button" disabled={!active || playing || noteIndex === phrase.length - 1} onClick={() => setNoteIndex(value => value + 1)}>{c.pianoLessonNext}</button>
        <button type="button" disabled={!active} onClick={() => { setPlaying(false); audio.current?.stopAll(); setNoteIndex(0); }}>{c.pianoLessonRepeat}</button>
        <button type="button" disabled={!active} aria-pressed={playing} onClick={() => {
          if (!playing && noteIndex === phrase.length - 1) setNoteIndex(0);
          setPlaying(value => !value);
        }}>{playing ? c.pianoLessonPause : c.pianoLessonFollow}</button>
        <button type="button" disabled={!active || playing || !soundAllowed} onClick={() => {
          void audio.current?.start(note.pitch).catch(failure => setError(failure instanceof Error ? failure.message : c.pianoUnavailable));
        }}>{c.pianoLessonHear}</button>
        <button type="button" disabled={!active || playing || phraseIndex === 0}
          onClick={() => { setPhraseIndex(value => value - 1); setNoteIndex(0); }}>{c.pianoLessonBackPhrase}</button>
        <button type="button" disabled={!active || playing || phraseIndex === piece.phrases.length - 1}
          onClick={() => { setPhraseIndex(value => value + 1); setNoteIndex(0); }}>{c.pianoLessonNextPhrase}</button>
      </div>
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    <p className="small">{c.pianoLessonNoGrading}</p>
  </section>;
}

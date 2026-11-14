import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Api, type Language, type LibraryEntry } from './api';
import { copy, subjectLabel } from './i18n';
import SubjectIcon from './SubjectIcon';
import Quiz from './Quiz';

const PAGE_SIZE = 12;

export default function QuestionLibrary({ api, language, active, disabled, online, onBusyChange, onAsk, onSpeak, onStop, voiceEnabled }: {
  api: Api; language: Language; active: boolean; disabled: boolean; online: boolean;
  onBusyChange(busy: boolean): void; onAsk?(question: string): void; onSpeak?(text: string): void;
  onStop?(): void; voiceEnabled?: boolean;
}) {
  const c = copy(language);
  const [snapshot, setSnapshot] = useState<{ language: Language; questions: LibraryEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('all');
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const loadedAttempt = useRef(-1);
  const back = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLParagraphElement>(null);
  const focusResults = useRef(false);
  const busy = loading || practiceBusy;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!active || !online || (snapshot?.language === language && loadedAttempt.current === attempt)) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const deadline = setTimeout(() => {
      controller.abort(); setLoading(false); setError(c.libraryTimeout);
    }, 30_000);
    void api.library(language, controller.signal).then(questions => {
      if (controller.signal.aborted) return;
      loadedAttempt.current = attempt;
      setSnapshot({ language, questions }); setDenied(false); setPage(0);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setError(`${c.libraryFailed} ${error instanceof Error ? error.message : ''}`);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setSnapshot(null); setSelectedId(null); setDenied(true);
      }
    }).finally(() => {
      clearTimeout(deadline);
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { clearTimeout(deadline); controller.abort(); setLoading(false); };
  }, [api, active, online, language, attempt, c.libraryFailed, c.libraryTimeout]);
  useEffect(() => {
    if (selectedId) back.current?.focus();
  }, [selectedId]);
  useEffect(() => {
    if (focusResults.current) { results.current?.focus(); focusResults.current = false; }
  }, [page]);
  const questions = snapshot?.language === language ? snapshot.questions : [];
  const choices = useMemo(() => [...new Set(questions.map(question => question.subject))], [questions]);
  const matches = useMemo(() => {
    const term = search.trim().normalize('NFKC').toLowerCase();
    return questions.filter(question => (subject === 'all' || question.subject === subject) &&
      (level === 'all' || String(question.level) === level) &&
      `${question.question} ${question.goal} ${subjectLabel(question.subject, language)}`.normalize('NFKC').toLowerCase().includes(term));
  }, [questions, search, subject, level, language]);
  const levels = { 1: c.libraryLevel1, 2: c.libraryLevel2, 3: c.libraryLevel3 };
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const selected = questions.find(question => question.id === selectedId);
  const unavailable = disabled || busy || denied;
  return <section className="question-library" aria-label={c.libraryMode}>
    {selected ? <div className="library-practice">
      <button type="button" ref={back} disabled={unavailable} onClick={() => {
        onStop?.(); setSelectedId(null);
      }}>← {c.libraryBack}</button>
      <p className="library-meta">{subjectLabel(selected.subject, language)} · {levels[selected.level]}</p>
      <Quiz key={`${selected.id}-${language}`} api={api} subject={selected.subject} libraryQuestion={selected}
        language={language} online={online} disabled={disabled || loading || denied} onBusyChange={setPracticeBusy}
        onAsk={onAsk} onSpeak={onSpeak} onStop={onStop} voiceEnabled={voiceEnabled} />
    </div> : <>
      <header className="library-hero">
        <span className="library-hero-icon" aria-hidden="true"><SubjectIcon subject="english" /></span>
        <div><p className="eyebrow">{c.librarySafety}</p><h2>{c.libraryTitle}</h2><p>{c.libraryIntro}</p></div>
      </header>
      <details className="library-about"><summary>{c.libraryAbout}</summary><p>{c.libraryScope}</p><p>{c.libraryLevelGuide}</p></details>
      <div className="library-filters">
        <label className="library-search">{c.librarySearch}<input type="search" value={search} maxLength={120}
          disabled={disabled || busy} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
        <label>{c.librarySubject}<select value={subject} disabled={disabled || busy} onChange={event => {
          setSubject(event.target.value); setPage(0);
        }}><option value="all">{c.libraryAll}</option>{choices.map(value =>
          <option key={value} value={value}>{subjectLabel(value, language)}</option>)}</select></label>
        <label>{c.libraryLevel}<select value={level} disabled={disabled || busy} onChange={event => {
          setLevel(event.target.value); setPage(0);
        }}><option value="all">{c.libraryAllLevels}</option>
          <option value="1">{c.libraryLevel1}</option><option value="2">{c.libraryLevel2}</option>
          <option value="3">{c.libraryLevel3}</option></select></label>
      </div>
      {questions.length > 0 && <p className="library-results" role="status" ref={results} tabIndex={-1}>
        {matches.length} {c.libraryMatches} · {c.libraryPage} {page + 1} {c.libraryOf} {pageCount}</p>}
      <div className="library-grid">
        {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(question => <article className="library-card" key={question.id}>
          <div className="library-card-top"><span className="library-card-icon" aria-hidden="true"><SubjectIcon subject={question.subject} /></span>
            <span>{subjectLabel(question.subject, language)}</span><span className="library-level">{levels[question.level]}</span></div>
          <h3>{question.question}</h3><p className="small">{question.goal}</p>
          <button type="button" disabled={unavailable} onClick={() => setSelectedId(question.id)}
            aria-label={`${c.libraryOpen}: ${question.question}`}>{c.libraryOpen} →</button>
        </article>)}
      </div>
      {questions.length > 0 && matches.length === 0 && <p className="notice">{c.libraryEmpty}</p>}
      {pageCount > 1 && <nav className="library-pages" aria-label={c.libraryPage}>
        <button type="button" disabled={disabled || busy || page === 0} onClick={() => {
          focusResults.current = true; setPage(value => value - 1);
        }}>← {c.libraryPrevious}</button>
        <span>{page + 1} / {pageCount}</span>
        <button type="button" disabled={disabled || busy || page + 1 >= pageCount} onClick={() => {
          focusResults.current = true; setPage(value => value + 1);
        }}>{c.libraryNext} →</button>
      </nav>}
    </>}
    {loading && <p role="status">{c.libraryLoading}</p>}
    {!online && <p className="notice">{c.libraryOffline}</p>}
    {error && <><p role="alert" className="error-banner">{error}</p>
      {questions.length > 0 && <p className="notice">{c.libraryStale}</p>}</>}
    {!selected && <button type="button" className="quiet library-reload" disabled={disabled || busy || !online}
      onClick={() => setAttempt(value => value + 1)}>{c.libraryRetry}</button>}
  </section>;
}

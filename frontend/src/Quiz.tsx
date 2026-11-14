import { useEffect, useRef, useState } from 'react';
import type { Api, Language, QuizAnswer, QuizAttempt, QuizQuestion } from './api';
import { copy } from './i18n';

function MissionVisual({ visual, label, filledLabel, partsLabel, lineLabel, fromLabel, toLabel }: {
  visual: NonNullable<QuizQuestion['visual']>; label: string; filledLabel: string; partsLabel: string;
  lineLabel: string; fromLabel: string; toLabel: string;
}) {
  if (visual.kind === 'array') {
    const icon = { star: '⭐', apple: '🍎', leaf: '🍃', note: '♫', drop: '💧' }[visual.icon];
    return <div className="mission-array" role="img" aria-label={`${visual.rows} × ${visual.columns} ${icon}`}
      style={{ gridTemplateColumns: `repeat(${visual.columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: visual.rows * visual.columns }, (_, index) => <span key={index} aria-hidden="true">{icon}</span>)}
    </div>;
  }
  if (visual.kind === 'fraction') {
    return <div className="mission-fraction" role="img"
      aria-label={`${visual.filled} ${filledLabel}, ${visual.parts} ${partsLabel}`}
      style={{ gridTemplateColumns: `repeat(${visual.parts}, minmax(0, 1fr))` }}>
      {Array.from({ length: visual.parts }, (_, index) =>
        <span key={index} className={index < visual.filled ? 'filled' : ''} aria-hidden="true" />)}
    </div>;
  }
  if (visual.kind === 'numberLine') {
    return <div className="mission-numberline" role="img"
      aria-label={`${lineLabel}. ${fromLabel}: ${visual.from}. ${toLabel}: ${visual.to}.`}>
      <div className="numberline-ticks" aria-hidden="true">
        {Array.from({ length: 11 }, (_, number) => <span key={number}
          className={number === visual.from ? 'line-start' : number === visual.to ? 'line-end' : ''}>
          <strong>{number}</strong></span>)}
      </div>
      <div className="numberline-key" aria-hidden="true">
        <span><b className="line-start">{visual.from}</b> {fromLabel}</span>
        <span><b className="line-end">{visual.to}</b> {toLabel}</span>
      </div>
    </div>;
  }
  const icon = { timeline: '◷', places: '◎', words: 'Aa', sequence: '✦' }[visual.style];
  return <div className={`mission-cards ${visual.style}`} role="group" aria-label={label}>
    {visual.items.map((item, index) => <div className="mission-card" key={`${index}-${item}`}>
      <span aria-hidden="true">{icon}</span><strong>{item}</strong></div>)}
  </div>;
}

export default function Quiz({ api, subject, language, disabled, online, onBusyChange, onSpeak, onAsk, onStop, voiceEnabled = false }: {
  api: Api; subject: string; language: Language; disabled: boolean; online: boolean;
  onBusyChange(busy: boolean): void;
  onSpeak?(text: string): void;
  onAsk?(question: string): void;
  onStop?(): void;
  voiceEnabled?: boolean;
}) {
  const c = copy(language);
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [answerIndex, setAnswerIndex] = useState<number | null>(null);
  const [result, setResult] = useState<QuizAnswer | null>(null);
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [busyAction, setBusyAction] = useState<'start' | 'answer' | 'refresh' | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [stale, setStale] = useState(false);
  const [practiceLanguage, setPracticeLanguage] = useState('Spanish');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [api]);
  async function run(action: 'start' | 'answer' | 'refresh') {
    if (request.current || disabled || !online || (blocked && action !== 'refresh')) return;
    const controller = new AbortController();
    request.current = controller; setBusyAction(action); setError('');
    try {
      if (action === 'start') {
        const fresh = await api.quiz(subject === 'otherLanguages' ? practiceLanguage : subject, language, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setQuestion(fresh); setAnswerIndex(null); setResult(null);
        onSpeak?.(fresh.lesson ? `${fresh.lesson} ${fresh.question}` : fresh.question);
      } else {
        if (action === 'answer') {
          if (!question || answerIndex === null || result) return;
          const response = await api.answerQuiz(question.id, answerIndex, controller.signal);
          if (!mounted.current || controller.signal.aborted) return;
          setResult(response);
          onSpeak?.(response.explanation);
        }
        const history = await api.quizAttempts(controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setAttempts(history); setStale(false);
        if (action === 'refresh' && blocked) { setQuestion(null); setResult(null); setAnswerIndex(null); }
        setBlocked(false);
      }
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(`${action === 'start' ? c.quizFailed : c.practiceStale} ${error instanceof Error ? error.message : ''}${action === 'answer' ? ` ${c.quizAmbiguous}` : ''}`);
      if (action !== 'start') setStale(true);
      if (action === 'answer') setBlocked(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusyAction(null);
      }
    }
  }
  const unavailable = disabled || busy || !online || blocked;
  const visualClue = question?.visual?.kind === 'array'
    ? `${question.visual.rows} × ${question.visual.columns} ${question.visual.icon}`
    : question?.visual?.kind === 'fraction'
      ? `${question.visual.filled} ${c.missionFilled}, ${question.visual.parts} ${c.missionParts}`
      : question?.visual?.kind === 'numberLine'
        ? `${c.missionLine}. ${c.missionFrom}: ${question.visual.from}. ${c.missionTo}: ${question.visual.to}.`
      : question?.visual?.kind === 'cards' ? question.visual.items.join(' · ') : '';
  return <section className="quiz-panel" aria-label={c.missionTitle}>
    <div className="mission-heading"><span className="mission-icon" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <path d="M32 5 38 22 56 19 47 34 57 48 39 47 32 59 25 47 7 48 17 34 8 19 26 22Z" />
        <circle cx="25" cy="33" r="2" /><circle cx="39" cy="33" r="2" />
        <path className="mission-smile" d="M27 40 Q32 45 37 40" />
      </svg></span>
      <div><p className="mission-kicker">{c.missionKicker}</p><h2>{c.missionTitle}</h2>{!question && <p>{c.missionIntro}</p>}</div></div>
    <p className="small mission-safety">{c.missionSafety}</p>
    <details className="mission-details"><summary>{c.missionDetails}</summary>
      <p className="small">{c.quizWarning}</p><p className="small">{c.missionScope}</p>
    </details>
    {subject === 'currentAffairs' ? <p>{c.missionNews}</p> : <>
    {subject === 'otherLanguages' && <label className="mission-language">{c.missionLanguage}
      <select value={practiceLanguage} disabled={unavailable || (!!question && !result)} onChange={event => {
        setPracticeLanguage(event.target.value); setQuestion(null); setResult(null); setAnswerIndex(null);
      }}><option value="Spanish">{c.missionSpanish}</option><option value="French">{c.missionFrench}</option>
        <option value="German">{c.missionGerman}</option></select></label>}
    {!question && <button type="button" className="primary mission-start" disabled={unavailable}
      onClick={() => void run('start')}>{c.missionStart} ✦</button>}
    {question && <form onSubmit={event => { event.preventDefault(); void run('answer'); }}>
      {question.topic && <p className="mission-topic"><span>{c.missionTopic}</span> {question.topic}</p>}
      {question.lesson && <div className="mission-lesson">
        <p className="mission-step">{c.missionLearn}</p><p>{question.lesson}</p>
      </div>}
      <p className="mission-step">{c.missionLook}</p>
      <h2>{question.question}</h2>
      {voiceEnabled && onSpeak && <button className="link-button" type="button" disabled={unavailable}
        onClick={() => onSpeak(question.lesson ? `${question.lesson} ${question.question}` : question.question)}>{c.missionRead} ♪</button>}
      {question.visual ? <MissionVisual visual={question.visual} label={c.missionVisual}
        filledLabel={c.missionFilled} partsLabel={c.missionParts} lineLabel={c.missionLine}
        fromLabel={c.missionFrom} toLabel={c.missionTo} /> : <p className="small">{c.missionNoVisual}</p>}
      <fieldset disabled={unavailable || result !== null}>
        <legend><span className="mission-step">{c.missionTry}</span><br />{c.quizChoices}</legend>
        {question.options.map((option, index) => <label key={index} className="quiz-option">
          <input type="radio" name={`quiz-${question.id}`} checked={answerIndex === index} value={index}
            onChange={() => setAnswerIndex(index)} />{option}
        </label>)}
      </fieldset>
      <button type="submit" disabled={unavailable || answerIndex === null || !!result}>{c.quizAnswer}</button>
      {onAsk && !result && <button className="mission-hint" type="button" disabled={unavailable}
        onClick={() => onAsk(`${c.missionAskDraft}${question.lesson ? ` ${question.lesson}` : ''} ${question.question}${visualClue ? ` ${c.missionVisual}: ${visualClue}` : ''}`)}>{c.missionAsk}</button>}
      {!result && <button type="button" disabled={unavailable} onClick={() => {
        onStop?.(); setQuestion(null); setAnswerIndex(null);
      }}>{c.missionSkip}</button>}
    </form>}
    {busy && <p role="status">{busyAction === 'start' ? c.missionLoading : busyAction === 'refresh' ? c.missionRefreshing : c.quizChecking}</p>}
    {result && question && <div className="quiz-result" role="status">
      <h2>{result.correct ? c.quizCorrect : c.quizTry}</h2>
      <p>{c.quizCorrectChoice}: {question.options[result.correctIndex]}</p><p>{result.explanation}</p>
    </div>}
    {question && <button type="button" className="primary mission-next" disabled={unavailable || !result}
      onClick={() => void run('start')}>{c.missionNext} ✦</button>}
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {stale && <p className="notice">{c.practiceStale}</p>}
    {attempts !== null && <p>{attempts.length} {c.quizStored} · {attempts.filter(attempt => attempt.correct).length} {c.storedCorrect}</p>}
    <button type="button" disabled={disabled || busy || !online} onClick={() => void run('refresh')}>{c.refreshPractice}</button>
    <p className="small">{c.practiceMeasure}</p>
  </section>;
}

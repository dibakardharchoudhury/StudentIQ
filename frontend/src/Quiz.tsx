import { useEffect, useRef, useState } from 'react';
import type { Api, Language, QuizAnswer, QuizAttempt, QuizQuestion } from './api';
import { copy } from './i18n';

export default function Quiz({ api, subject, language, disabled, online, onBusyChange }: {
  api: Api; subject: string; language: Language; disabled: boolean; online: boolean;
  onBusyChange(busy: boolean): void;
}) {
  const c = copy(language);
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [answerIndex, setAnswerIndex] = useState<number | null>(null);
  const [result, setResult] = useState<QuizAnswer | null>(null);
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [stale, setStale] = useState(false);
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
    request.current = controller; setBusy(true); setError('');
    try {
      if (action === 'start') {
        const fresh = await api.quiz(subject, language, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setQuestion(fresh); setAnswerIndex(null); setResult(null);
      } else {
        if (action === 'answer') {
          if (!question || answerIndex === null || result) return;
          const response = await api.answerQuiz(question.id, answerIndex, controller.signal);
          if (!mounted.current || controller.signal.aborted) return;
          setResult(response);
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
        if (mounted.current) setBusy(false);
      }
    }
  }
  const unavailable = disabled || busy || !online || blocked;
  return <details className="quiz-panel">
    <summary>{c.quizTitle}</summary>
    <p className="small">{c.quizWarning}</p>
    <button type="button" disabled={unavailable || (!!question && !result)} onClick={() => void run('start')}>{c.quizStart}</button>
    {question && <form onSubmit={event => { event.preventDefault(); void run('answer'); }}>
      <h2>{question.question}</h2>
      <fieldset disabled={unavailable || result !== null}>
        <legend>{c.quizChoices}</legend>
        {question.options.map((option, index) => <label key={index} className="quiz-option">
          <input type="radio" name={`quiz-${question.id}`} checked={answerIndex === index} value={index}
            onChange={() => setAnswerIndex(index)} />{option}
        </label>)}
      </fieldset>
      <button type="submit" disabled={unavailable || answerIndex === null || !!result}>{c.quizAnswer}</button>
    </form>}
    {busy && <p role="status">{c.quizChecking}</p>}
    {result && question && <div className="quiz-result" role="status">
      <h2>{result.correct ? c.quizCorrect : c.quizTry}</h2>
      <p>{c.quizCorrectChoice}: {question.options[result.correctIndex]}</p><p>{result.explanation}</p>
    </div>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {stale && <p className="notice">{c.practiceStale}</p>}
    {attempts !== null && <p>{attempts.length} {c.quizStored} · {attempts.filter(attempt => attempt.correct).length} {c.storedCorrect}</p>}
    <button type="button" disabled={disabled || busy || !online} onClick={() => void run('refresh')}>{c.refreshPractice}</button>
    <p className="small">{c.practiceMeasure}</p>
  </details>;
}

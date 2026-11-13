import { useEffect, useRef, useState } from 'react';
import type { Api, Language } from './api';
import { copy } from './i18n';

export default function PracticeProgress({ api, language, online }: { api: Api; language: Language; online: boolean }) {
  const c = copy(language);
  const [counts, setCounts] = useState<{
    piano: { total: number; correct: number } | null;
    quiz: { total: number; correct: number } | null;
  }>({ piano: null, quiz: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    void refresh();
    return () => { request.current?.abort(); request.current = null; };
  }, [api]);
  async function refresh() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const [piano, quiz] = await Promise.allSettled([api.pianoAttempts(controller.signal), api.quizAttempts(controller.signal)]);
      if (controller.signal.aborted) return;
      setCounts(previous => ({
        piano: piano.status === 'fulfilled'
          ? { total: piano.value.length, correct: piano.value.filter(attempt => attempt.correct).length } : previous.piano,
        quiz: quiz.status === 'fulfilled'
          ? { total: quiz.value.length, correct: quiz.value.filter(attempt => attempt.correct).length } : previous.quiz,
      }));
      const failed = [piano.status === 'rejected' ? c.piano : '', quiz.status === 'rejected' ? c.quizTitle : ''].filter(Boolean);
      if (failed.length) setError(`${failed.join(' · ')}: ${c.practiceStale}`);
    } catch {
      if (!controller.signal.aborted) setError(c.practiceStale);
      controller.abort();
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return <section className="practice-summary" aria-label={c.practiceProgress}>
    <h2>{c.practiceProgress}</h2><p className="small">{c.quizWarning}</p>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">{c.loadingHistory}</p>}
    <div className="stats-grid">
      {counts.piano && <article className="stat"><strong>{counts.piano.total}</strong><span>{c.pianoStored}</span><p>{counts.piano.correct} {c.storedCorrect}</p></article>}
      {counts.quiz && <article className="stat"><strong>{counts.quiz.total}</strong><span>{c.quizStored}</span><p>{counts.quiz.correct} {c.storedCorrect}</p></article>}
    </div>
    <button disabled={busy || !online} onClick={() => void refresh()}>{c.refreshPractice}</button>
    <p className="small">{c.practiceMeasure}</p>
  </section>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, DailyLesson, Language, Preferences, QuizQuestion } from './api';
import { copy, subjectLabel } from './i18n';
import { MissionVisual } from './Quiz';
import { Speech } from './speech';
import PianoLesson from './PianoLesson';

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[.,!?;:]/g, '').trim();

export default function TeacherSession({ api, subject, language, preferences, active, online, onSpeaking, onBusyChange, onDraftChange }: {
  api: Api; subject: string; language: Language; preferences: Preferences | null;
  active: boolean; online: boolean;
  onSpeaking(active: boolean): void;
  onBusyChange(busy: boolean): void;
  onDraftChange?(hasDraft: boolean): void;
}) {
  const c = copy(language);
  const [welcome] = useState(() => {
    const weekday = new Date().getDay();
    return weekday > 0 && weekday < 6 ? c.teacherWelcomeSchool : c.teacherWelcomeDay;
  });
  const [reply, setReply] = useState(welcome);
  const spokenReply = useRef(welcome);
  const [heard, setHeard] = useState('');
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [completed, setCompleted] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [ended, setEnded] = useState(false);
  const [done, setDone] = useState(false);
  const [practiceLanguage, setPracticeLanguage] = useState('Spanish');
  const [lessonDate, setLessonDate] = useState('');
  const [lessonReady, setLessonReady] = useState(subject === 'piano');
  const [lessonFailed, setLessonFailed] = useState(false);
  const lesson = useRef<DailyLesson | null>(null);
  const restoredLanguage = useRef(false);
  const [handsFree, setHandsFree] = useState(false);
  const [mode, setMode] = useState<'idle' | 'starting' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const speech = useRef<Speech | null>(null);
  const request = useRef<AbortController | null>(null);
  const pendingWrites = useRef(false);
  const mounted = useRef(false);
  const enabled = useRef(false);
  const currentQuestion = useRef<QuizQuestion | null>(null);
  const count = useRef(0);
  const sessionId = useRef<string | undefined>(undefined);
  const pianoContext = useRef('');
  const updatePianoContext = useCallback((value: string) => { pianoContext.current = value; }, []);
  const submit = useRef<(text: string) => void>(() => {});
  const busy = mode === 'thinking' || mode === 'speaking';
  const speakingChanged = useRef(onSpeaking);
  speakingChanged.current = onSpeaking;
  const lessonSubject = subject === 'otherLanguages' ? practiceLanguage : subject;

  function applyLesson(saved: DailyLesson) {
    lesson.current = saved;
    count.current = saved.completed;
    setCompleted(saved.completed);
    setLessonDate(saved.date);
    const current = saved.answer ? null : saved.current;
    currentQuestion.current = current;
    setQuestion(current);
    if (current) {
      spokenReply.current = [`${c.teacherLesson} ${saved.completed + 1}.`, current.lesson, current.question,
        ...current.options.map((option, index) => `${index + 1}: ${option}.`), c.teacherChoice].filter(Boolean).join(' ');
      setReply(c.teacherQuestionIntro);
    } else if (!saved.answer) {
      spokenReply.current = welcome;
      setReply(welcome);
    } else if (saved.completed >= saved.target) {
      spokenReply.current = c.teacherDone;
      setReply(c.teacherDone);
    }
    setDone(saved.completed >= saved.target && !current);
    if (saved.answer && saved.current) {
      setFeedback(`${saved.answer.correct ? c.quizCorrect : c.quizTry} ${c.teacherAnswer}: ${saved.current.options[saved.answer.correctIndex]}. ${saved.answer.explanation}`);
    } else setFeedback('');
  }

  useEffect(() => {
    if (subject === 'piano') { setLessonReady(true); return; }
    const controller = new AbortController();
    setLessonReady(false);
    setLessonFailed(false);
    lesson.current = null;
    currentQuestion.current = null;
    setQuestion(null);
    setCompleted(0);
    count.current = 0;
    setDone(false);
    setFeedback('');
    if (active && online) {
      const restoreSelection = subject === 'otherLanguages' && !restoredLanguage.current;
      void api.dailyLesson(restoreSelection ? 'otherLanguages' : lessonSubject, language, controller.signal).then(saved => {
        if (controller.signal.aborted) return;
        if (restoreSelection) {
          restoredLanguage.current = true;
          if (['Spanish', 'French', 'German'].includes(saved.subject)) setPracticeLanguage(saved.subject);
        }
        applyLesson(saved);
        setLessonReady(true);
      }).catch(failure => {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : c.voiceError);
        setLessonFailed(true);
      });
    }
    return () => controller.abort();
  }, [api, lessonSubject, language, active, online]);

  useEffect(() => {
    if (subject === 'piano' || !active || !online || !lessonDate) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (request.current || lessonDate === new Date().toISOString().slice(0, 10)) return;
      void api.dailyLesson(lessonSubject, language, controller.signal).then(saved => {
        if (!controller.signal.aborted && !request.current) applyLesson(saved);
      }).catch(() => { /* Keep saved progress visible until an explicit request can report the failure. */ });
    }, 60_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [api, lessonSubject, language, active, online, lessonDate]);

  function pauseVoice() {
    enabled.current = false;
    setHandsFree(false);
    speech.current?.cancel();
    setHeard('');
    setMode('idle');
  }

  function interrupt() {
    pauseVoice();
    if (request.current) {
      request.current.abort();
      request.current = null;
      if (pendingWrites.current) { setBlocked(true); setError(c.teacherUncertain); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    speech.current = new Speech(signal => api.speechToken(signal), value => {
      if (mounted.current) speakingChanged.current(value);
    });
    const leave = () => interrupt();
    const hidden = () => { if (document.hidden) leave(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') leave(); };
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('offline', leave);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      enabled.current = false;
      speech.current?.cancel();
      request.current?.abort();
      request.current = null;
      window.removeEventListener('blur', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('offline', leave);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [api]);

  useEffect(() => {
    if (!active || !online) interrupt();
  }, [active, online]);
  useEffect(() => {
    onBusyChange(busy || handsFree);
    return () => onBusyChange(false);
  }, [busy, handsFree, onBusyChange]);
  useEffect(() => { onDraftChange?.(!!draft.trim()); }, [draft, onDraftChange]);
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  function voiceFailed(failure: Error) {
    if (!mounted.current) return;
    pauseVoice();
    setError(failure.message);
  }

  function listenNext() {
    if (!enabled.current || !mounted.current) return;
    setMode('starting');
    void speech.current?.listen(language, text => {
      if (!mounted.current || !enabled.current) return;
      setHeard('');
      setMode('idle');
      if (text.trim()) submit.current(text.trim());
      else voiceFailed(new Error(c.teacherNoSpeech));
    }, voiceFailed, {
      partial: text => { if (mounted.current && enabled.current) setHeard(text); },
      ready: () => { if (mounted.current && enabled.current) setMode('listening'); },
    });
  }

  async function deliver(text: string, signal: AbortSignal, display = text) {
    if (signal.aborted || !mounted.current) return;
    spokenReply.current = text;
    setReply(display);
    if (enabled.current) {
      setMode('speaking');
      await speech.current?.say(text, language, preferences?.voice ?? 'default');
      signal.throwIfAborted();
    }
  }

  async function run(action: (signal: AbortSignal) => Promise<void>, writes = true) {
    if (request.current || blocked || !active || !online || ended) return;
    speech.current?.cancel();
    setHeard('');
    const controller = new AbortController();
    request.current = controller;
    pendingWrites.current = writes;
    setMode('thinking');
    setError('');
    let succeeded = false;
    try {
      await action(controller.signal);
      succeeded = !controller.signal.aborted;
    } catch (failure) {
      if (controller.signal.aborted || !mounted.current) return;
      pauseVoice();
      setError(`${failure instanceof Error ? failure.message : c.voiceError}${pendingWrites.current ? ` ${c.teacherUncertain}` : ''}`);
      if (pendingWrites.current) setBlocked(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) {
          setMode('idle');
          if (succeeded) listenNext();
        }
      }
    }
  }

  async function loadQuestion(signal: AbortSignal) {
    setMode('thinking');
    const saved = await api.nextLessonQuestion(lessonSubject, language, signal);
    if (signal.aborted || !mounted.current) return;
    applyLesson(saved);
    const fresh = saved.answer ? null : saved.current;
    if (!fresh) return;
    await deliver([
      `${c.teacherLesson} ${count.current + 1}.`,
      fresh.lesson, fresh.question,
      ...fresh.options.map((option, index) => `${index + 1}: ${option}.`),
      c.teacherChoice,
    ].filter(Boolean).join(' '), signal, c.teacherQuestionIntro);
  }

  function answer(index: number) {
    const current = currentQuestion.current;
    if (!current) return;
    void run(async signal => {
      setLessonFailed(true);
      const saved = await api.answerLesson(lessonSubject, language, lesson.current!.date, current.id, index, signal);
      if (signal.aborted || !mounted.current) return;
      pendingWrites.current = false;
      setLessonFailed(false);
      applyLesson(saved.lesson);
      const result = saved.result;
      const explanation = `${result.correct ? c.quizCorrect : c.quizTry} ${c.teacherAnswer}: ${current.options[result.correctIndex]}. ${result.explanation}`;
      setFeedback(explanation);
      await deliver(explanation, signal);
      if (signal.aborted) return;
      if (saved.lesson.completed >= 10) {
        setDone(true);
        await deliver(c.teacherDone, signal);
        pauseVoice();
      } else {
        await loadQuestion(signal);
      }
    });
  }

  function receive(text: string) {
    const clean = normalize(text);
    if (['end lesson', 'end session', 'stop listening', 'stop conversation', 'avslutt timen', 'avslutt økten', 'stopp samtalen'].includes(clean)) {
      interrupt(); setEnded(true); return;
    }
    if (!currentQuestion.current && subject !== 'piano' &&
      ['start lesson', 'start the lesson', 'ready', "i'm ready", 'next question', 'start timen', 'jeg er klar', 'neste spørsmål'].includes(clean)) {
      void run(loadQuestion, false);
      return;
    }
    const current = currentQuestion.current;
    if (current) {
      const named = /^(?:option|choice|alternativ|svaralternativ)\s+(one|two|three|four|en|ett|to|tre|fire|[1-4])$/.exec(clean);
      const numbers: Record<string, number> = { one: 0, two: 1, three: 2, four: 3, en: 0, ett: 0, to: 1, tre: 2, fire: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
      const matching = current.options.flatMap((option, index) => normalize(option) === clean ? [index] : []);
      const index = named ? numbers[named[1]] : matching.length === 1 ? matching[0] : undefined;
      if (index !== undefined) { setDraft(''); answer(index); return; }
    }
    if (text.length > 700) { pauseVoice(); setDraft(text); setError(c.messageTooLong); return; }
    setDraft(text);
    void run(async signal => {
      const guidance = current || subject === 'piano' ? c.teacherHelpPrompt : c.teacherReadyPrompt;
      const context = [
        subject === 'otherLanguages' ? practiceLanguage : '',
        subject === 'piano' ? pianoContext.current
          : current ? `${current.question} ${JSON.stringify(current.options)}` : '',
      ].filter(Boolean).join('\n');
      const message = `${guidance}${text}${context ? `\n${context.slice(0, Math.max(0, 1199 - guidance.length - text.length))}` : ''}`;
      const response = await api.chat({
        sessionId: sessionId.current, subject, language,
        message,
        ...(preferences ? { mood: preferences.mood } : {}),
      }, signal);
      if (signal.aborted || !mounted.current) return;
      sessionId.current = response.sessionId;
      pendingWrites.current = false;
      setDraft('');
      await deliver(response.reply, signal);
    });
  }
  submit.current = receive;

  function enableConversation() {
    if (request.current || blocked || !online || !active || ended) return;
    enabled.current = true;
    setHandsFree(true);
    void run(async signal => { await deliver(spokenReply.current, signal, reply); }, false);
  }

  const unavailable = busy || blocked || !online || ended || (subject !== 'piano' && !lessonReady);
  const modeText = mode === 'starting' ? c.teacherStarting : mode === 'listening' ? c.teacherListening
    : mode === 'thinking' ? c.teacherThinking : mode === 'speaking' ? c.teacherSpeakingNow : c.micOff;
  return <section className="guided-teacher" aria-label={c.teacherSession}>
    <h2>{c.teacherSession}</h2>
    <p className="small">{subjectLabel(subject, language)}{subject !== 'piano' && ` · ${completed} / 10 ${c.teacherCompleted}${lessonDate ? ` · ${lessonDate} (UTC)` : ''}`}</p>
    {subject === 'otherLanguages' && <label>{c.missionLanguage}
      <select value={practiceLanguage} disabled={!lessonReady || busy || blocked || !online || ended || handsFree || !!question || completed > 0 || !!sessionId.current}
        onChange={event => setPracticeLanguage(event.target.value)}>
        <option value="Spanish">{c.missionSpanish}</option><option value="French">{c.missionFrench}</option>
        <option value="German">{c.missionGerman}</option>
      </select>
    </label>}
    <div className="teacher-bubble" aria-live="polite">{ended ? c.teacherEnded : reply}</div>
    {feedback && <p className="notice">{feedback}</p>}
    <div className="teacher-session-actions">
      {!ended && !handsFree && <button type="button" className="primary" disabled={unavailable}
        onClick={enableConversation}>{c.teacherHandsFree}</button>}
      {!ended && handsFree && <button type="button" onClick={() => {
        pauseVoice();
        if (request.current) setMode('thinking');
      }}>{c.teacherPauseVoice}</button>}
      {!ended && <button type="button" onClick={() => { interrupt(); setEnded(true); }}>{c.teacherEnd}</button>}
      {ended && !blocked && <button type="button" onClick={() => { setEnded(false); setError(''); }}>{c.teacherResume}</button>}
      {!ended && !question && !done && subject !== 'piano' && <button type="button" disabled={unavailable}
        onClick={() => void run(loadQuestion, false)}>{completed ? c.teacherNext : c.teacherStartLesson}</button>}
      {done && !ended && <button type="button" disabled={unavailable}
        onClick={() => void run(loadQuestion, false)}>{c.teacherMore}</button>}
    </div>
    {!ended && <>
      <p className="small">{c.teacherHandsFreeNote}</p>
      <p role="status">{modeText}</p>
      {heard && <p className="notice" role="status">{heard}</p>}
      {subject === 'piano' && <PianoLesson language={language} active={active && !unavailable} soundAllowed={!handsFree}
        onContext={updatePianoContext} />}
      {question && <div className="guided-question">
        <p>{c.teacherLesson} {completed + 1} / {Math.max(10, completed + 1)}</p>
        {question.lesson && <p>{question.lesson}</p>}
        <h3>{question.question}</h3>
        {question.visual && <MissionVisual visual={question.visual} label={c.missionVisual}
          filledLabel={c.missionFilled} partsLabel={c.missionParts} lineLabel={c.missionLine}
          fromLabel={c.missionFrom} toLabel={c.missionTo} />}
        <div className="guided-choices" role="group" aria-label={c.quizChoices}>
          {question.options.map((option, index) => <button type="button" key={index} disabled={unavailable}
            onClick={() => answer(index)}>{index + 1}. {option}</button>)}
        </div>
      </div>}
      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !unavailable) receive(draft.trim()); }}>
        <label htmlFor="teacher-reply">{c.teacherType}</label>
        <textarea id="teacher-reply" rows={2} maxLength={700} value={draft} disabled={unavailable}
          onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={unavailable || !draft.trim()}>{c.teacherSend}</button>
      </form>
    </>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {lessonFailed && online && !busy && <button type="button" onClick={() => {
      const controller = new AbortController();
      request.current = controller;
      pendingWrites.current = false;
      setMode('thinking');
      void api.dailyLesson(lessonSubject, language, controller.signal).then(saved => {
        if (controller.signal.aborted || !mounted.current) return;
        applyLesson(saved); setLessonReady(true); setLessonFailed(false); setBlocked(false); setError('');
      }).catch(failure => {
        if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : c.voiceError);
      }).finally(() => {
        if (request.current === controller) { request.current = null; if (mounted.current) setMode('idle'); }
      });
    }}>{language === 'nb' ? 'Sjekk lagret fremgang' : 'Check saved progress'}</button>}
  </section>;
}

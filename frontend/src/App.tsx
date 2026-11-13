import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Api, type Language, type Preferences, type Role, type Session, type SessionDetail } from './api';
import { ParentAuth } from './auth';
import { loadConfig } from './config';
import type { AppConfig } from './config';
import GoogleSignIn from './GoogleSignIn';
import { copy, subjects, subjectIcons, subjectLabel } from './i18n';
import { Speech } from './speech';
import Teacher from './Teacher';
import FractionExplorer from './FractionExplorer';
import { ArrayExplorer, SentenceBuilder, WaterCycle } from './VisualActivities';
import PlanningCalendar from './PlanningCalendar';
import AccessManagement from './AccessManagement';
import Piano from './Piano';
import TeacherSettings from './TeacherSettings';
import GentleCheckIn from './GentleCheckIn';
import Quiz from './Quiz';
import PracticeProgress from './PracticeProgress';

type Runtime = { auth: ParentAuth; api: Api; config: AppConfig };
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
type View = 'learn' | 'history' | 'progress' | 'config';
const MAX_QUESTION_LENGTH = 1200;

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The service could not complete this request.';
}

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const c = copy(language);
  const [runtime, setRuntime] = useState<Runtime>();
  const [setupError, setSetupError] = useState('');
  const [error, setError] = useState('');
  const [initialSessions, setInitialSessions] = useState<Session[] | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [setupIdentity, setSetupIdentity] = useState<{ provider: string; subject: string } | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent>();
  const [privacy, setPrivacy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const authLock = useRef(false);
  const lifetime = useRef(0);
  const authRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const cancel = () => authRequest.current?.abort();
    window.addEventListener('pagehide', cancel);
    return () => { cancel(); window.removeEventListener('pagehide', cancel); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const version = ++lifetime.current;
    setSetupError('');
    void loadConfig().then(async config => {
      const auth = new ParentAuth(config);
      await auth.initialize();
      if (lifetime.current === version) setRuntime({ auth, api: new Api(config, () => auth.token()), config });
    }).catch(error => {
      if (lifetime.current === version) setSetupError(message(error));
    });
    return () => { lifetime.current++; };
  }, [attempt]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => setInstall(undefined);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('beforeinstallprompt', prompt);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  async function signIn(action: (auth: ParentAuth) => Promise<void>, social = false) {
    if (!runtime || authLock.current) return;
    authLock.current = true;
    setAuthBusy(true); setError(''); setSetupIdentity(null);
    let signedIn = false;
    const controller = new AbortController();
    authRequest.current = controller;
    try {
      await action(runtime.auth);
      signedIn = true;
      // A Microsoft identity alone does not grant access: the backend must allow this parent.
      const [sessions, me] = await Promise.all([
        runtime.api.sessions(controller.signal), runtime.api.me(controller.signal),
      ]);
      if (!controller.signal.aborted) { setRole(me.role); setInitialSessions(sessions); }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(signedIn || social ? message(error) : c.authError);
        if (social && !signedIn) setSetupIdentity(runtime.auth.identityForSetup());
      }
      controller.abort();
    } finally { authLock.current = false; setAuthBusy(false); }
  }
  async function signOut() {
    if (!runtime || authLock.current) return;
    setInitialSessions(null); setRole(null); setError(''); setPrivacy(false); setSetupIdentity(null); setHasDraft(false);
    authLock.current = true; setAuthBusy(true);
    try { await runtime.auth.signOut(); }
    catch { setError(c.logoutError); }
    finally { authLock.current = false; setAuthBusy(false); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content / Hopp til innhold</a>
    <header className="site-header">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="StudentIQ">
        <span className="brand-mark" aria-hidden="true">s<span>iq</span></span>
        <span>Student<span className="accent">IQ</span><small>{c.tagline}</small></span>
      </a>
      <div className="header-actions">
        <label className="language-control"><span>{c.language}</span>
          <select value={language} disabled={lessonBusy} onChange={event => {
            const next = event.target.value as Language;
            if (next !== language && hasDraft && !window.confirm(c.discardDraft)) return;
            setLanguage(next);
          }}>
            <option value="en">English</option><option value="nb">Norsk bokmål</option>
          </select>
        </label>
        {initialSessions !== null && <button className="quiet" onClick={() => void signOut()} disabled={authBusy}>{c.signOut}</button>}
      </div>
    </header>
    {!online && <div className="notice" role="status">{c.offline}</div>}
    {error && <ErrorBanner text={error} dismiss={() => setError('')} label={c.dismiss} />}
    {initialSessions !== null && runtime
      ? <Workspace api={runtime.api} role={role ?? 'student'} initialSessions={initialSessions} language={language} setLanguage={setLanguage} online={online} onBusyChange={setLessonBusy} onDraftChange={setHasDraft} />
      : <main id="main" className="welcome-layout">
        <section className="welcome-copy">
          <p className="eyebrow">✦ {c.parent}</p>
          <h1>{c.welcome}</h1>
          <p className="lead">{c.welcomeBody}</p>
          <div className="subject-preview">{subjects.map(subject =>
            <span key={subject}>{subjectLabel(subject, language)}</span>)}</div>
          {setupError ? <section className="setup-error" role="alert">
            <h2>{c.setup}</h2><p>{setupError}</p>
            <button onClick={() => setAttempt(value => value + 1)}>{c.retry}</button>
          </section> : <button className="primary large" onClick={() => void signIn(auth => auth.signIn())} disabled={!runtime || authBusy || !online}>
            {authBusy ? c.signingIn : !runtime ? c.loading : c.signIn}<span aria-hidden="true"> ↗</span>
          </button>}
          {runtime?.config.microsoftPersonalClientId && <p><button disabled={authBusy || !online}
            onClick={() => void signIn(auth => auth.signInMicrosoft(), true)}>{c.microsoftStudent}</button></p>}
          {runtime?.config.googleClientId && <GoogleSignIn clientId={runtime.config.googleClientId}
            disabled={authBusy || !online}
            onCredential={(token, nonce) => void signIn(auth => auth.exchange('google', token, nonce), true)} />}
          {runtime && !runtime.config.googleClientId && <p className="small">{c.googleUnavailable}</p>}
          {setupIdentity && <p className="small">{c.identitySetup} ({setupIdentity.provider}): <code>{setupIdentity.subject}</code></p>}
          {authBusy && <p className="small" role="status">{c.loadingHistory}</p>}
          <p className="small">{c.parentNote}</p>
          <div className="privacy-strip"><span aria-hidden="true">◇</span><p>{c.privateNote}</p></div>
        </section>
        <section className="welcome-teacher">
          <Teacher speaking={false} label={c.teacherIdle} />
          <p className="small">{c.teacherNote}</p>
        </section>
      </main>}
    <footer>
      <span>StudentIQ · {c.parent}</span>
      <button className="link-button" aria-expanded={privacy} onClick={() => setPrivacy(value => !value)}>{c.privacy}</button>
      {install && <button onClick={() => {
        void install.prompt().then(() => install.userChoice).then(() => setInstall(undefined))
          .catch(() => setError(c.installNote));
      }}>{c.install}</button>}
      <span className="small">{c.installNote}</span>
    </footer>
    {privacy && <section className="privacy-panel" aria-label={c.privacyTitle}>
      <h2>{c.privacyTitle}</h2><p>{c.privacyBody}</p><p>{c.privacyMore}</p>
    </section>}
  </div>;
}

export function ErrorBanner({ text, dismiss, label }: { text: string; dismiss(): void; label: string }) {
  return <div className="error-banner" role="alert"><p>{text}</p>
    <button className="quiet" onClick={dismiss} aria-label={label}>×</button></div>;
}

export function Workspace({ api, initialSessions, language, setLanguage, online, onBusyChange, onDraftChange, role = 'student' }: {
  api: Api; initialSessions: Session[]; language: Language; setLanguage(language: Language): void; online: boolean;
  onBusyChange?(busy: boolean): void;
  onDraftChange?(hasDraft: boolean): void;
  role?: Role;
}) {
  const c = copy(language);
  const [view, setView] = useState<View>('learn');
  const [subject, setSubject] = useState('maths');
  const [sessions, setSessions] = useState(initialSessions);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  // Only backend-returned replies are displayed; IDs/times are not invented.
  const [exchanges, setExchanges] = useState<{ message: string; reply: string }[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [muted, setMuted] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [mic, setMic] = useState<'off' | 'listening' | 'finishing'>('off');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyStale, setHistoryStale] = useState(false);
  const [adminAllowed, setAdminAllowed] = useState(role === 'admin');
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [pianoBusy, setPianoBusy] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [encouragement, setEncouragement] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState('off');
  const [breakSuggested, setBreakSuggested] = useState(false);
  const [sessionClock, setSessionClock] = useState(0);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const toolBusy = plannerBusy || pianoBusy || quizBusy;
  const request = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const mutedRef = useRef(true);
  const micRef = useRef<'off' | 'listening' | 'finishing'>('off');
  const speech = useRef<Speech | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lessonLanguage = useRef(language);

  useEffect(() => { onDraftChange?.(!!draft.trim()); }, [draft, onDraftChange]);
  useEffect(() => () => { onDraftChange?.(false); }, [onDraftChange]);
  useEffect(() => {
    onBusyChange?.(busy || toolBusy || preferencesBusy || mic !== 'off');
    return () => { onBusyChange?.(false); };
  }, [busy, toolBusy, preferencesBusy, mic, onBusyChange]);
  useEffect(() => {
    if (paused || breakMinutes === 'off' || view !== 'learn') return;
    const timer = setTimeout(() => setBreakSuggested(true), Number(breakMinutes) * 60_000);
    return () => clearTimeout(timer);
  }, [breakMinutes, paused, sessionClock, view]);
  const cancelVoice = useCallback(() => {
    speech.current?.cancel();
    micRef.current = 'off'; setMic('off'); setSpeaking(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    speech.current = new Speech(signal => api.speechToken(signal), active => {
      if (alive.current) setSpeaking(active);
    });
    const hidden = () => { if (document.hidden) cancelVoice(); };
    const leave = () => { cancelVoice(); request.current?.abort(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', cancelVoice);
    window.addEventListener('pagehide', leave);
    return () => {
      alive.current = false;
      speech.current?.cancel(); request.current?.abort();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', cancelVoice);
      window.removeEventListener('pagehide', leave);
    };
  }, [api, cancelVoice]);
  useEffect(() => {
    if (!online) cancelVoice();
  }, [online, cancelVoice]);
  useEffect(() => {
    if (lessonLanguage.current !== language) {
      cancelVoice();
      // A saved session's subject and language cannot be mutated by /api/chat.
      setDetail(null); setExchanges([]); setSessionId(undefined); setDraft(''); setStatus('');
      lessonLanguage.current = language;
    }
  }, [language, cancelVoice]);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ behavior: 'instant', block: 'nearest' });
  }, [exchanges, detail]);

  function beginRequest(history = false) {
    if (locked.current) return null;
    locked.current = true; setBusy(true); setError(''); setStatus('');
    setLoadingHistory(history);
    cancelVoice();
    const controller = new AbortController();
    request.current = controller;
    return controller;
  }
  function endRequest(controller: AbortController) {
    if (request.current !== controller) return;
    locked.current = false; request.current = null;
    if (alive.current) { setBusy(false); setLoadingHistory(false); }
  }
  function newSession(nextSubject = subject) {
    if (locked.current) return;
    if (draft.trim() && !window.confirm(c.discardDraft)) return;
    cancelVoice(); setSubject(nextSubject);
    setSessionId(undefined); setDetail(null); setExchanges([]); setDraft(''); setStatus(''); setError('');
    setView('learn');
    setPaused(false); setBreakSuggested(false); setSessionClock(value => value + 1);
  }
  async function refresh(nextView?: View) {
    const controller = beginRequest(true);
    if (!controller) return;
    if (nextView) setView(nextView);
    try {
      const result = await api.sessions(controller.signal);
      if (!alive.current) return;
      setSessions(result); setNeedsRefresh(false); setHistoryStale(false);
    } catch (error) {
      if (alive.current && !controller.signal.aborted) { setError(message(error)); setHistoryStale(true); }
    } finally { endRequest(controller); }
  }
  async function open(session: Session) {
    if (draft.trim() && !window.confirm(c.discardDraft)) return;
    const controller = beginRequest(true);
    if (!controller) return;
    try {
      const result = await api.session(session.id, controller.signal);
      if (!alive.current) return;
      setDetail(result); setExchanges([]); setSessionId(result.id); setSubject(result.subject);
      lessonLanguage.current = result.language;
      setLanguage(result.language); setDraft(''); setView('learn');
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setError(message(error));
    } finally { endRequest(controller); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || text.length > MAX_QUESTION_LENGTH || paused || toolBusy || preferencesBusy || micRef.current !== 'off' || !online || needsRefresh) return;
    const controller = beginRequest();
    if (!controller) return;
    const sentLanguage = language;
    try {
      const result = await api.chat({
        sessionId, subject, language, message: text, ...(preferences ? { mood: preferences.mood } : {}),
      }, controller.signal);
      if (!alive.current) return;
      setSessionId(result.sessionId); setExchanges(previous => [...previous, { message: text, reply: result.reply }]);
      setDraft(''); setStatus(c.saved);
      if (!mutedRef.current && lessonLanguage.current === sentLanguage) {
        void speech.current?.say(result.reply, sentLanguage, preferences?.voice ?? 'default').catch(error => {
          if (alive.current) setError(`${c.voiceError} ${message(error)}`);
        });
      }
      // Fetch actual summaries/timestamps rather than generating progress or history.
      setLoadingHistory(true);
      try {
        const result = await api.sessions(controller.signal);
        if (alive.current) { setSessions(result); setHistoryStale(false); }
      }
      catch (error) {
        if (alive.current && !controller.signal.aborted) { setError(message(error)); setHistoryStale(true); }
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) {
        setError(`${message(error)} ${c.failed}`); setNeedsRefresh(true);
      }
    } finally { endRequest(controller); }
  }
  function startTalking() {
    if (paused || toolBusy || preferencesBusy || needsRefresh || locked.current || micRef.current !== 'off' || !online) return;
    setError(''); setStatus('');
    micRef.current = 'listening'; setMic('listening');
    void speech.current?.listen(language, text => {
      if (!alive.current) return;
      micRef.current = 'off'; setMic('off');
      if (text) { setDraft(previous => `${previous}${previous ? ' ' : ''}${text}`); textarea.current?.focus(); }
      else setError(c.noSpeech);
    }, error => {
      if (!alive.current) return;
      micRef.current = 'off'; setMic('off'); setError(message(error));
    });
  }
  function stopTalking() {
    if (micRef.current !== 'listening') return;
    micRef.current = 'finishing'; setMic('finishing');
    speech.current?.stopListening();
  }
  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) cancelVoice();
  }
  const disabled = busy || preferencesBusy || mic !== 'off' || paused;
  const activityDisabled = disabled || toolBusy || needsRefresh;
  function addToDraft(question: string) {
    if (locked.current || micRef.current !== 'off' || activityDisabled) return;
    const nextDraft = `${draft}${draft ? '\n\n' : ''}${question}`;
    if (nextDraft.trim().length > MAX_QUESTION_LENGTH) { setError(c.draftFull); return; }
    cancelVoice(); setDraft(nextDraft); textarea.current?.focus();
  }
  const currentSubject = subjectLabel(subject, language);
  const starters = language === 'nb' ? [
    { label: c.starterHint, question: `Kan du gi meg et hint om ${currentSubject} og stille meg ett spørsmål?` },
    { label: c.starterPicture, question: `Kan du vise meg et enkelt visuelt eksempel på ${currentSubject} med tekst eller symboler?` },
    { label: c.starterChallenge, question: `Kan du stille meg ett spørsmål om ${currentSubject} uten å si svaret først?` },
  ] : [
    { label: c.starterHint, question: `Can you give me a hint about ${currentSubject} and ask me one question?` },
    { label: c.starterPicture, question: `Can you show me a simple visual example of ${currentSubject} using text or symbols?` },
    { label: c.starterChallenge, question: `Can you ask me one question about ${currentSubject} without giving the answer first?` },
  ];
  const counts = new Map<string, number>();
  sessions.forEach(session => counts.set(session.subject, (counts.get(session.subject) || 0) + 1));
  const utterances = [
    ...(detail?.events.map(event => ({ key: event.id, role: event.role, text: event.text, at: event.at })) || []),
    ...exchanges.flatMap((exchange, index) => [
      { key: `sent-${index}`, role: 'user' as const, text: exchange.message, at: undefined },
      { key: `reply-${index}`, role: 'assistant' as const, text: exchange.reply, at: undefined },
    ]),
  ];

  return <main id="main" className="workspace">
    <nav className="workspace-nav" aria-label={language === 'nb' ? 'Læring' : 'Learning'}>
      {(['learn', 'history', 'progress', ...(adminAllowed ? ['config'] : [])] as View[]).map((tab, index) =>
        <button key={tab} aria-current={view === tab ? 'page' : undefined}
          disabled={busy || toolBusy || preferencesBusy} onClick={() => {
            if (tab === 'learn' || tab === 'config') { cancelVoice(); setView(tab); }
            else void refresh(tab);
          }}><span aria-hidden="true">{['✦', '◷', '↗', '▦'][index]}</span> {c[tab]}</button>)}
      <span className="parent-status" title={c.connected}>◇ {c.parent}</span>
    </nav>
    {error && <ErrorBanner text={error} dismiss={() => setError('')} label={c.dismiss} />}
    {loadingHistory && <p className="notice" role="status">{c.loadingHistory}</p>}
    {historyStale && <p className="notice" role="status">{c.staleHistory}</p>}
    {needsRefresh && <div className="notice">
      <button onClick={() => void refresh('history')} disabled={busy || !online}>{c.refresh}</button>
    </div>}
    <div role="status" className="sr-only">{status}</div>
    {view === 'config' && adminAllowed
      ? <><AccessManagement api={api} language={language} online={online} onAccessDenied={() => {
        setAdminAllowed(false); setView('learn'); setError(c.adminDenied);
      }} /><PlanningCalendar api={api} language={language} online={online} onBusyChange={setPlannerBusy} onAccessDenied={() => {
        setAdminAllowed(false); setView('learn'); setError(c.adminDenied);
      }} /></>
      : view === 'learn' ? <div className="learning-layout">
      <aside className="teacher-panel">
        <div className="panel-heading"><span className="eyebrow">StudentIQ</span><span className="live-dot">{c.ready}</span></div>
        <Teacher speaking={speaking} appearance={preferences?.appearance} mood={preferences?.mood}
          label={speaking ? c.teacherSpeaking : c.teacherIdle} />
        <p className="small teacher-note">{c.teacherNote}</p>
        <button className="voice-toggle" disabled={paused} aria-pressed={!muted} onClick={toggleMute}>
          <span aria-hidden="true">{muted ? '◌' : '♪'}</span> {muted ? c.unmute : c.mute}
        </button>
        <p className="small">{muted ? c.muted : c.voice}</p>
        <TeacherSettings api={api} language={language} disabled={busy || toolBusy || paused || mic !== 'off'} online={online}
          onBusyChange={setPreferencesBusy} onChange={value => { cancelVoice(); setPreferences(value); }} />
        <div className="privacy-strip compact"><span aria-hidden="true">◇</span><p>{c.privateNote}</p></div>
      </aside>
      <section className="lesson-panel" aria-label={c.learn}>
        <div className="lesson-heading">
          <div><p className="eyebrow">{c.subject}</p><h1>{subjectLabel(subject, language)}</h1></div>
          <button onClick={() => newSession()} disabled={disabled || toolBusy}>{c.newSession} +</button>
        </div>
        <div className="subject-picker" role="group" aria-label={c.subject}>
          {subjects.map(value => <button key={value} aria-pressed={subject === value} disabled={disabled || toolBusy}
            onClick={() => { if (value !== subject) newSession(value); }}><span className="subject-icon" aria-hidden="true">{subjectIcons[value]}</span> {subjectLabel(value, language)}</button>)}
        </div>
        <p className="qa-note">{c.qaNote}</p>
        <a className="activity-link" href="#learning-activities">{c.activities} ↓</a>
        <div className="conversation" role="region" tabIndex={0}
          aria-label={language === 'nb' ? 'Samtale' : 'Conversation'} aria-busy={busy}>
          {!utterances.length && <div className="empty-conversation">
            <span className="discovery-mark" aria-hidden="true">✦</span>
            <h2>{c.emptyChat}</h2><p>{c.emptyChatBody}</p>
          </div>}
          <ol className="messages">
            {utterances.map(utterance => <li key={utterance.key} className={`message ${utterance.role}`}>
              <div className="message-label">{utterance.role === 'user' ? c.you : c.teacher}
                {utterance.at && <time dateTime={utterance.at}>{new Date(utterance.at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</time>}
              </div>
              <p>{utterance.text}</p>
              {utterance.role === 'assistant' && !muted && <button className="link-button"
                disabled={mic !== 'off' || busy || paused || preferencesBusy || !online}
                onClick={() => { void speech.current?.say(utterance.text, language, preferences?.voice ?? 'default').catch(error => {
                  if (alive.current) setError(`${c.voiceError} ${message(error)}`);
                }); }}>{c.replay} ♪</button>}
            </li>)}
          </ol>
          {busy && !loadingHistory && <p className="thinking" role="status">{c.sending}</p>}
          <div ref={transcriptEnd} />
        </div>
        <form className="composer" onSubmit={event => void send(event)}>
          <div className="starters">
            <p>{c.starterTitle}</p>
            <div>{starters.map(starter => <button key={starter.label} type="button"
              disabled={activityDisabled} onClick={() => addToDraft(starter.question)}>{starter.label}</button>)}</div>
            <p className="small">{c.starterReview}</p>
          </div>
          <label htmlFor="question">{c.ask}</label>
          <textarea id="question" ref={textarea} value={draft} maxLength={8000} rows={3}
            placeholder={c.placeholder} disabled={disabled || needsRefresh}
            onChange={event => setDraft(event.target.value)} />
          {draft.trim().length > MAX_QUESTION_LENGTH && <p className="notice" role="status">{c.messageTooLong}</p>}
          <div className="composer-actions">
            <button type="button" className={`talk-button ${mic === 'listening' ? 'recording' : ''}`}
              disabled={busy || toolBusy || preferencesBusy || paused || !online || needsRefresh}
              aria-disabled={mic === 'finishing' || busy || toolBusy || preferencesBusy || paused || !online || needsRefresh}
              aria-describedby="voice-help" aria-pressed={mic === 'listening'}
              onPointerDown={event => {
                if (event.button !== 0) return;
                event.preventDefault(); event.currentTarget.focus();
                event.currentTarget.setPointerCapture?.(event.pointerId); startTalking();
              }}
              onPointerUp={stopTalking} onPointerCancel={cancelVoice}
              onLostPointerCapture={stopTalking} onBlur={cancelVoice}
              onKeyDown={event => {
                if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) startTalking(); }
                if (event.key === 'Escape') cancelVoice();
              }}
              onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); stopTalking(); } }}>
              <span aria-hidden="true">♩</span> {mic === 'listening' ? c.listening : mic === 'finishing' ? c.finalizing : c.talk}
            </button>
            <button className="primary" type="submit" disabled={disabled || toolBusy || !online || !draft.trim() ||
              draft.trim().length > MAX_QUESTION_LENGTH || needsRefresh}>{busy ? c.sending : c.send} <span aria-hidden="true">↗</span></button>
          </div>
          <div className="mic-status" role="status"><span className={`mic-dot ${mic === 'listening' ? 'on' : ''}`} />{mic === 'listening' ? c.micOn : c.micOff}</div>
          <p className="small" id="voice-help">{c.voiceNote}</p>
        </form>
        <section className="pace-panel" aria-label={c.breakOptions}>
          <label className="encouragement-toggle"><input type="checkbox" checked={encouragement}
            onChange={event => setEncouragement(event.target.checked)} />{c.encouragementOption}</label>
          {encouragement && <p className="gentle-message">✦ {c.encouragement}</p>}
          <div className="pace-actions">
            <label>{c.breakReminder}<select value={breakMinutes} onChange={event => {
              setBreakMinutes(event.target.value); setBreakSuggested(false);
            }}><option value="off">{c.noTimer}</option><option value="10">{c.tenMinutes}</option><option value="15">{c.fifteenMinutes}</option></select></label>
            <button type="button" disabled={busy || toolBusy || preferencesBusy} onClick={() => {
              cancelVoice(); setPaused(value => !value); setBreakSuggested(false); setSessionClock(value => value + 1);
            }}>{paused ? c.resume : c.pause}</button>
          </div>
          <p className="small">{c.paceNote}</p>
          <GentleCheckIn language={language} paused={paused} onBreak={() => { cancelVoice(); setPaused(true); }} />
          {breakSuggested && !paused && <div className="notice" role="status"><p>{c.breakSuggestion}</p>
            <button type="button" onClick={() => setBreakSuggested(false)}>{c.dismissBreak}</button></div>}
          {paused && <div className="break-card" role="status"><h2>{c.pausedTitle}</h2><p>{c.pausedBody}</p></div>}
        </section>
        <section id="learning-activities" className="learning-activities" aria-labelledby="activities-title">
          <div className="activities-intro"><h2 id="activities-title">{c.activities}</h2><p className="small">{c.activitiesNote}</p></div>
          {subject === 'otherLanguages' && <p className="notice language-invite">{c.languageInvite}</p>}
          {subject === 'piano' && <Piano api={api} language={language} disabled={disabled || plannerBusy || quizBusy} online={online} onBusyChange={setPianoBusy} />}
          {subject === 'maths' && <>
            <ArrayExplorer language={language} disabled={activityDisabled} onAsk={addToDraft} />
            <FractionExplorer language={language} disabled={activityDisabled} onAsk={addToDraft} />
          </>}
          {(subject === 'english' || subject === 'norwegian') && <SentenceBuilder key={subject} subject={subject}
            language={language} disabled={activityDisabled} onAsk={addToDraft} />}
          {subject === 'science' && <WaterCycle language={language} disabled={activityDisabled} onAsk={addToDraft} />}
          <Quiz key={`${subject}-${language}`} api={api} subject={subject} language={language}
            disabled={disabled || pianoBusy || plannerBusy || needsRefresh} online={online} onBusyChange={setQuizBusy} />
        </section>
      </section>
    </div> : <section className="records-panel">
      <div className="records-heading"><div>
        <p className="eyebrow">{c.parent}</p>
        <h1>{view === 'history' ? c.historyTitle : c.progressTitle}</h1>
        <p>{view === 'history' ? c.historyBody : c.progressBody}</p>
      </div><button disabled={busy || !online} onClick={() => void refresh()}>{c.refresh}</button></div>
      {busy && <p role="status">{c.loading}</p>}
      {view === 'history' ? <div className="session-list">
        {!sessions.length && !busy && <p>{c.noSessions}</p>}
        {[...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(session =>
          <article className="session-card" key={session.id}>
            <div><span className="subject-tag">{subjectLabel(session.subject, language)}</span>
              <span className="small"> · {session.language === 'nb' ? 'Norsk bokmål' : 'English'}</span>
              <h2>{session.summary || c.summary}</h2>
              <time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleString(language)}</time>
            </div><button disabled={busy || !online} onClick={() => void open(session)}>{c.continue} ↗</button>
          </article>)}
      </div> : <>
        <div className="stats-grid">
          <article className="stat"><strong>{sessions.length}</strong><span>{c.savedSessions}</span></article>
          <article className="stat"><strong>{counts.size}</strong><span>{c.explored}</span></article>
        </div>
        <h2>{c.activity}</h2>
        {!sessions.length && <p>{c.noProgress}</p>}
        {[...counts].map(([key, count]) => <div className="activity-row" key={key}>
          <span>{subjectLabel(key, language)}</span>
          <meter min={0} max={Math.max(1, sessions.length)} value={count} aria-label={subjectLabel(key, language)} />
          <strong>{count}</strong>
        </div>)}
        <p className="small">{c.progressLimit}</p>
        <PracticeProgress api={api} language={language} online={online} />
      </>}
    </section>}
  </main>;
}

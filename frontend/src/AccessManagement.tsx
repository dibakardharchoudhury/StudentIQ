import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Api, type Language, type SocialAccount } from './api';

export default function AccessManagement({ api, language, online, onAccessDenied }: {
  api: Pick<Api, 'socialAccounts' | 'saveSocialAccount' | 'removeSocialAccount'>;
  language: Language; online: boolean; onAccessDenied(): void;
}) {
  const text = language === 'nb' ? {
    title: 'Hvem kan logge inn?', help: 'Godkjenn kun en konto du selv har bekreftet. Kopier konto-ID-en fra innloggingsskjermen. Foreldre og elever kan ikke endre tilgangen eller kalenderen.',
    provider: 'Innloggingstjeneste', subject: 'Konto-ID', role: 'Rolle', parent: 'Forelder', student: 'Elev',
    save: 'Godkjenn eller endre rolle', remove: 'Fjern tilgang', confirm: 'Bekreft fjerning', cancel: 'Avbryt',
    refresh: 'Last tilgang på nytt', empty: 'Ingen sosiale kontoer er godkjent.', failed: 'Endringen kan ha blitt lagret. Last listen på nytt før du prøver igjen.',
  } : {
    title: 'Who can sign in?', help: 'Approve only an account you have personally verified. Copy its account ID from the sign-in screen. Parents and students cannot manage access or the calendar.',
    provider: 'Sign-in provider', subject: 'Account ID', role: 'Role', parent: 'Parent', student: 'Student',
    save: 'Approve or change role', remove: 'Remove access', confirm: 'Confirm removal', cancel: 'Cancel',
    refresh: 'Reload access list', empty: 'No social accounts are approved.', failed: 'The change may have been saved. Reload the list before trying again.',
  };
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [provider, setProvider] = useState<SocialAccount['provider']>('microsoft');
  const [role, setRole] = useState<SocialAccount['role']>('student');
  const [subject, setSubject] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; active.current?.abort(); active.current = null; };
  }, [api]);

  async function refresh(mutation?: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError('');
    try {
      if (mutation) await mutation(controller.signal);
      const result = await api.socialAccounts(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setAccounts(result); setBlocked(false); setDeleting(undefined);
      if (mutation) setSubject('');
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAccounts(null); denied.current(); return;
      }
      setError(`${error instanceof Error ? error.message : 'Access list unavailable.'}${mutation ? ` ${text.failed}` : ''}`);
      if (mutation) setBlocked(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked || !online) return;
    void refresh(signal => api.saveSocialAccount({ provider, subject: subject.trim(), role }, signal));
  }
  return <section className="card">
    <h2>{text.title}</h2><p>{text.help}</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !online} onClick={() => void refresh()}>{text.refresh}</button>
    {accounts?.length === 0 && <p>{text.empty}</p>}
    {accounts && <ul>{accounts.map(account => <li key={account.id}>
      <span>{account.provider} · {account.role === 'parent' ? text.parent : text.student} · <code>{account.subject}</code></span>{' '}
      {deleting === account.id
        ? <><button disabled={busy || blocked || !online} onClick={() => void refresh(signal => api.removeSocialAccount(account.id, signal))}>{text.confirm}</button>
          <button onClick={() => setDeleting(undefined)}>{text.cancel}</button></>
        : <button disabled={busy || blocked || !online} onClick={() => setDeleting(account.id)}>{text.remove}</button>}
    </li>)}</ul>}
    <form onSubmit={submit}>
      <label>{text.provider}<select value={provider} onChange={event => setProvider(event.target.value as SocialAccount['provider'])}>
        <option value="microsoft">Microsoft personal</option><option value="google">Google</option>
      </select></label>
      <label>{text.subject}<input value={subject} onChange={event => setSubject(event.target.value)} maxLength={255} required /></label>
      <label>{text.role}<select value={role} onChange={event => setRole(event.target.value as SocialAccount['role'])}>
        <option value="student">{text.student}</option><option value="parent">{text.parent}</option>
      </select></label>
      <button disabled={busy || blocked || !online || !subject.trim()}>{text.save}</button>
    </form>
  </section>;
}

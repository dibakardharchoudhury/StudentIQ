import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Api, type Language, type SocialAccount } from './api';

export default function AccessManagement({ api, language, online, onAccessDenied }: {
  api: Pick<Api, 'socialAccounts' | 'saveSocialAccount' | 'removeSocialAccount'>;
  language: Language; online: boolean; onAccessDenied(): void;
}) {
  const text = language === 'nb' ? {
    title: 'Godkjente kontoer', help: 'Bare kontoene på denne listen kan logge inn som elev eller forelder. Administratorkontoen vises ikke her.',
    list: 'Tilgangslisten', add: 'Legg til en konto', how: 'Slik finner du konto-ID-en',
    step1: 'Be personen prøve å logge inn med en konfigurert Google- eller personlig Microsoft-konto på en annen enhet eller i et privat vindu.',
    step2: 'Hvis kontoen ikke er godkjent, vises en konto-ID på innloggingssiden. Kontroller sammen med personen at riktig konto er valgt.',
    step3: 'Kopier den nøyaktige ID-en hit, velg samme innloggingstjeneste og en rolle, og godkjenn. Be deretter personen logge inn igjen.',
    safe: 'ID-en er ikke en e-postadresse og er ikke bekreftet av StudentIQ på innloggingssiden. Godkjenn aldri en ID fra en ukjent person.',
    provider: 'Innloggingstjeneste', subject: 'Konto-ID', role: 'Rolle', parent: 'Forelder', student: 'Elev',
    roles: 'Foreldre og elever kan lære og se familiens historikk, men kan ikke administrere tilgang eller kalenderen.',
    save: 'Godkjenn konto', remove: 'Fjern tilgang', confirm: 'Bekreft fjerning', cancel: 'Avbryt',
    makeParent: 'Endre til forelder', makeStudent: 'Endre til elev',
    refresh: 'Oppdater listen', empty: 'Ingen kontoer er godkjent ennå.', loading: 'Laster tilgangslisten…', failed: 'Endringen kan ha blitt lagret. Last listen på nytt før du prøver igjen.',
  } : {
    title: 'Approved accounts', help: 'Only accounts on this list can sign in as a student or parent. The administrator account is not listed here.',
    list: 'Access list', add: 'Add an account', how: 'How to find the account ID',
    step1: 'Have the person try signing in with a configured Google or Microsoft personal account on another device or in a private window.',
    step2: 'If the account is not approved, the sign-in page shows an account ID. Check together that the correct account was selected.',
    step3: 'Copy the exact ID here, choose the same sign-in provider and a role, and approve it. Then ask the person to sign in again.',
    safe: 'The ID is not an email address and is unverified on the sign-in page. Never approve an ID from someone you do not know.',
    provider: 'Sign-in provider', subject: 'Account ID', role: 'Role', parent: 'Parent', student: 'Student',
    roles: 'Parents and students can learn and see the shared family history, but cannot manage access or the calendar.',
    save: 'Approve account', remove: 'Remove access', confirm: 'Confirm removal', cancel: 'Cancel',
    makeParent: 'Change to parent', makeStudent: 'Change to student',
    refresh: 'Refresh list', empty: 'No accounts have been approved yet.', loading: 'Loading access list…', failed: 'The change may have been saved. Reload the list before trying again.',
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

  async function refresh(mutation?: (signal: AbortSignal) => Promise<void>, clearForm = false) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError('');
    try {
      if (mutation) await mutation(controller.signal);
      const result = await api.socialAccounts(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setAccounts(result); setBlocked(false); setDeleting(undefined);
      if (clearForm) setSubject('');
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
    void refresh(signal => api.saveSocialAccount({ provider, subject: subject.trim(), role }, signal), true);
  }
  return <section className="card access-management">
    <h2>{text.title}</h2><p>{text.help}</p><p>{text.roles}</p>
    {error && <p role="alert">{error}</p>}
    <div className="access-list-header"><h3>{text.list}{accounts && ` (${accounts.length})`}</h3>
      <button type="button" disabled={busy || !online} onClick={() => void refresh()}>{text.refresh}</button></div>
    {!accounts && !error && <p role="status">{text.loading}</p>}
    {accounts?.length === 0 && <p>{text.empty}</p>}
    {accounts && accounts.length > 0 && <ul className="access-list">{accounts.map(account => <li key={account.id}>
      <div className="access-account">
        <strong>{account.provider === 'google' ? 'Google' : 'Microsoft personal'} · {account.role === 'parent' ? text.parent : text.student}</strong>
        <span>{text.subject}: <code>{account.subject}</code></span>
      </div>
      <div className="button-row">
        {deleting === account.id
          ? <><button disabled={busy || blocked || !online} onClick={() => void refresh(signal => api.removeSocialAccount(account.id, signal))}>{text.confirm}</button>
            <button onClick={() => setDeleting(undefined)}>{text.cancel}</button></>
          : <><button disabled={busy || blocked || !online} onClick={() => void refresh(signal => api.saveSocialAccount({
            provider: account.provider, subject: account.subject, role: account.role === 'parent' ? 'student' : 'parent',
          }, signal))}>{account.role === 'parent' ? text.makeStudent : text.makeParent}</button>
            <button disabled={busy || blocked || !online} onClick={() => setDeleting(account.id)}>{text.remove}</button></>}
      </div>
    </li>)}</ul>}
    <div className="access-add">
    <h3>{text.add}</h3>
    <details open><summary>{text.how}</summary><ol><li>{text.step1}</li><li>{text.step2}</li><li>{text.step3}</li></ol><p>{text.safe}</p></details>
    <form onSubmit={submit}>
      <label>{text.provider}<select value={provider} onChange={event => setProvider(event.target.value as SocialAccount['provider'])}>
        <option value="microsoft">Microsoft personal</option><option value="google">Google</option>
      </select></label>
      <label>{text.subject}<input value={subject} onChange={event => setSubject(event.target.value)} maxLength={255} pattern="[A-Za-z0-9_-]+" autoComplete="off" required /></label>
      <label>{text.role}<select value={role} onChange={event => setRole(event.target.value as SocialAccount['role'])}>
        <option value="student">{text.student}</option><option value="parent">{text.parent}</option>
      </select></label>
      <button disabled={busy || blocked || !online || !subject.trim()}>{text.save}</button>
    </form>
    </div>
  </section>;
}

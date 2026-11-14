import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Api, type Language, type SocialAccount } from './api';
import './AccessManagement.css';

type Result = 'approved' | 'changed' | 'removed';

export default function AccessManagement({ api, language, online, onAccessDenied }: {
  api: Pick<Api, 'socialAccounts' | 'saveSocialAccount' | 'removeSocialAccount'>;
  language: Language; online: boolean; onAccessDenied(): void;
}) {
  const text = language === 'nb' ? {
    title: 'Tilgang for familien', intro: 'Godkjenn kontoer for foreldre og elever som skal bruke StudentIQ. Administratorkontoen vises ikke i listen.',
    add: 'Godkjenn en konto', addIntro: 'Du trenger personen og konto-ID-en fra innloggingsforsøket. Det sendes ingen invitasjon.',
    step1Title: 'Be personen prøve å logge inn', step1: 'På en annen enhet eller i et privat vindu: velg en konfigurert Google- eller personlig Microsoft-konto. Kontroller sammen at riktig konto er valgt.',
    step2Title: 'Finn og kontroller konto-ID-en', step2: 'Hvis innloggingen ikke lykkes, kan innloggingssiden vise en konto-ID for administratoroppsett. Kopier eller skriv ned hele ID-en nøyaktig, og merk deg hvilken innloggingstjeneste som ble brukt.',
    warning: 'Konto-ID-en på innloggingssiden er ubekreftet og er ikke en e-postadresse. Kontroller den direkte med personen via en betrodd kanal. Godkjenn aldri en ID fra en ukjent person.',
    step3Title: 'Velg tilgang og godkjenn', step3: 'Skriv inn samme tjeneste og konto-ID, og velg rolle. Hvis kontoen allerede finnes, oppdateres rollen.',
    provider: 'Innloggingstjeneste', microsoft: 'Microsoft personlig', subject: 'Konto-ID', subjectHint: 'Bruk hele ID-en, ikke e-post. Kun bokstaver, tall, bindestrek og understrek.',
    role: 'Rolle', parent: 'Forelder', student: 'Elev', roles: 'Begge roller kan lære og se familiens delte historikk. Ingen av dem kan administrere tilgang eller kalenderen.',
    save: 'Godkjenn konto', after: 'Etter godkjenning må personen logge inn igjen med samme tjeneste og konto.',
    list: 'Godkjente kontoer', listHelp: 'Bruk tjenesten og konto-ID-en til å kjenne igjen kontoen.', refresh: 'Oppdater listen', empty: 'Ingen kontoer er godkjent ennå.',
    loading: 'Laster tilgangslisten…', working: 'Oppdaterer tilgangslisten…', offline: 'Du er frakoblet. Koble til for å oppdatere eller endre tilgang.',
    loadFailed: 'Kunne ikke laste tilgangslisten. Prøv å oppdatere listen.', failed: 'Endringen kan ha blitt lagret. Oppdater listen og kontroller den før du prøver igjen.',
    approved: 'Kontoen er godkjent. Be personen logge inn igjen.', changed: 'Rollen er oppdatert. Personen må logge inn igjen.', removed: 'Tilgangen er fjernet.',
    remove: 'Fjern tilgang', confirm: 'Bekreft fjerning', cancel: 'Avbryt', removeQuestion: 'Fjerne tilgangen for denne kontoen?',
    makeParent: 'Endre til forelder', makeStudent: 'Endre til elev',
  } : {
    title: 'Family access', intro: 'Approve accounts for parents and students who will use StudentIQ. The administrator account is not listed here.',
    add: 'Approve an account', addIntro: 'You need the person and the account ID from their sign-in attempt. No invitation is sent.',
    step1Title: 'Ask the person to try signing in', step1: 'On another device or in a private window, choose a configured Google or Microsoft personal account. Check together that the correct account was selected.',
    step2Title: 'Find and check the account ID', step2: 'If sign-in fails, the sign-in page may show an account ID for administrator setup. Copy or write down the entire ID exactly and note the sign-in provider used.',
    warning: 'The account ID on the sign-in page is unverified and is not an email address. Check it directly with the person through a trusted channel. Never approve an ID from someone you do not know.',
    step3Title: 'Choose access and approve', step3: 'Enter the same provider and account ID, then choose a role. If the account is already listed, its role will be updated.',
    provider: 'Sign-in provider', microsoft: 'Microsoft personal', subject: 'Account ID', subjectHint: 'Use the entire ID, not an email address. Letters, numbers, hyphens and underscores only.',
    role: 'Role', parent: 'Parent', student: 'Student', roles: 'Both roles can learn and see the shared family history. Neither can manage access or the calendar.',
    save: 'Approve account', after: 'After approval, the person must sign in again using the same provider and account.',
    list: 'Approved accounts', listHelp: 'Use the provider and account ID to identify each account.', refresh: 'Refresh list', empty: 'No accounts have been approved yet.',
    loading: 'Loading access list…', working: 'Updating access list…', offline: 'You are offline. Reconnect to refresh or change access.',
    loadFailed: 'Could not load the access list. Try refreshing the list.', failed: 'The change may have been saved. Refresh the list and check it before trying again.',
    approved: 'Account approved. Ask the person to sign in again.', changed: 'Role updated. The person must sign in again.', removed: 'Access removed.',
    remove: 'Remove access', confirm: 'Confirm removal', cancel: 'Cancel', removeQuestion: 'Remove access for this account?',
    makeParent: 'Change to parent', makeStudent: 'Change to student',
  };
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [provider, setProvider] = useState<SocialAccount['provider']>('microsoft');
  const [role, setRole] = useState<SocialAccount['role']>('student');
  const [subject, setSubject] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<'load' | 'mutation' | ''>('');
  const [success, setSuccess] = useState<Result | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; active.current?.abort(); active.current = null; };
  }, [api]);

  async function refresh(mutation?: (signal: AbortSignal) => Promise<void>, result?: Result) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(''); setSuccess(null);
    try {
      if (mutation) await mutation(controller.signal);
      const updated = await api.socialAccounts(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setAccounts(updated); setBlocked(false); setDeleting(undefined);
      if (result === 'approved') setSubject('');
      if (result) setSuccess(result);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAccounts(null); denied.current(); return;
      }
      setError(mutation ? 'mutation' : 'load');
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
    void refresh(signal => api.saveSocialAccount({ provider, subject: subject.trim(), role }, signal), 'approved');
  }
  const unavailable = busy || blocked || !online;
  const providerName = (value: SocialAccount['provider']) => value === 'google' ? 'Google' : text.microsoft;

  return <section className="access-management access-ui" aria-labelledby="access-title">
    <header className="access-ui__intro"><h2 id="access-title">{text.title}</h2><p>{text.intro}</p></header>
    {!online && <p className="access-ui__notice" role="status">{text.offline}</p>}
    {error && <p className="access-ui__notice access-ui__notice--error" role="alert">{error === 'mutation' || blocked ? text.failed : text.loadFailed}</p>}
    {success && <p className="access-ui__notice access-ui__notice--success" role="status">{text[success]}</p>}

    <section className="access-ui__guide" aria-labelledby="access-add-title">
      <h3 id="access-add-title">{text.add}</h3><p>{text.addIntro}</p>
      <ol className="access-ui__steps">
        <li><div><h4>{text.step1Title}</h4><p>{text.step1}</p></div></li>
        <li><div><h4>{text.step2Title}</h4><p>{text.step2}</p><p className="access-ui__warning">{text.warning}</p></div></li>
        <li><div><h4>{text.step3Title}</h4><p>{text.step3}</p>
          <form className="access-ui__form" onSubmit={submit}>
            <label>{text.provider}<select value={provider} onChange={event => setProvider(event.target.value as SocialAccount['provider'])}>
              <option value="microsoft">{text.microsoft}</option><option value="google">Google</option>
            </select></label>
            <label>{text.subject}<input value={subject} onChange={event => setSubject(event.target.value)} maxLength={255} pattern="(?:[A-Za-z0-9_]|-)+" autoComplete="off" aria-describedby="access-subject-hint" required /></label>
            <p id="access-subject-hint" className="access-ui__hint">{text.subjectHint}</p>
            <label>{text.role}<select value={role} onChange={event => setRole(event.target.value as SocialAccount['role'])} aria-describedby="access-role-hint">
              <option value="student">{text.student}</option><option value="parent">{text.parent}</option>
            </select></label>
            <p id="access-role-hint" className="access-ui__hint">{text.roles}</p>
            <button type="submit" className="primary" disabled={unavailable || !subject.trim()}>{text.save}</button>
          </form>
          <p className="access-ui__after">{text.after}</p>
        </div></li>
      </ol>
    </section>

    <section className="access-ui__directory" aria-labelledby="access-list-title" aria-busy={busy}>
      <div className="access-ui__list-header"><div><h3 id="access-list-title">{text.list}{accounts && ` (${accounts.length})`}</h3><p>{text.listHelp}</p></div>
        <button type="button" disabled={busy || !online} onClick={() => void refresh()}>{text.refresh}</button></div>
      {busy && <p role="status">{accounts ? text.working : text.loading}</p>}
      {!busy && accounts?.length === 0 && <p className="access-ui__empty">{text.empty}</p>}
      {accounts && accounts.length > 0 && <ul className="access-ui__list">{accounts.map(account => {
        const identity = `${providerName(account.provider)} · ${account.subject}`;
        return <li key={account.id} className="access-ui__account">
          <div className="access-ui__account-info"><div className="access-ui__account-heading"><strong>{providerName(account.provider)}</strong><span className="access-ui__badge">{account.role === 'parent' ? text.parent : text.student}</span></div>
            <span className="access-ui__account-id">{text.subject}: <code>{account.subject}</code></span></div>
          <div className="access-ui__actions">
            {deleting === account.id
              ? <><p>{text.removeQuestion}</p><button type="button" disabled={unavailable} aria-label={`${text.confirm}: ${identity}`} onClick={() => void refresh(signal => api.removeSocialAccount(account.id, signal), 'removed')}>{text.confirm}</button>
                <button type="button" onClick={() => setDeleting(undefined)}>{text.cancel}</button></>
              : <><button type="button" disabled={unavailable} aria-label={`${account.role === 'parent' ? text.makeStudent : text.makeParent}: ${identity}`} onClick={() => void refresh(signal => api.saveSocialAccount({
                provider: account.provider, subject: account.subject, role: account.role === 'parent' ? 'student' : 'parent',
              }, signal), 'changed')}>{account.role === 'parent' ? text.makeStudent : text.makeParent}</button>
                <button type="button" disabled={unavailable} aria-label={`${text.remove}: ${identity}`} onClick={() => setDeleting(account.id)}>{text.remove}</button></>}
          </div>
        </li>;
      })}</ul>}
    </section>
  </section>;
}

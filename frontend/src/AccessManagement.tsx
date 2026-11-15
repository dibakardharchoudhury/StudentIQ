import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Api, type Language, type SocialAccount, type SocialAccessRequest, type SocialPreapproval } from './api';
import './AccessManagement.css';

type Result = 'approved' | 'added' | 'changed' | 'removed';

export default function AccessManagement({ api, language, online, onAccessDenied }: {
  api: Pick<Api, 'accessDirectory' | 'saveSocialAccount' | 'removeSocialAccount'>;
  language: Language; online: boolean; onAccessDenied(): void;
}) {
  const text = language === 'nb' ? {
    title: 'Tilgang for familien', intro: 'Godkjenn elever og foreldre. Foreldre kan også få administratorrettigheter hvis du velger det.',
    add: 'Legg til eller godkjenn en konto', addIntro: 'Legg til en konto på forhånd, eller godkjenn en eksisterende innloggingsforespørsel. Det sendes ingen e-postinvitasjon.',
    mode: 'Hvordan vil du legge til kontoen?', beforehand: 'Legg til før første innlogging', fromRequest: 'Godkjenn en innloggingsforespørsel',
    addButton: 'Legg til konto', added: 'Kontoen er lagt til på forhånd. Del engangskoden privat med personen.',
    code: 'Engangskode for tilgang', codeHint: 'Vises bare nå. Del koden privat med personen. Den må brukes innen 7 dager under innlogging med valgt e-postadresse og tjeneste. En ny kode krever at du fjerner og legger til kontoen på nytt.',
    hideCode: 'Skjul tilgangskoden', pending: 'Lagt til på forhånd', pendingHint: 'Venter på første innlogging med engangskoden.', expires: 'Koden utløper',
    provider: 'Innloggingstjeneste', microsoft: 'Microsoft personlig', email: 'E-postadresse', emailHint: 'Bruk e-postadressen til den personlige kontoen. En konto lagt til på forhånd må også bruke engangskoden fra deg.',
    request: 'Innloggingsforespørsel', chooseRequest: 'Velg personens forespørsel', requests: 'Venter på godkjenning',
    noRequests: 'Ingen nye innloggingsforespørsler. Be personen logge inn, og oppdater listen.',
    noEmail: 'Leverandøren delte ingen e-postadresse', useRequest: 'Velg denne forespørselen',
    verify: 'Kontroller direkte med personen at forespørselen er deres. Leverandørens e-post eller brukernavn er bare en etikett og kan endres.',
    role: 'Rolle', parent: 'Forelder', student: 'Elev', roles: 'Elever og vanlige foreldre kan lære og se familiens delte historikk.',
    admin: 'Gi administratorrettigheter (valgfritt)', adminHint: 'Administratorer kan godkjenne og fjerne kontoer og administrere familiens kalender. Gi dette bare til en betrodd voksen.',
    adminConfirm: 'Gi denne forelderen rett til å administrere familiens kontoer og kalender?',
    grantAdmin: 'Gi administratorrettigheter', revokeAdmin: 'Fjern administratorrettigheter', administrator: 'Administrator',
    save: 'Godkjenn konto', missingRequest: 'Velg en innloggingsforespørsel først. Be personen logge inn, og oppdater listen.',
    list: 'Godkjente kontoer', refresh: 'Oppdater listen', empty: 'Ingen kontoer er godkjent ennå.',
    loading: 'Laster tilgangslisten…', working: 'Oppdaterer tilgangslisten…', offline: 'Du er frakoblet. Koble til for å endre tilgang.',
    loadFailed: 'Kunne ikke laste tilgangslisten. Prøv å oppdatere listen.', failed: 'Endringen kan ha blitt lagret. Oppdater listen og kontroller den før du prøver igjen.',
    expired: 'Forespørselen mangler eller er utløpt. Be personen logge inn igjen, og oppdater listen.',
    approved: 'Kontoen er godkjent. Be personen logge inn igjen.', changed: 'Tilgangen er oppdatert. Personen må logge inn igjen.', removed: 'Tilgangen er fjernet.',
    remove: 'Fjern tilgang', confirm: 'Bekreft fjerning', cancel: 'Avbryt', removeQuestion: 'Fjerne tilgangen for denne kontoen?',
    makeParent: 'Endre til forelder', makeStudent: 'Endre til elev',
  } : {
    title: 'Family access', intro: 'Approve students and parents. Parents can also receive administrator rights if you choose.',
    add: 'Add or approve an account', addIntro: 'Add someone before their first sign-in, or approve an existing sign-in request. No email invitation is sent.',
    mode: 'How would you like to add this account?', beforehand: 'Add before first sign-in', fromRequest: 'Approve a sign-in request',
    addButton: 'Add account', added: 'Account added in advance. Share the one-time access code privately with this person.',
    code: 'One-time access code', codeHint: 'Shown only now. Share this privately with the person. They must use it within 7 days when signing in with the selected email and provider. To issue a new code, remove and add the account again.',
    hideCode: 'Hide access code', pending: 'Added in advance', pendingHint: 'Waiting for first sign-in with the one-time access code.', expires: 'Code expires',
    provider: 'Sign-in provider', microsoft: 'Microsoft personal', email: 'Email address', emailHint: 'Use the personal account’s email address. An account added in advance must also use the one-time access code you share.',
    request: 'Sign-in request', chooseRequest: 'Choose the person’s request', requests: 'Waiting for approval',
    noRequests: 'No new sign-in requests. Ask the person to sign in, then refresh this list.',
    noEmail: 'The provider did not share an email address', useRequest: 'Use this request',
    verify: 'Check directly with the person that this is their request. The provider’s email or username is a display label and can change.',
    role: 'Role', parent: 'Parent', student: 'Student', roles: 'Students and ordinary parents can learn and see the shared family history.',
    admin: 'Give administrator rights (optional)', adminHint: 'Administrators can approve and remove accounts and manage the family calendar. Give this only to a trusted adult.',
    adminConfirm: 'Give this parent permission to manage family accounts and the calendar?',
    grantAdmin: 'Give administrator rights', revokeAdmin: 'Remove administrator rights', administrator: 'Administrator',
    save: 'Approve account', missingRequest: 'Choose a sign-in request first. Ask the person to sign in, then refresh this list.',
    list: 'Approved accounts', refresh: 'Refresh list', empty: 'No accounts have been approved yet.',
    loading: 'Loading access list…', working: 'Updating access list…', offline: 'You are offline. Reconnect to change access.',
    loadFailed: 'Could not load the access list. Try refreshing the list.', failed: 'The change may have been saved. Refresh the list and check it before trying again.',
    expired: 'The request is missing or expired. Ask the person to sign in again, then refresh this list.',
    approved: 'Account approved. Ask the person to sign in again.', changed: 'Access updated. The person must sign in again.', removed: 'Access removed.',
    remove: 'Remove access', confirm: 'Confirm removal', cancel: 'Cancel', removeQuestion: 'Remove access for this account?',
    makeParent: 'Change to parent', makeStudent: 'Change to student',
  };
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [requests, setRequests] = useState<SocialAccessRequest[]>([]);
  const [preapprovals, setPreapprovals] = useState<SocialPreapproval[]>([]);
  const [mode, setMode] = useState<'beforehand' | 'request'>('beforehand');
  const [invitation, setInvitation] = useState<{ code: string; email: string }>();
  const [provider, setProvider] = useState<SocialAccount['provider']>('microsoft');
  const [role, setRole] = useState<SocialAccount['role']>('student');
  const [email, setEmail] = useState('');
  const [requestId, setRequestId] = useState('');
  const [admin, setAdmin] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<'load' | 'mutation' | 'request' | ''>('');
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

  async function refresh(mutation?: (signal: AbortSignal) => Promise<unknown>, result?: Result) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(''); setSuccess(null);
    try {
      if (mutation) await mutation(controller.signal);
      const updated = await api.accessDirectory(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setAccounts(updated.accounts); setRequests(updated.requests); setPreapprovals(updated.preapprovals ?? []); setBlocked(false); setDeleting(undefined);
      if (result === 'approved' || result === 'added') { setEmail(''); setRequestId(''); setAdmin(false); }
      if (result) setSuccess(result);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAccounts(null); setRequests([]); setPreapprovals([]); setInvitation(undefined); denied.current(); return;
      }
      setError(error instanceof ApiError && error.status === 409 ? 'request' : mutation ? 'mutation' : 'load');
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
    if (mode === 'request' && !requests.some(request => request.id === requestId && request.provider === provider)) { setError('request'); return; }
    if (admin && !window.confirm(text.adminConfirm)) return;
    void refresh(async signal => {
      const result = await api.saveSocialAccount({ provider, ...(mode === 'request' ? { requestId } : {}), email: email.trim(), role, admin }, signal);
      if (mounted.current && !signal.aborted && result?.invitationCode) setInvitation({ code: result.invitationCode, email: email.trim() });
    }, mode === 'request' ? 'approved' : 'added');
  }
  const unavailable = busy || blocked || !online;
  const providerName = (value: SocialAccount['provider']) => value === 'google' ? 'Google' : text.microsoft;
  const date = (at: string) => new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));

  return <section className="access-management access-ui" aria-labelledby="access-title">
    <header className="access-ui__intro"><h2 id="access-title">{text.title}</h2><p>{text.intro}</p>
      <button type="button" disabled={busy || !online} onClick={() => void refresh()}>{text.refresh}</button></header>
    {!online && <p className="access-ui__notice" role="status">{text.offline}</p>}
    {error && <p className="access-ui__notice access-ui__notice--error" role="alert">{error === 'request' ? text.expired : error === 'mutation' || blocked ? text.failed : text.loadFailed}</p>}
    {success && <p className="access-ui__notice access-ui__notice--success" role="status">{text[success]}</p>}
    {busy && <p role="status">{accounts ? text.working : text.loading}</p>}
    {invitation && <aside className="access-ui__notice access-ui__notice--success" aria-label={text.code}>
      <h3>{text.code}</h3><p><strong>{invitation.email}</strong></p><code className="access-ui__code">{invitation.code}</code>
      <p>{text.codeHint}</p><button type="button" onClick={() => setInvitation(undefined)}>{text.hideCode}</button>
    </aside>}

    <section className="access-ui__requests" aria-labelledby="access-requests-title">
      <h3 id="access-requests-title">{text.requests}</h3><p className="access-ui__hint">{text.verify}</p>
      {!busy && !requests.length && <p className="access-ui__empty">{text.noRequests}</p>}
      <ul className="access-ui__list">{requests.map(request => <li key={request.id} className="access-ui__account">
        <div className="access-ui__account-info"><strong>{request.email || text.noEmail}</strong>
          <p className="access-ui__hint">{providerName(request.provider)} · <time dateTime={request.requestedAt}>{date(request.requestedAt)}</time></p>
          </div>
        <button type="button" disabled={unavailable} aria-label={`${text.useRequest}: ${request.email || text.noEmail}`} onClick={() => {
          setMode('request'); setProvider(request.provider); setRequestId(request.id); setEmail(request.email || ''); setError(''); setSuccess(null);
        }}>{text.useRequest}</button>
      </li>)}</ul>
    </section>

    <section className="access-ui__guide" aria-labelledby="access-add-title">
      <h3 id="access-add-title">{text.add}</h3><p>{text.addIntro}</p>
      <form className="access-ui__form" onSubmit={submit}>
        <label>{text.mode}<select value={mode} disabled={unavailable} onChange={event => {
          setMode(event.target.value === 'request' ? 'request' : 'beforehand'); setRequestId(''); setError(''); setSuccess(null);
        }}><option value="beforehand">{text.beforehand}</option><option value="request">{text.fromRequest}</option></select></label>
        <label>{text.provider}<select value={provider} disabled={unavailable} onChange={event => {
          setProvider(event.target.value as SocialAccount['provider']); setRequestId('');
        }}><option value="microsoft">{text.microsoft}</option><option value="google">Google</option></select></label>
        <label>{text.email}<input type="email" value={email} disabled={unavailable} onChange={event => {
          const value = event.target.value;
          setEmail(value);
          const matches = requests.filter(request => request.provider === provider && request.email?.toLowerCase() === value.trim().toLowerCase());
          setRequestId(matches.length === 1 ? matches[0].id : '');
        }} maxLength={254} autoComplete="off" aria-describedby="access-email-hint" required /></label>
        <p id="access-email-hint" className="access-ui__hint">{text.emailHint}</p>
        {mode === 'request' && <label>{text.request}<select value={requestId} disabled={unavailable} onChange={event => {
          const id = event.target.value;
          setRequestId(id);
          const request = requests.find(item => item.id === id && item.provider === provider);
          if (request?.email) setEmail(request.email);
          setError(''); setSuccess(null);
        }} required>
          <option value="">{text.chooseRequest}</option>
          {requests.filter(request => request.provider === provider).map(request => <option key={request.id} value={request.id}>
            {request.email || text.noEmail} · {date(request.requestedAt)}
          </option>)}
        </select></label>}
        <label>{text.role}<select value={role} disabled={unavailable} onChange={event => {
          const next = event.target.value as SocialAccount['role'];
          setRole(next); if (next === 'student') setAdmin(false);
        }}><option value="student">{text.student}</option><option value="parent">{text.parent}</option></select></label>
        <p className="access-ui__hint">{text.roles}</p>
        {role === 'parent' && <><label className="access-ui__check"><input type="checkbox" checked={admin} disabled={unavailable}
          onChange={event => setAdmin(event.target.checked)} aria-describedby="access-admin-hint" />{text.admin}</label>
          <p id="access-admin-hint" className="access-ui__hint">{text.adminHint}</p></>}
        <button type="submit" className="primary" disabled={unavailable || !email.trim() || (mode === 'request' && !requestId)}>{mode === 'request' ? text.save : text.addButton}</button>
      </form>
    </section>

    <section className="access-ui__directory" aria-labelledby="access-list-title" aria-busy={busy}>
      <h3 id="access-list-title">{text.list}{accounts && ` (${accounts.length})`}</h3>
      {!busy && accounts?.length === 0 && <p className="access-ui__empty">{text.empty}</p>}
      {accounts && accounts.length > 0 && <ul className="access-ui__list">{accounts.map(account => {
        const identity = account.email || `${providerName(account.provider)} · ${account.role === 'parent' ? text.parent : text.student}`;
        return <li key={account.id} className="access-ui__account">
          <div className="access-ui__account-info"><strong>{identity}</strong>
            <div className="access-ui__account-heading"><span>{providerName(account.provider)}</span>
              <span className="access-ui__badge">{account.role === 'parent' ? text.parent : text.student}</span>
              {account.admin && <span className="access-ui__badge">{text.administrator}</span>}</div>
            </div>
          <div className="access-ui__actions">
            {deleting === account.id
              ? <><p>{text.removeQuestion}</p><button type="button" disabled={unavailable} aria-label={`${text.confirm}: ${identity}`} onClick={() => void refresh(signal => api.removeSocialAccount(account.id, signal), 'removed')}>{text.confirm}</button>
                <button type="button" onClick={() => setDeleting(undefined)}>{text.cancel}</button></>
              : <><button type="button" disabled={unavailable} aria-label={`${account.role === 'parent' ? text.makeStudent : text.makeParent}: ${identity}`} onClick={() => void refresh(signal => api.saveSocialAccount({
                provider: account.provider, subject: account.subject, role: account.role === 'parent' ? 'student' : 'parent', admin: false,
              }, signal), 'changed')}>{account.role === 'parent' ? text.makeStudent : text.makeParent}</button>
                {account.role === 'parent' && <button type="button" disabled={unavailable} aria-label={`${account.admin ? text.revokeAdmin : text.grantAdmin}: ${identity}`} onClick={() => {
                  if (!account.admin && !window.confirm(text.adminConfirm)) return;
                  void refresh(signal => api.saveSocialAccount({ provider: account.provider, subject: account.subject, role: 'parent', admin: !account.admin }, signal), 'changed');
                }}>{account.admin ? text.revokeAdmin : text.grantAdmin}</button>}
                <button type="button" disabled={unavailable} aria-label={`${text.remove}: ${identity}`} onClick={() => setDeleting(account.id)}>{text.remove}</button></>}
          </div>
        </li>;
      })}</ul>}
    </section>
    <section className="access-ui__directory" aria-labelledby="access-preapprovals-title">
      <h3 id="access-preapprovals-title">{text.pending} ({preapprovals.length})</h3><p className="access-ui__hint">{text.pendingHint}</p>
      <ul className="access-ui__list">{preapprovals.map(item => <li key={item.id} className="access-ui__account">
        <div className="access-ui__account-info"><strong>{item.email}</strong>
          <div className="access-ui__account-heading"><span>{providerName(item.provider)}</span>
            <span className="access-ui__badge">{item.role === 'parent' ? text.parent : text.student}</span>
            {item.admin && <span className="access-ui__badge">{text.administrator}</span>}</div>
          <p className="access-ui__hint">{text.expires}: <time dateTime={item.expiresAt}>{date(item.expiresAt)}</time></p>
        </div><div className="access-ui__actions">{deleting === item.id
          ? <><p>{text.removeQuestion}</p><button type="button" disabled={unavailable} aria-label={`${text.confirm}: ${item.email}`}
            onClick={() => void refresh(async signal => {
              await api.removeSocialAccount(item.id, signal);
              setInvitation(current => current?.email === item.email ? undefined : current);
            }, 'removed')}>{text.confirm}</button><button type="button" onClick={() => setDeleting(undefined)}>{text.cancel}</button></>
          : <button type="button" disabled={unavailable} aria-label={`${text.remove}: ${item.email}`} onClick={() => setDeleting(item.id)}>{text.remove}</button>}
        </div></li>)}</ul>
    </section>
  </section>;
}

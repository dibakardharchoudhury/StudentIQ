import { useEffect, useRef, useState } from 'react';
import type { Language } from './api';
import type { AppConfig } from './config';
import { calendarProviderConfigured, connectExternalCalendar, loadCalendarGoogleOAuth } from './calendar-oauth';
import {
  CalendarError, calendarMonthWindow, listCalendarOccurrences, listExternalCalendars,
  type CalendarConnection, type CalendarFailure, type CalendarOccurrence, type CalendarProvider,
  type CalendarWindow, type ExternalCalendar,
} from './calendar-provider';
import './external-calendars.css';

const labels = {
  en: {
    title: 'External calendars · read-only',
    intro: 'Connect an account separately with calendar consent. StudentIQ sign-in does not grant calendar access. Choose only an account you are allowed to read; child accounts are never connected automatically.',
    privacy: 'Tokens and calendar data stay in this tab’s memory, not in StudentIQ storage. Disconnect clears this view and access token; it does not revoke the provider grant. Manage grants in your Google or Microsoft account.',
    window: 'Visible month window (start inclusive, end exclusive)',
    timezone: 'Timed events are shown in', allDay: 'All day · calendar dates', exclusive: 'end exclusive',
    connect: 'Connect', disconnect: 'Disconnect', refresh: 'Refresh external calendars',
    connecting: 'Waiting for account choice and read-only consent…', loading: 'Loading calendars and occurrences…',
    connected: 'Read-only calendar consent granted', disconnected: 'Not connected',
    empty: 'No calendars were returned for this account.', noEvents: 'No occurrences in this window.',
    offline: 'External calendars need an internet connection.',
    pagination: 'All provider pages are fetched automatically, including recurring occurrences. Safety limits: 100 calendars per refresh; 100 pages and 10,000 rows per collection. A limit or failed calendar is reported, not silently omitted.',
    count: 'Calendars returned', events: 'occurrences', retry: 'Retry Google calendar library',
    work: 'Microsoft work or school', personal: 'Microsoft personal', google: 'Google',
    setup: 'Calendar setup / consent',
    googleSetup: 'Google needs public config.googleClientId, an enabled Google Calendar API, an OAuth web client with this site in Authorized JavaScript origins, and a published/test-user consent screen. Requested scopes: calendar.calendarlist.readonly and calendar.events.readonly.',
    workSetup: 'Work/school needs config.clientId + tenantId, a Microsoft Entra SPA redirect URI for this site’s auth.html, an Exchange mailbox, and delegated Calendars.Read.Shared consent (including shared calendars). Your organization may require administrator approval.',
    personalSetup: 'Personal Microsoft needs config.microsoftPersonalClientId, an app registration accepting personal Microsoft accounts, this site’s auth.html as a SPA redirect URI, and delegated Calendars.ReadBasic consent.',
    missing: 'Not configured. Supply the public AppConfig to PlanningCalendar; no client secrets are used.',
    errors: {
      consent: 'Calendar consent was declined, incomplete, or unavailable. Check the app configuration, mailbox, and tenant consent policy, then reconnect.',
      expired: 'Calendar access expired. Data was cleared. Reconnect to grant access again.',
      request: 'The calendar provider could not complete the request (possibly throttled or offline). Retry; no complete result is claimed.',
      pagination: 'Unsafe or invalid provider pagination was blocked. This calendar result is unavailable.',
      limit: 'Calendar safety limit reached or repeated page detected. This result is incomplete and is not displayed. Use the provider directly for the full calendar.',
      format: 'The provider returned an unsupported calendar/date format. This result is not displayed.',
      configuration: 'Calendar OAuth could not load or is not configured. Check setup, browser popup/content restrictions, and retry.',
    },
  },
  nb: {
    title: 'Eksterne kalendere · skrivebeskyttet',
    intro: 'Koble til en konto separat med kalendersamtykke. StudentIQ-innlogging gir ikke kalendertilgang. Velg bare en konto du har lov til å lese; barnekontoer kobles aldri til automatisk.',
    privacy: 'Tilgangstokener og kalenderdata finnes bare i minnet i denne fanen, ikke i StudentIQ-lagring. Frakobling tømmer visningen og tokenet, men trekker ikke tilbake leverandørens samtykke. Administrer samtykker i Google- eller Microsoft-kontoen din.',
    window: 'Periode for vist måned (start inkludert, slutt ikke inkludert)',
    timezone: 'Tidssone for hendelser med klokkeslett:', allDay: 'Hele dagen · kalenderdatoer', exclusive: 'slutt ikke inkludert',
    connect: 'Koble til', disconnect: 'Koble fra', refresh: 'Oppdater eksterne kalendere',
    connecting: 'Venter på kontovalg og skrivebeskyttet samtykke…', loading: 'Laster kalendere og forekomster…',
    connected: 'Skrivebeskyttet kalendersamtykke gitt', disconnected: 'Ikke tilkoblet',
    empty: 'Ingen kalendere ble returnert for denne kontoen.', noEvents: 'Ingen forekomster i denne perioden.',
    offline: 'Eksterne kalendere krever internettforbindelse.',
    pagination: 'Alle sider hentes automatisk, inkludert gjentakende forekomster. Sikkerhetsgrenser: 100 kalendere per oppdatering; 100 sider og 10 000 rader per samling. Grenser og feil rapporteres, ikke utelates i stillhet.',
    count: 'Kalendere returnert', events: 'forekomster', retry: 'Last Google-kalenderbiblioteket på nytt',
    work: 'Microsoft jobb eller skole', personal: 'Microsoft personlig', google: 'Google',
    setup: 'Kalenderoppsett / samtykke',
    googleSetup: 'Google krever offentlig config.googleClientId, aktivert Google Calendar API, en OAuth-nettklient med dette nettstedet i autoriserte JavaScript-opprinnelser og en publisert samtykkeskjerm eller testbrukere. Tilganger: calendar.calendarlist.readonly og calendar.events.readonly.',
    workSetup: 'Jobb/skole krever config.clientId + tenantId, en Microsoft Entra SPA-omdirigeringsadresse til nettstedets auth.html, en Exchange-postboks og delegert Calendars.Read.Shared-samtykke (inkludert delte kalendere). Organisasjonen kan kreve administratorgodkjenning.',
    personalSetup: 'Personlig Microsoft-konto krever config.microsoftPersonalClientId, en appregistrering som godtar personlige Microsoft-kontoer, nettstedets auth.html som SPA-omdirigeringsadresse og delegert Calendars.ReadBasic-samtykke.',
    missing: 'Ikke konfigurert. Gi offentlig AppConfig til PlanningCalendar; ingen klienthemmeligheter brukes.',
    errors: {
      consent: 'Kalendersamtykke ble avslått, er ufullstendig eller utilgjengelig. Sjekk appoppsett, postboks og samtykkeregler, og koble til på nytt.',
      expired: 'Kalendertilgangen er utløpt. Dataene er slettet. Koble til på nytt.',
      request: 'Kalenderleverandøren kunne ikke fullføre forespørselen (mulig hastighetsgrense eller nettverksfeil). Prøv igjen; resultatet er ikke merket som komplett.',
      pagination: 'Usikker eller ugyldig sidekobling ble blokkert. Dette kalenderresultatet er utilgjengelig.',
      limit: 'Sikkerhetsgrense nådd eller gjentatt side oppdaget. Dette ufullstendige resultatet vises ikke. Bruk leverandøren direkte for hele kalenderen.',
      format: 'Leverandøren returnerte et kalender- eller datoformat som ikke støttes. Dette resultatet vises ikke.',
      configuration: 'Kalender-OAuth kunne ikke lastes eller er ikke konfigurert. Sjekk oppsett og nettleserens popup-/innholdsbegrensninger, og prøv igjen.',
    },
  },
};
type LoadedCalendar = ExternalCalendar & { events?: CalendarOccurrence[]; error?: CalendarFailure };
const providers: CalendarProvider[] = ['google', 'microsoft-work', 'microsoft-personal'];
function errorCode(error: unknown): CalendarFailure {
  return error instanceof CalendarError ? error.code : 'request';
}
function providerName(provider: CalendarProvider, language: Language) {
  const c = labels[language];
  return provider === 'google' ? c.google : provider === 'microsoft-work' ? c.work : c.personal;
}

function CalendarSource({ provider, config, language, online, window: dateWindow }: {
  provider: CalendarProvider; config?: AppConfig; language: Language; online: boolean; window: CalendarWindow;
}) {
  const c = labels[language];
  const [connection, setConnection] = useState<CalendarConnection>();
  const connectionRef = useRef<CalendarConnection | undefined>(undefined);
  const generation = useRef(0);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calendars, setCalendars] = useState<LoadedCalendar[]>();
  const [failure, setFailure] = useState<CalendarFailure>();
  const [reload, setReload] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const configured = calendarProviderConfigured(config, provider);
  const clientId = provider === 'google' ? config?.googleClientId : provider === 'microsoft-personal'
    ? config?.microsoftPersonalClientId : config?.clientId;

  function disconnect() {
    generation.current++;
    connectionRef.current?.dispose(); connectionRef.current = undefined;
    setConnection(undefined); setCalendars(undefined); setFailure(undefined); setConnecting(false); setLoading(false);
  }
  useEffect(() => {
    const leave = () => disconnect();
    window.addEventListener('pagehide', leave);
    return () => {
      generation.current++;
      connectionRef.current?.dispose(); connectionRef.current = undefined;
      window.removeEventListener('pagehide', leave);
    };
  }, []);
  useEffect(() => {
    disconnect();
  }, [clientId, config?.tenantId]);
  useEffect(() => {
    if (provider !== 'google' || !configured) return;
    let active = true;
    setGoogleReady(false);
    void loadCalendarGoogleOAuth().then(() => { if (active) setGoogleReady(true); })
      .catch(() => { if (active) setFailure('configuration'); });
    return () => { active = false; };
  }, [provider, configured, libraryAttempt]);
  useEffect(() => {
    if (!connection) return;
    const expire = () => { disconnect(); setFailure('expired'); };
    const timer = window.setTimeout(expire, Math.max(0, connection.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [connection]);
  useEffect(() => {
    setCalendars(undefined);
    if (!connection || !online) { setLoading(false); return; }
    setFailure(undefined);
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const found = await listExternalCalendars(connection, controller.signal);
        if (controller.signal.aborted) return;
        if (found.length > 100) throw new CalendarError('limit');
        const result: LoadedCalendar[] = [];
        for (const calendar of found) {
          if (controller.signal.aborted) return;
          try {
            const events = await listCalendarOccurrences(connection, calendar.id, dateWindow, controller.signal);
            result.push({ ...calendar, events });
          } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof CalendarError && error.code === 'expired') throw error;
            result.push({ ...calendar, error: errorCode(error) });
          }
        }
        if (!controller.signal.aborted) setCalendars(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof CalendarError && error.code === 'expired') disconnect();
        setFailure(errorCode(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [connection, online, dateWindow.start, dateWindow.end, dateWindow.timeZone, reload]);

  async function connect() {
    if (!config || connecting || connection) return;
    const attempt = ++generation.current;
    setConnecting(true); setFailure(undefined);
    try {
      const result = await connectExternalCalendar(config, provider);
      if (attempt !== generation.current) { result.dispose(); return; }
      connectionRef.current = result; setConnection(result);
    } catch (error) {
      if (attempt === generation.current) setFailure(errorCode(error));
    } finally { if (attempt === generation.current) setConnecting(false); }
  }
  const setup = provider === 'google' ? c.googleSetup : provider === 'microsoft-work' ? c.workSetup : c.personalSetup;
  const timeFormatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: dateWindow.timeZone });
  return <section className="external-calendar-source" aria-label={providerName(provider, language)}>
    <h3>{providerName(provider, language)}</h3>
    <p>{connection ? c.connected : c.disconnected}</p>
    {!configured && <p className="notice">{c.missing}</p>}
    <details><summary>{c.setup}</summary><p>{setup}</p></details>
    <div className="external-calendar-actions">
      {!connection && <button type="button" disabled={!configured || !online || connecting || (provider === 'google' && !googleReady)}
        onClick={() => void connect()}>{c.connect} {providerName(provider, language)}</button>}
      {(connection || connecting) && <button type="button" onClick={disconnect}>{c.disconnect} {providerName(provider, language)}</button>}
      {connection && <button type="button" disabled={!online || loading} onClick={() => setReload(value => value + 1)}>{c.refresh}</button>}
      {provider === 'google' && configured && !googleReady && failure && <button type="button"
        disabled={!online} onClick={() => { setFailure(undefined); setLibraryAttempt(value => value + 1); }}>{c.retry}</button>}
    </div>
    {connecting && <p role="status">{c.connecting}</p>}
    {loading && <p role="status">{c.loading}</p>}
    {failure && <p role="alert">{c.errors[failure]}</p>}
    {calendars && <div>
      <p>{c.count}: {calendars.length}</p>
      {!calendars.length && <p>{c.empty}</p>}
      {calendars.map(calendar => <section key={calendar.id} className="external-calendar-list" aria-label={calendar.name}>
        <h4>{calendar.name}</h4>
        {calendar.error ? <p role="alert">{c.errors[calendar.error]}</p> : <>
          <p>{calendar.events?.length} {c.events}</p>
          {!calendar.events?.length && <p>{c.noEvents}</p>}
          <ul>{calendar.events?.map(event => <li key={event.id}>
            <strong>{event.title}</strong>
            <span>{event.allDay ? `${c.allDay}: ${event.start} → ${event.end} (${c.exclusive})`
              : `${timeFormatter.format(new Date(event.start))} → ${timeFormatter.format(new Date(event.end))}`}</span>
          </li>)}</ul>
        </>}
      </section>)}
    </div>}
  </section>;
}

export default function ExternalCalendars({ config, language, online, year, month }: {
  config?: AppConfig; language: Language; online: boolean; year: number; month: number;
}) {
  const c = labels[language];
  const dateWindow = calendarMonthWindow(year, month);
  return <section className="external-calendars" aria-label={c.title}>
    <h2>{c.title}</h2><p>{c.intro}</p><p>{c.privacy}</p>
    <p>{c.window}: <time dateTime={dateWindow.start}>{dateWindow.start}</time> → <time dateTime={dateWindow.end}>{dateWindow.end}</time></p>
    <p>{c.timezone} <strong>{dateWindow.timeZone}</strong>.</p>
    <p className="small">{c.pagination}</p>
    {!online && <p role="status">{c.offline}</p>}
    <div className="external-calendar-sources">{providers.map(provider => <CalendarSource key={provider}
      provider={provider} config={config} language={language} online={online} window={dateWindow} />)}</div>
  </section>;
}

import { useEffect, useState } from 'react';
import type { Language } from './api';

export default function BuildStatus({ language, busy, hasDraft }: {
  language: Language; busy: boolean; hasDraft: boolean;
}) {
  const [latest, setLatest] = useState('');
  const [failed, setFailed] = useState(false);
  const version = import.meta.env.VITE_APP_VERSION;
  const builtAt = import.meta.env.VITE_BUILD_TIME;
  const c = language === 'nb' ? {
    version: 'Versjon', built: 'Bygget', update: 'Ny versjon klar · oppdater',
    failed: 'Kunne ikke sjekke etter oppdateringer. Prøver igjen når du er tilkoblet.',
    confirm: 'Oppdatering tømmer den usendte teksten og denne innloggingsøkten. Fortsette?',
    note: 'Oppdatering laster appen på nytt. Lagrede økter beholdes; logg inn igjen etterpå.',
  } : {
    version: 'Version', built: 'Built', update: 'New version ready · refresh',
    failed: 'Could not check for updates. Will retry when connected.',
    confirm: 'Refreshing clears your unsent text and this sign-in session. Continue?',
    note: 'Refreshing reloads the app. Saved sessions remain; sign in again afterward.',
  };
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let active: AbortController | undefined;
    const check = () => {
      if (!navigator.onLine || document.hidden || active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      void fetch(`${import.meta.env.BASE_URL}version.json`, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      }).then(async response => {
        if (!response.ok) throw new Error('Version check failed');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string'
          || !data.version || !('builtAt' in data) || typeof data.builtAt !== 'string'
          || !Number.isFinite(Date.parse(data.builtAt))) throw new Error('Invalid version information');
        if (!controller.signal.aborted) { setLatest(data.version); setFailed(false); }
      }).catch(() => { if (active === controller) setFailed(true); })
        .finally(() => { window.clearTimeout(timeout); if (active === controller) active = undefined; });
    };
    check();
    const timer = window.setInterval(check, 60000);
    const updateError = () => setFailed(true);
    window.addEventListener('online', check);
    window.addEventListener('studentiq-update-error', updateError);
    document.addEventListener('visibilitychange', check);
    return () => {
      const controller = active;
      active = undefined;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('studentiq-update-error', updateError);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  const timestamp = new Intl.DateTimeFormat(language === 'nb' ? 'nb-NO' : 'en-GB', {
    timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'long',
  }).format(new Date(builtAt));
  return <div className="build-status">
    <span>{c.version} <code>{import.meta.env.VITE_APP_RELEASE}</code></span>
    <span>{c.built} <time dateTime={builtAt}>{timestamp}</time> · Europe/Oslo</span>
    {latest && latest !== version && <div role="status">
      <button type="button" disabled={busy} onClick={() => {
        if (!hasDraft || window.confirm(c.confirm)) window.location.reload();
      }}>{c.update}</button>
      <p>{c.note}</p>
    </div>}
    {failed && <span role="status">{c.failed}</span>}
  </div>;
}

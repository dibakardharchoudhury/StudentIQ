import { useEffect, useRef, useState } from 'react';
import type { Api, Language, Preferences } from './api';
import { copy } from './i18n';

const defaults: Preferences = { appearance: 'rose', voice: 'default', mood: 'gentle' };

export default function TeacherSettings({ api, language, disabled, online, onChange, onBusyChange }: {
  api: Api; language: Language; disabled: boolean; online: boolean;
  onChange(preferences: Preferences | null): void; onBusyChange(busy: boolean): void;
}) {
  const c = copy(language);
  const [draft, setDraft] = useState<Preferences>(defaults);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    void sync();
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [api]);
  async function sync(save = false) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const result = save ? await api.savePreferences(draft, controller.signal) : await api.preferences(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setDraft(result); setSaved(true); setDirty(false); setBlocked(false); changed.current(result);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setSaved(false); changed.current(null);
      setError(`${error instanceof Error ? error.message : c.preferenceFallback}${save ? ` ${c.preferenceAmbiguous}` : ''}`);
      if (save) setBlocked(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  return <section className="teacher-settings">
    <p className="small" role="status">{busy ? c.preferenceLoading : saved ? dirty ? c.preferenceDraft : c.preferenceSynced : c.preferenceFallback}</p>
    <details>
    <summary>{c.customize}</summary>
    <p className="small">{c.preferenceNote}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); if (!disabled && !busy && !blocked && online) void sync(true); }}>
      <label>{c.appearance}<select value={draft.appearance} disabled={disabled || busy}
        onChange={event => { setDirty(true); setDraft(value => ({ ...value, appearance: event.target.value as Preferences['appearance'] })); }}>
        <option value="rose">{c.rose}</option><option value="sunny">{c.sunny}</option><option value="mint">{c.mint}</option>
      </select></label>
      <label>{c.teacherVoice}<select value={draft.voice} disabled={disabled || busy}
        onChange={event => { setDirty(true); setDraft(value => ({ ...value, voice: event.target.value as Preferences['voice'] })); }}>
        <option value="default">{language === 'nb' ? 'Pernille · nb-NO' : 'Jenny · en-US'}</option>
        <option value="alternate">{language === 'nb' ? 'Finn · nb-NO' : 'Aria · en-US'}</option>
      </select></label>
      <label>{c.teacherMood}<select value={draft.mood} disabled={disabled || busy}
        onChange={event => { setDirty(true); setDraft(value => ({ ...value, mood: event.target.value as Preferences['mood'] })); }}>
        <option value="gentle">{c.gentle}</option><option value="cheerful">{c.cheerful}</option><option value="calm">{c.calm}</option>
      </select></label>
      <button type="submit" disabled={disabled || busy || blocked || !online}>{c.savePreferences}</button>
      <button type="button" disabled={disabled || busy || !online} onClick={() => void sync()}>{c.refreshPreferences}</button>
    </form>
    </details>
  </section>;
}

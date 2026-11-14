import { useId, useState } from 'react';
import type { Language } from './api';
import { applyAvatarPrompt, AvatarPromptError, defaultAvatar, type AvatarStyle } from './avatar-style';

export default function AvatarCustomizer({ value, onChange, language, disabled = false }: {
  value: AvatarStyle; onChange(value: AvatarStyle): void; language: Language; disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const hint = useId();
  const c = language === 'nb' ? {
    title: 'Design læringsvennen din', label: 'Hvordan skal læreren se ut?',
    hint: 'Prøv «blå genser, kort hår og briller». Støtter farger på hår og klær, kort eller langt hår og briller. Bruk separate uttrykk for hver endring.',
    local: 'Endres med en gang, bare i denne fanen. Ingen AI-kall, bilder eller lagret prompt.',
    apply: 'Endre avatar', reset: 'Tilbakestill avatar',
    unsupported: 'Det kan jeg ikke tegne ennå. Bruk hår- eller klesfarger, kort/langt hår og briller/uten briller. Ingen endringer ble gjort.',
    conflicting: 'Velg bare én verdi for hver egenskap, for eksempel én hårfarge. Ingen endringer ble gjort.',
    changed: 'Avatarens stil er oppdatert i denne fanen.', restored: 'Standardavataren er tilbake.',
  } : {
    title: 'Design your learning companion', label: 'How should your teacher look?',
    hint: 'Try “blue shirt, short hair and glasses”. Supports hair and shirt colours, short or long hair, and glasses. Use a separate phrase for each change.',
    local: 'Changes instantly in this tab only. No AI calls, generated images, or stored prompt.',
    apply: 'Change avatar', reset: 'Reset avatar',
    unsupported: 'I cannot draw that yet. Use hair or shirt colours, short/long hair, and glasses/no glasses. Nothing was changed.',
    conflicting: 'Choose one value for each feature, such as one hair colour. Nothing was changed.',
    changed: 'Avatar style updated in this tab.', restored: 'Default avatar restored.',
  };
  return <section className="avatar-customizer">
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{c.title}</summary>
      {open && <>
      <form onSubmit={event => {
        event.preventDefault();
        if (disabled) return;
        setError(''); setStatus('');
        let next: AvatarStyle;
        try { next = applyAvatarPrompt(prompt, value); }
        catch (error) {
          if (!(error instanceof AvatarPromptError)) throw error;
          setError(error.reason === 'conflicting' ? c.conflicting : c.unsupported); return;
        }
        onChange(next); setStatus(c.changed);
      }}>
        <label>{c.label}<input value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={180}
          disabled={disabled} aria-describedby={hint} required /></label>
        <p className="small" id={hint}>{c.hint}</p><p className="small">{c.local}</p>
        <div><button type="submit" disabled={disabled || !prompt.trim()}>{c.apply}</button>
          <button type="button" disabled={disabled} onClick={() => {
            onChange({ ...defaultAvatar }); setPrompt(''); setError(''); setStatus(c.restored);
          }}>{c.reset}</button></div>
      </form>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      </>}
    </details>
  </section>;
}

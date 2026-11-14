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
    hint: 'Prøv «lilla hår, blå genser og sløyfe». Støtter farger, kort/langt hår, briller, sløyfe og stjernemerke. Bruk «uten» for å fjerne tilbehør.',
    local: 'Endres med en gang, bare i denne fanen. Ingen AI-kall, bilder eller lagret prompt.',
    apply: 'Endre avatar', reset: 'Tilbakestill avatar',
    unsupported: 'Det kan jeg ikke tegne ennå. Bruk hår- eller klesfarger, kort/langt hår, briller, sløyfe eller stjernemerke. Ingen endringer ble gjort.',
    conflicting: 'Velg bare én verdi for hver egenskap, for eksempel én hårfarge. Ingen endringer ble gjort.',
    changed: 'Avatarens stil er oppdatert i denne fanen.', restored: 'Standardavataren er tilbake.',
  } : {
    title: 'Design your learning companion', label: 'How should your teacher look?',
    hint: 'Try “purple hair, blue shirt and a bow”. Supports colours, short/long hair, glasses, a bow and a star badge. Use “without” to remove accessories.',
    local: 'Changes instantly in this tab only. No AI calls, generated images, or stored prompt.',
    apply: 'Change avatar', reset: 'Reset avatar',
    unsupported: 'I cannot draw that yet. Use hair or shirt colours, short/long hair, glasses, a bow or a star badge. Nothing was changed.',
    conflicting: 'Choose one value for each feature, such as one hair colour. Nothing was changed.',
    changed: 'Avatar style updated in this tab.', restored: 'Default avatar restored.',
  };
  return <section className="avatar-customizer">
    <button type="button" className="avatar-customizer__toggle" aria-expanded={open} aria-controls={`${hint}-panel`}
      onClick={() => setOpen(value => !value)}>{c.title}</button>
    <div id={`${hint}-panel`} hidden={!open}>
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
    </div>
  </section>;
}

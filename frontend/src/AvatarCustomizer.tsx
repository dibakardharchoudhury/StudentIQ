import { useId, useState } from 'react';
import type { Language } from './api';
import { applyAvatarPrompt, AvatarPromptError, avatarColors, skinTones, defaultAvatar, type AvatarStyle, type AvatarColor } from './avatar-style';

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
    hint: 'Prøv «hudtone 4, krøllete svart hår, brune øyne og rundt ansikt». Du kan også velge hår- og klesfarger, hestehale, briller, sløyfe og stjernemerke. Bruk «uten» for å fjerne hår eller tilbehør.',
    local: 'Endres med en gang, bare i denne fanen. Ingen AI-kall, bilder eller lagret prompt.',
    apply: 'Endre avatar', reset: 'Tilbakestill avatar',
    unsupported: 'Jeg kunne ikke koble hele beskrivelsen til kontrollene. Beskriv hudtone, frisyre, øye- eller klesfarge, ansiktsform eller tilbehør. Dette er en 3D-figur, ikke fri bildegenerering. Ingen endringer ble gjort.',
    describeFeatures: 'En bengalsk eller indisk lærer kan ha mange ulike utseender. Beskriv egenskapene du ønsker, som «hudtone 4, langt svart hår og rundt ansikt», eller bruk kontrollene over. Ingen egenskaper blir gjettet ut fra bakgrunn.',
    conflicting: 'Velg bare én verdi for hver egenskap, for eksempel én hårfarge. Ingen endringer ble gjort.',
    changed: 'Avatarens stil er oppdatert i denne fanen.', restored: 'Standardavataren er tilbake.',
    skin: 'Hudtone', hair: 'Hårfarge', style: 'Frisyre', shirt: 'Klesfarge', eyes: 'Øyenfarge',
    face: 'Ansiktsform', oval: 'Oval', round: 'Rund', theme: 'Følg temaet',
    short: 'Kort', long: 'Langt', curly: 'Krøller', ponytail: 'Hestehale', none: 'Uten hår',
    glasses: 'Briller', bow: 'Sløyfe', badge: 'Stjernemerke',
    choose: 'Velg egenskapene du liker. Det finnes ikke ett bestemt utseende for en nasjonalitet eller bakgrunn.',
    shade: 'Tone',
  } : {
    title: 'Design your learning companion', label: 'How should your teacher look?',
    hint: 'Try “skin shade 4, curly black hair, brown eyes and a round face”. You can also choose clothing colours, a ponytail, glasses, a bow and a star badge. Use “without” to remove hair or accessories.',
    local: 'Changes instantly in this tab only. No AI calls, generated images, or stored prompt.',
    apply: 'Change avatar', reset: 'Reset avatar',
    unsupported: 'I could not match the whole description to the controls. Describe a skin shade, hairstyle, eye or clothing colour, face shape, or accessories. This edits a 3D character, not unrestricted generated artwork. Nothing was changed.',
    describeFeatures: 'A Bengali or Indian teacher can have many different appearances. Describe the features you want, such as “skin shade 4, long black hair and a round face”, or use the controls above. Background alone is not used to guess features.',
    conflicting: 'Choose one value for each feature, such as one hair colour. Nothing was changed.',
    changed: 'Avatar style updated in this tab.', restored: 'Default avatar restored.',
    skin: 'Skin tone', hair: 'Hair colour', style: 'Hairstyle', shirt: 'Clothing colour', eyes: 'Eye colour',
    face: 'Face shape', oval: 'Oval', round: 'Round', theme: 'Match the theme',
    short: 'Short', long: 'Long', curly: 'Curly', ponytail: 'Ponytail', none: 'No hair',
    glasses: 'Glasses', bow: 'Hair bow', badge: 'Star badge',
    choose: 'Choose the features you like. There is no single look for a nationality or background.',
    shade: 'Shade',
  };
  const colorNames: Record<AvatarColor, string> = language === 'nb'
    ? { brown: 'Brun', black: 'Svart', blonde: 'Blond', white: 'Hvit', red: 'Rød', orange: 'Oransje', yellow: 'Gul', green: 'Grønn', blue: 'Blå', purple: 'Lilla', pink: 'Rosa', teal: 'Turkis' }
    : { brown: 'Brown', black: 'Black', blonde: 'Blonde', white: 'White', red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', teal: 'Teal' };
  function update<K extends keyof AvatarStyle>(key: K, next: AvatarStyle[K]) {
    onChange({ ...value, [key]: next }); setError(''); setStatus(c.changed);
  }
  return <section className="avatar-customizer">
    <button type="button" className="avatar-customizer__toggle" aria-expanded={open} aria-controls={`${hint}-panel`}
      onClick={() => setOpen(value => !value)}>{c.title}</button>
    <div id={`${hint}-panel`} hidden={!open}>
      {open && <>
      <p className="small">{c.choose}</p>
      <div className="avatar-feature-controls">
        <fieldset disabled={disabled}><legend>{c.skin}</legend>
          <div className="avatar-swatches">{Object.entries(skinTones).map(([tone, color], index) =>
            <button type="button" key={tone} aria-label={`${c.skin}: ${c.shade} ${index + 1}`}
              aria-pressed={value.skin === tone} style={{ backgroundColor: color }}
              onClick={() => update('skin', tone as AvatarStyle['skin'])}>
              <span className="sr-only">{value.skin === tone ? '✓' : ''}</span>
            </button>)}</div>
        </fieldset>
        <label>{c.style}<select value={value.hairLength} disabled={disabled}
          onChange={event => update('hairLength', event.target.value as AvatarStyle['hairLength'])}>
          {(['short', 'long', 'curly', 'ponytail', 'none'] as const).map(style => <option key={style} value={style}>{c[style]}</option>)}
        </select></label>
        {(['hair', 'eyes', 'shirt'] as const).map(feature => <label key={feature}>{c[feature]}
          <select value={value[feature]} disabled={disabled} onChange={event => update(feature, event.target.value as AvatarStyle[typeof feature])}>
            {feature === 'shirt' && <option value="theme">{c.theme}</option>}
            {(Object.keys(avatarColors) as AvatarColor[]).map(color => <option value={color} key={color}>{colorNames[color]}</option>)}
          </select></label>)}
        <label>{c.face}<select value={value.face} disabled={disabled} onChange={event => update('face', event.target.value as AvatarStyle['face'])}>
          <option value="oval">{c.oval}</option><option value="round">{c.round}</option>
        </select></label>
        {(['glasses', 'bow', 'badge'] as const).map(feature => <label key={feature} className="avatar-accessory">
          <input type="checkbox" checked={value[feature]} disabled={disabled}
            onChange={event => update(feature, event.target.checked)} />{c[feature]}</label>)}
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        if (disabled) return;
        setError(''); setStatus('');
        let next: AvatarStyle;
        try { next = applyAvatarPrompt(prompt, value); }
        catch (error) {
          if (!(error instanceof AvatarPromptError)) throw error;
          setError(error.reason === 'conflicting' ? c.conflicting
            : error.reason === 'describe-features' ? c.describeFeatures : c.unsupported); return;
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

import { useEffect, useRef, useState } from 'react';
import type { Language } from './api';
import { copy } from './i18n';

export default function GentleCheckIn({ language, paused, onBreak }: {
  language: Language; paused: boolean; onBreak(): void;
}) {
  const c = copy(language);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const offered = useRef(false);
  useEffect(() => {
    if (!enabled || paused) { setVisible(false); return; }
    let timer: ReturnType<typeof setTimeout>;
    let hiddenAt: number | undefined;
    const offer = () => {
      if (offered.current || document.hidden) return;
      offered.current = true; setVisible(true); clearTimeout(timer);
    };
    const reset = () => {
      clearTimeout(timer);
      if (!offered.current && !document.hidden) timer = setTimeout(offer, 5 * 60_000);
    };
    const visibility = () => {
      if (document.hidden) { hiddenAt = Date.now(); clearTimeout(timer); }
      else {
        if (hiddenAt !== undefined && Date.now() - hiddenAt >= 2 * 60_000) offer();
        hiddenAt = undefined; reset();
      }
    };
    reset();
    document.addEventListener('pointerdown', reset, { passive: true });
    document.addEventListener('keydown', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', reset);
      document.removeEventListener('keydown', reset);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, paused]);
  return <div className="check-in">
    <label className="encouragement-toggle"><input type="checkbox" checked={enabled} onChange={event => {
      offered.current = false; setVisible(false); setEnabled(event.target.checked);
    }} />{c.checkInOption}</label>
    <p className="small">{c.checkInNote}</p>
    {visible && <div className="notice" role="status"><p>{c.checkInMessage}</p>
      <button type="button" onClick={() => { setVisible(false); onBreak(); }}>{c.pause}</button>
      <button type="button" onClick={() => setVisible(false)}>{c.dismissBreak}</button>
    </div>}
  </div>;
}

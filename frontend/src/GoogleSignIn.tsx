import { useEffect, useRef, useState } from 'react';
import { makeNonce } from './auth';
import type { Language } from './api';
import { copy } from './i18n';

type GoogleIdentity = {
  accounts: { id: {
    initialize(config: { client_id: string; nonce: string; callback(response: { credential: string }): void }): void;
    renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
  } };
};

declare global {
  interface Window { google?: GoogleIdentity }
}

export default function GoogleSignIn({ clientId, disabled, language, onCredential }: {
  clientId: string; disabled: boolean; language: Language; onCredential(token: string, nonce: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);
  callback.current = onCredential;
  useEffect(() => {
    let active = true;
    const nonce = makeNonce();
    const initialize = () => {
      if (!active || !container.current) return;
      if (!window.google) { setFailure(true); return; }
      window.google.accounts.id.initialize({
        client_id: clientId, nonce,
        callback: response => { if (active && response.credential) callback.current(response.credential, nonce); },
      });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, { theme: 'outline', size: 'large' });
    };
    let script: HTMLScriptElement | undefined;
    if (window.google) initialize();
    else {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initialize;
      script.onerror = () => { if (active) setFailure(true); };
      document.head.appendChild(script);
    }
    return () => {
      active = false;
      if (script) { script.onload = null; script.onerror = null; script.remove(); }
    };
  }, [clientId, attempt]);
  return <div>
    <div ref={container} inert={disabled} />
    {failure && <div>
      <p role="alert">{copy(language).googleLoadError}</p>
      <button type="button" disabled={disabled} onClick={() => { setFailure(false); setAttempt(value => value + 1); }}>
        {copy(language).googleRetry}
      </button>
    </div>}
  </div>;
}

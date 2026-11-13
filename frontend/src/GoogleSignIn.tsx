import { useEffect, useRef, useState } from 'react';
import { makeNonce } from './auth';

type GoogleIdentity = {
  accounts: { id: {
    initialize(config: { client_id: string; nonce: string; callback(response: { credential: string }): void }): void;
    renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
  } };
};

declare global {
  interface Window { google?: GoogleIdentity }
}

export default function GoogleSignIn({ clientId, disabled, onCredential }: {
  clientId: string; disabled: boolean; onCredential(token: string, nonce: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [failure, setFailure] = useState(false);
  callback.current = onCredential;
  useEffect(() => {
    let active = true;
    const nonce = makeNonce();
    const initialize = () => {
      if (!active || !container.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId, nonce,
        callback: response => { if (active && response.credential) callback.current(response.credential, nonce); },
      });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, { theme: 'outline', size: 'large' });
    };
    if (window.google) initialize();
    else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initialize;
      script.onerror = () => { if (active) setFailure(true); };
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [clientId]);
  return <div>
    <div ref={container} inert={disabled} />
    {failure && <p role="alert">Google sign-in could not load. Check your connection and try again.</p>}
  </div>;
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Only production static assets are cached. Runtime config and all network data bypass the worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL, updateViaCache: 'none',
    }).then(registration => {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) {
          void registration.update().catch(() => {
            window.dispatchEvent(new Event('studentiq-update-error'));
          });
        }
      });
    }).catch(() => {
      // Installation is optional; do not pretend that offline installation succeeded.
      const notice = document.createElement('p');
      notice.setAttribute('role', 'status');
      notice.className = 'notice';
      notice.textContent = 'Offline shell could not be installed. Online tutoring is still available. / Frakoblet appskall kunne ikke installeres.';
      document.body.appendChild(notice);
    });
  });
}

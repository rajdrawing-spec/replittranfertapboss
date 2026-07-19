import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// When the new service worker activates (skipWaiting: true + clientsClaim: true),
// it takes over immediately and sends a CONTROLLING_CLIENT event. Reload the page
// so the freshly-activated SW serves the latest assets instead of stale ones.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload if the page hasn't already reloaded this session, preventing
    // a reload loop if something else triggers controllerchange.
    const key = 'sw-reload-v1';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  });
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles/theme.css';

// We restore feed scroll positions ourselves (anchor-based); disable the browser's
// automatic guess so it does not fight our restore on Back/Forward/refresh.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

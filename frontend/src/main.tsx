import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { isLocalPage } from './lib/localPage';
import App from './App';
import { report } from './lib/diagnostics';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/black-han-sans/400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './tokens.css';
import './styles.css';

window.addEventListener('error', (event) => {
  report('js-error', { message: event.message, source: `${event.filename}:${event.lineno}` });
});

window.addEventListener('unhandledrejection', (event) => {
  report('js-unhandled-rejection', { message: String(event.reason) });
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root not found');
}

// The desktop shell opens its venue editor on the same page with ?screen=editor. It is
// loaded only then, so the multiview never pays for it.
//
// Only on a local page: the editor writes venues.json on this machine, which the deployed
// server never reads. On the live site the parameter is ignored and the multiview shows.
// The shell does not offer the editor there either; this is the second lock.
const VenueEditor = lazy(() => import('./editor/VenueEditor'));
const isEditor =
  new URLSearchParams(window.location.search).get('screen') === 'editor' && isLocalPage(window.location);

createRoot(container).render(
  <StrictMode>
    {isEditor ? (
      <Suspense fallback={null}>
        <VenueEditor />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

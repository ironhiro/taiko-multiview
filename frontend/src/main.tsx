import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { report } from './lib/diagnostics';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
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
const VenueEditor = lazy(() => import('./editor/VenueEditor'));
const isEditor = new URLSearchParams(window.location.search).get('screen') === 'editor';

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

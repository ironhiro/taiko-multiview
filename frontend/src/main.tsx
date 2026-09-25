import { StrictMode } from 'react';
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

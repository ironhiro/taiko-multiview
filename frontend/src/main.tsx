import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './tokens.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

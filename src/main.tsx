import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import '@fontsource/hind-siliguri/700.css';
// Devanagari only (Latin comes from Hind Siliguri); downloaded only when Hindi text is on screen
import '@fontsource/hind/devanagari-400.css';
import '@fontsource/hind/devanagari-500.css';
import '@fontsource/hind/devanagari-600.css';
import '@fontsource/hind/devanagari-700.css';
import './styles.css';
import App from './App';

// Ask the browser not to clear our IndexedDB when the phone runs low on space.
navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

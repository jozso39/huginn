import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { inMacApp, routeLinksOutside } from './openLink';
import './styles.css';

const root = document.getElementById('root');

if (inMacApp()) {
  routeLinksOutside(document);
}

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

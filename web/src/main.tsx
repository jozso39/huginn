import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { quietNativeMenu } from './components/ContextMenu';
import { inMacApp, routeLinksOutside } from './openLink';
import './styles.css';

const root = document.getElementById('root');

if (inMacApp()) {
  routeLinksOutside(document);
  // WebKit's own menu offers Back and Reload, which leave Huginn's page.
  quietNativeMenu(document);
}

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

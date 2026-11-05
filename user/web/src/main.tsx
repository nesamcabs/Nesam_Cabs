import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/home.css';
import './styles/booking.css';
import './styles/pages.css';
import './styles/multicity.css';
import './styles/polish.css';
import './styles/forms.css';
import './styles/mobile.css';
import './styles/compact.css';
import './styles/theme.css';
import { App } from './App';
import { installStaleVersionReload, installVersionCheck } from './components/RouteErrorBoundary';

installStaleVersionReload();
installVersionCheck();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

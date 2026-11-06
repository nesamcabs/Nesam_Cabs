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
import './styles/ride.css';
import './styles/landing.css';
import './styles/polish.css';
import './styles/forms.css';
import './styles/mobile.css';
import './styles/bookform.css';
import './styles/compact.css';
import './styles/localtaxi.css';
import './styles/theme.css';
import './styles/brand.css';
import './styles/bottom-nav.css';
import './styles/desktop-controls.css';
import './styles/scroll-header.css';
import './styles/contact-controls.css';
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

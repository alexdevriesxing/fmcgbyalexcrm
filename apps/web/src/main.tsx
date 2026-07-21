import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApplicationGate } from './components/ApplicationGate';
import { ApplicationProvider } from './state/ApplicationProvider';
import './styles.css';
import './live.css';
import './governance-live.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element was not found');
}

createRoot(root).render(
  <StrictMode>
    <ApplicationProvider>
      <ApplicationGate>
        <App />
      </ApplicationGate>
    </ApplicationProvider>
  </StrictMode>
);

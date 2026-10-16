import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './AuthGate';
import { bootstrapAuth } from './auth';
import './styles.css';

const service = await bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate service={service}>{(auth) => <App auth={auth} />}</AuthGate>
  </StrictMode>,
);

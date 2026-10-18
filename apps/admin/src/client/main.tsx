import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Console } from './console';
import '@platform/ui/base.css';
import './console.css';
const root = document.getElementById('root');
if (!root) throw new Error('Console root missing');
createRoot(root).render(
  <StrictMode>
    <Console />
  </StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '@/styles/ress.min.css';
import '@/styles/fonts.css';
import '@/styles/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

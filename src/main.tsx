import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '@/styles/ress.min.css';
import '@/styles/fonts.css';
import '@/styles/style.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find the root element with ID 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

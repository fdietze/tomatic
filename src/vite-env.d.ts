/// <reference types="vite/client" />

declare namespace JSX {
  interface IntrinsicElements {
    'settings-section': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'settings-label': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-interface': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-history': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-message': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-message-role': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-message-buttons': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-message-content': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-message-cost': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'chat-controls': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'error-box': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
  }
}

interface Window {
  sessionReady?: boolean;
}

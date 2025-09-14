import React, { useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import ChatPage from '@/pages/ChatPage';
import SettingsPage from '@/pages/SettingsPage';
import { useAppStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { AppState } from './store/types';
import { ROUTES } from '@/utils/routes';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const isRegenerating = useAppStore((state) => state.isRegenerating);

  const onChat = () => {
    if (currentSessionId) {
      void navigate(ROUTES.chat.session(currentSessionId));
    } else {
      void navigate(ROUTES.chat.new);
    }
  };

  const onSettings = () => {
    void navigate(ROUTES.settings);
  };

  const isChatActive = location.pathname.startsWith('/chat');
  const isSettingsActive = location.pathname.startsWith('/settings');

  return (
    <header>
      <div className="tabs">
        <button onClick={onChat} data-active={isChatActive} data-testid="chat-button">
          Chat
        </button>
        <button onClick={onSettings} data-active={isSettingsActive} data-testid="settings-button">
          Settings {isRegenerating && <span className="spinner" data-testid="settings-tab-spinner" />}
        </button>
      </div>
    </header>
  );
};


const App: React.FC = () => {
  const { isInitializing, init } = useAppStore(
    useShallow((state: AppState) => ({
      isInitializing: state.isInitializing,
      init: state.init,
    }))
  );

  useEffect(() => {
    console.debug('[App|useEffect] Initialization effect is running.');
    init();
  }, [init]);

  if (isInitializing) {
    console.debug('[App|render] Rendering loading spinner.');
    return <div className="loading-spinner">Loading...</div>;
  }

  console.debug('[App|render] Rendering main application.');
  return (
    <Router>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to={ROUTES.chat.new} replace />} />
          <Route path="/chat" element={<Navigate to={ROUTES.chat.new} replace />} />
          <Route path={ROUTES.chat.byId} element={<ChatPage />} />
          <Route path={ROUTES.settings} element={<SettingsPage />} />
          <Route path="*" element={<h1>Not Found</h1>} />
        </Routes>
      </main>
    </Router>
  );
};

export default App;

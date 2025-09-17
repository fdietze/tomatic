import React, { useContext } from 'react';
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
import { useSelector,  } from '@xstate/react';
import { ROUTES } from '@/utils/routes';
import { GlobalStateContext } from '@/context/GlobalStateContext';
import { SessionSnapshot } from './machines/sessionMachine';
import { SnippetsSnapshot } from './machines/snippetsMachine';
import { SettingsSnapshot } from './machines/settingsMachine';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionActor, snippetsActor } = useContext(GlobalStateContext);

  const currentSessionId = useSelector(sessionActor, (state: SessionSnapshot) => state.context.currentSessionId);
  const isRegenerating = useSelector(snippetsActor, (state: SnippetsSnapshot) => state.context.regeneratingSnippetNames.length > 0);

  const onChat = (): void => {
    if (currentSessionId) {
      void navigate(ROUTES.chat.session(currentSessionId));
    } else {
      void navigate(ROUTES.chat.new);
    }
  };

  const onSettings = (): void => {
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

const AppContent: React.FC = () => {
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
    )
}


export const App: React.FC = () => {
  const { settingsActor } = useContext(GlobalStateContext);
  const isInitializing = useSelector(settingsActor, (state: SettingsSnapshot) => state.context.isInitializing);

  if (isInitializing) {
    return <div className="loading-spinner">Loading...</div>;
  }

  return (
      <AppContent />
  );
};

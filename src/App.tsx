import React, { useContext, useEffect } from 'react';
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
import { useSelector } from '@xstate/react';
import { ROUTES } from '@/utils/routes';
import { GlobalStateContext } from '@/context/GlobalStateContext';
import { SessionSnapshot } from './machines/sessionMachine';
import { SnippetsSnapshot } from './machines/snippetsMachine';
import { SettingsSnapshot } from './machines/settingsMachine';
import { ModelsSnapshot } from './machines/modelsMachine';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionActor, snippetsActor } = useContext(GlobalStateContext);

  const currentSessionId = useSelector(sessionActor, (state: SessionSnapshot) => state.context.currentSessionId);
  const isRegenerating = useSelector(snippetsActor, (state: SnippetsSnapshot) => state.context.isRegenerating);

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
  const { settingsActor, modelsActor } = useContext(GlobalStateContext);
  const { isInitializing: settingsInitializing, apiKey } = useSelector(settingsActor, (state: SettingsSnapshot) => ({
    isInitializing: state.context.isInitializing,
    apiKey: state.context.apiKey,
  }));
  const { modelsLoading, cachedModels } = useSelector(modelsActor, (state: ModelsSnapshot) => ({
    modelsLoading: state.context.modelsLoading,
    cachedModels: state.context.cachedModels,
  }));

  useEffect(() => {
    // Once settings are loaded, check if we need to fetch models.
    if (!settingsInitializing && apiKey && cachedModels.length === 0) {
      modelsActor.send({ type: 'FETCH' });
    }
  }, [settingsInitializing, apiKey, cachedModels.length, modelsActor]);

  // The app is initializing if settings are loading OR if we have an API key but are still waiting for the first model fetch to complete.
  const isInitializing = settingsInitializing || (apiKey && modelsLoading && cachedModels.length === 0);

  if (isInitializing) {
    return <div className="loading-spinner">Loading...</div>;
  }

  return (
      <AppContent />
  );
};

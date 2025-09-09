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
import { useAppStore } from './store/appStore';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentSessionId = useAppStore((state) => state.currentSessionId);

  const onChat = () => {
    if (currentSessionId) {
      void navigate(`/chat/${currentSessionId}`);
    } else {
      void navigate('/chat/new');
    }
  };

  const onSettings = () => {
    void navigate('/settings');
  };

  const isChatActive = location.pathname.startsWith('/chat');
  const isSettingsActive = location.pathname.startsWith('/settings');

  return (
    <header>
      <div className="tabs">
        <button onClick={onChat} data-active={isChatActive}>
          Chat
        </button>
        <button onClick={onSettings} data-active={isSettingsActive}>
          Settings
        </button>
      </div>
    </header>
  );
};


const App: React.FC = () => {
  const loadSystemPrompts = useAppStore((state) => state.loadSystemPrompts);

  // Fetch initial data on app load
  useEffect(() => {
    // Check for stale selected prompt on startup
    const { systemPrompts, selectedPromptName, setSelectedPromptName } = useAppStore.getState();
    if (selectedPromptName) {
      const isStale = !systemPrompts.some(p => p.name === selectedPromptName);
      if (isStale) {
        setSelectedPromptName(null);
      }
    }

    void loadSystemPrompts();
  }, [loadSystemPrompts]);

  return (
    <Router>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/chat/new" replace />} />
          <Route path="/chat" element={<Navigate to="/chat/new" replace />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<h1>Not Found</h1>} />
        </Routes>
      </main>
    </Router>
  );
};

export default App;

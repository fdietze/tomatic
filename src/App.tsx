import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import ChatPage from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";
import { useSelector, useDispatch } from "react-redux";
import { ROUTES } from "@/utils/routes";
import {
  selectSession,
  loadInitialSessionSaga,
} from "@/store/features/session/sessionSlice";
import { selectSnippets } from "@/store/features/snippets/snippetsSlice";
import { NavigationProvider } from "@/services/NavigationProvider";
import { selectApp, initialize } from "@/store/features/app/appSlice";

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const session = useSelector(selectSession);
  const { currentSessionId } = session;
  const { regenerationStatus } = useSelector(selectSnippets);
  useSelector(selectApp);

  useEffect(() => {
    dispatch(loadInitialSessionSaga());
  }, [dispatch]);

  const isRegenerating = Object.values(regenerationStatus).some(
    (s) => s.status === "in_progress",
  );

  const lastChatUrl = currentSessionId
    ? ROUTES.chat.session(currentSessionId)
    : ROUTES.chat.new;

  const onSettings = (): void => {
    void navigate(ROUTES.settings);
  };

  const onChat = (): void => {
    void navigate(lastChatUrl);
  };

  const isChatActive = location.pathname.startsWith("/chat");
  const isSettingsActive = location.pathname.startsWith("/settings");

  return (
    <header>
      <div className="tabs">
        <button onClick={onChat} data-active={isChatActive}
          data-testid="chat-button"
        >
          Chat
        </button>
        <button
          onClick={onSettings}
          data-active={isSettingsActive}
          data-testid="settings-button"
        >
          Settings{" "}
          {isRegenerating && (
            <span className="spinner" data-testid="settings-tab-spinner" />
          )}
        </button>
      </div>
    </header>
  );
};

const App: React.FC = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(initialize());
  }, [dispatch]);

  return (
    <Router>
      <NavigationProvider>
        <Header />
        <main>
          <Routes>
            <Route path="/chat/:sessionId" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chat/new" replace />} />
          </Routes>
        </main>
      </NavigationProvider>
    </Router>
  );
};

export { App };

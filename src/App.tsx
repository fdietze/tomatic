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

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const session = useSelector(selectSession);
  const { currentSessionId } = session;
  const { regenerationStatus } = useSelector(selectSnippets);

  useEffect(() => {
    dispatch(loadInitialSessionSaga());
  }, [dispatch]);

  const isRegenerating = Object.values(regenerationStatus).some(
    (s) => s === "in_progress",
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
        <button
          onClick={onChat}
          data-active={isChatActive}
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

export const AppContent: React.FC = () => {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to={ROUTES.chat.new} replace />} />
          <Route
            path="/chat"
            element={<Navigate to={ROUTES.chat.new} replace />}
          />
          <Route path={ROUTES.chat.byId} element={<ChatPage />} />
          <Route path={ROUTES.settings} element={<SettingsPage />} />
          <Route path="*" element={<h1>Not Found</h1>} />
        </Routes>
      </main>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <Router>
      <NavigationProvider>
        <AppContent />
      </NavigationProvider>
    </Router>
  );
};

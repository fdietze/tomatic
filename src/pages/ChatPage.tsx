import React, { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { AppState } from '@/store/types';
import { useShallow } from 'zustand/react/shallow';
import ChatHeader from '@/components/ChatHeader';
import ChatInterface from '@/components/ChatInterface';

const ChatPage: React.FC = () => {
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const {
    loadSession,
    systemPrompts,
    selectedPromptName,
    setSelectedPromptName,
    prevSessionId,
    nextSessionId,
    error,
    setError,
  } = useAppStore(
useShallow((state: AppState) => ({
      loadSession: state.loadSession,
      systemPrompts: state.systemPrompts,
      selectedPromptName: state.selectedPromptName,
      setSelectedPromptName: state.setSelectedPromptName,
      prevSessionId: state.prevSessionId,
      nextSessionId: state.nextSessionId,
      error: state.error,
      setError: state.setError,
    }))
  );

  // Effect to load session when URL parameter changes
  useEffect(() => {
    const idToLoad = sessionIdFromUrl || 'new';
    void loadSession(idToLoad);

    if (idToLoad === 'new') {
        const initialPrompt = searchParams.get('q');
        if (initialPrompt) {
            useAppStore.getState().setInitialChatPrompt(initialPrompt);
            setSearchParams({}); // Clear the query param after consuming it
        }
    }
  }, [sessionIdFromUrl, loadSession, searchParams, setSearchParams]);

  const canGoPrev = !!prevSessionId; // "Prev" button goes to older sessions
  const canGoNext = !!nextSessionId; // "Next" button goes to newer sessions

  const onPrev = () => {
    if (prevSessionId) {
      void navigate(`/chat/${prevSessionId}`);
    }
  };

  const onNext = () => {
    if (nextSessionId) {
      void navigate(`/chat/${nextSessionId}`);
    }
  };


  return (
    <>
      <ChatHeader
        systemPrompts={systemPrompts}
        selectedPromptName={selectedPromptName}
        setSelectedPromptName={setSelectedPromptName}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        onPrev={onPrev}
        onNext={onNext}
      />
      {error && (
        <div className="error-display" data-testid="error-message">
          <p>{error}</p>
          <button onClick={() => { setError(null); }} className="close-button">
            &times;
          </button>
        </div>
      )}
      <ChatInterface />
    </>
  );
};

export default ChatPage;

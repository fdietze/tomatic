import React, { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
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
  } = useAppStore(
    useShallow((state) => ({
      loadSession: state.loadSession,
      systemPrompts: state.systemPrompts,
      selectedPromptName: state.selectedPromptName,
      setSelectedPromptName: state.setSelectedPromptName,
      prevSessionId: state.prevSessionId,
      nextSessionId: state.nextSessionId,
    }))
  );

  // Effect to load session when URL parameter changes
  useEffect(() => {
    const idToLoad = sessionIdFromUrl || 'new';

    const handleLoadAndSubmit = async () => {
      // First, ensure the session is loaded or a new one is started.
      await loadSession(idToLoad);

      // Only proceed if we are on a "new" session page.
      if (idToLoad === 'new') {
        const initialPrompt = searchParams.get('q');
        if (initialPrompt) {
          // Now that the session is ready, submit the message.
          // The navigate function is passed to handle the URL change.
          void useAppStore.getState().submitMessage({ promptOverride: initialPrompt, navigate });
          // Clear the query param from the URL.
          setSearchParams({}, { replace: true });
        }
      }
    };

    handleLoadAndSubmit().catch(console.error);

  }, [sessionIdFromUrl, loadSession, navigate, searchParams, setSearchParams]);

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
      <ChatInterface />
    </>
  );
};

export default ChatPage;

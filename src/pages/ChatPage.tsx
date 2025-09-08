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
    loadSession(idToLoad);

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
      navigate(`/chat/${prevSessionId}`);
    }
  };

  const onNext = () => {
    if (nextSessionId) {
      navigate(`/chat/${nextSessionId}`);
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

import React, { useEffect, useMemo } from 'react';
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
    sortedSessionIds,
    currentSessionId,
  } = useAppStore(
    useShallow((state) => ({
      loadSession: state.loadSession,
      systemPrompts: state.systemPrompts,
      selectedPromptName: state.selectedPromptName,
      setSelectedPromptName: state.setSelectedPromptName,
      sortedSessionIds: state.sortedSessionIds,
      currentSessionId: state.currentSessionId,
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

  const currentSessionIndex = useMemo(() => {
    if (!currentSessionId) return null;
    return sortedSessionIds.indexOf(currentSessionId);
  }, [currentSessionId, sortedSessionIds]);

  const canGoPrev = useMemo(() => {
    if (currentSessionIndex === null) {
      return sortedSessionIds.length > 0;
    }
    return currentSessionIndex + 1 < sortedSessionIds.length;
  }, [currentSessionIndex, sortedSessionIds.length]);
  
  const canGoNext = useMemo(() => {
      return currentSessionIndex !== null && currentSessionIndex > 0;
  }, [currentSessionIndex]);

  const onPrev = () => {
    if (!canGoPrev) return;
    const newIndex = currentSessionIndex === null ? 0 : currentSessionIndex + 1;
    const nextId = sortedSessionIds[newIndex];
    if (nextId) {
        navigate(`/chat/${nextId}`);
    }
  };

  const onNext = () => {
    if (!canGoNext || currentSessionIndex === null) return;
    const newIndex = currentSessionIndex - 1;
    const prevId = sortedSessionIds[newIndex];
    if (prevId) {
        navigate(`/chat/${prevId}`);
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

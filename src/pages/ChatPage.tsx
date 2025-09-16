import React, { useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import ChatHeader from '@/components/ChatHeader';
import ChatInterface from '@/components/ChatInterface';
import SystemPromptBar from '@/components/SystemPromptBar';
import { useGlobalState } from '@/context/GlobalStateContext';
import { SystemPrompt } from '@/types/storage';

const ChatPage: React.FC = () => {
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { settingsActor, sessionActor, promptsActor } = useGlobalState();

  // --- Granular Selectors ---
  const selectedPromptName = useSelector(settingsActor, (state) => state.context.selectedPromptName);
  const isInitializing = useSelector(settingsActor, (state) => state.context.isInitializing);
  const error = useSelector(settingsActor, (state) => state.context.error);
  const prevSessionId = useSelector(sessionActor, (state) => state.context.prevSessionId);
  const nextSessionId = useSelector(sessionActor, (state) => state.context.nextSessionId);
  const systemPrompts = useSelector(promptsActor, (state) => state.context.systemPrompts);
  const promptsLoaded = useSelector(promptsActor, (state) => state.context.promptsLoaded);

  const activeSystemPrompt: SystemPrompt | undefined = useMemo(() => {
    return systemPrompts.find(p => p.name === selectedPromptName);
  }, [systemPrompts, selectedPromptName]);


  // Effect to load session when URL parameter changes
  useEffect(() => {
    // Wait for both settings and prompts to be loaded before proceeding
    if (isInitializing || !promptsLoaded) {
      return;
    }

    const idToLoad = sessionIdFromUrl || 'new';
    if (idToLoad === 'new') {
      sessionActor.send({
        type: 'START_NEW_SESSION',
      });
      const initialPrompt = searchParams.get('q');
      if (initialPrompt) {
        settingsActor.send({ type: 'SET_INITIAL_CHAT_PROMPT', prompt: initialPrompt });
        setSearchParams({}); // Clear the query param after consuming it
      }
    } else {
      sessionActor.send({ type: 'LOAD_SESSION', sessionId: idToLoad });
    }
  }, [sessionIdFromUrl, sessionActor, settingsActor, searchParams, setSearchParams, isInitializing, promptsLoaded]);

  const canGoPrev = !!prevSessionId;
  const canGoNext = !!nextSessionId;

  const onPrev = (): void => {
    if (prevSessionId) {
      void navigate(`/chat/${prevSessionId}`);
    }
  };

  const onNext = (): void => {
    if (nextSessionId) {
      void navigate(`/chat/${nextSessionId}`);
    }
  };

  const handleSelectPrompt = (name: string | null): void => {
    settingsActor.send({ type: 'SET_SELECTED_PROMPT_NAME', name });
  };

  const handleErrorClear = (): void => {
    settingsActor.send({ type: 'SET_ERROR', error: null });
  };


  return (
    <>
      <ChatHeader
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        onPrev={onPrev}
        onNext={onNext}
      >
        <SystemPromptBar
          systemPrompts={systemPrompts}
          selectedPromptName={selectedPromptName}
          onSelectPrompt={handleSelectPrompt}
        />
      </ChatHeader>
      {error && (
        <div className="error-display" data-testid="error-message">
          <p>{error}</p>
          <button onClick={handleErrorClear} className="close-button">
            &times;
          </button>
        </div>
      )}
      <ChatInterface systemPrompt={activeSystemPrompt} />
    </>
  );
};

export default ChatPage;

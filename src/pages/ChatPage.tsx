import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import ChatHeader from '@/components/ChatHeader';
import ChatInterface from '@/components/ChatInterface';
import SystemPromptBar from '@/components/SystemPromptBar';
import { SystemPrompt } from '@/types/storage';
import { selectSettings, setSelectedPromptName } from '@/store/features/settings/settingsSlice';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import { selectSession, loadSession } from '@/store/features/session/sessionSlice';

const ChatPage: React.FC = () => {
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // --- Redux State ---
  const { selectedPromptName } = useSelector(selectSettings);
  const { prompts: systemPrompts } = useSelector(selectPrompts);
  const { prevSessionId, nextSessionId, error } = useSelector(selectSession);

  const activeSystemPrompt: SystemPrompt | undefined = useMemo(() => {
    return systemPrompts.find(p => p.name === selectedPromptName);
  }, [systemPrompts, selectedPromptName]);

  useEffect(() => {
    if (sessionIdFromUrl) {
      dispatch(loadSession(sessionIdFromUrl));
    }
  }, [sessionIdFromUrl, dispatch]);


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
    dispatch(setSelectedPromptName(name));
  };

  const handleErrorClear = (): void => {
    // This will be handled by the session slice later
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

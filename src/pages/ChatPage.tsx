import React, { useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useParams } from "react-router-dom";
import ChatHeader from "@/components/ChatHeader";
import ChatInterface from "@/components/ChatInterface";
import SystemPromptBar from "@/components/SystemPromptBar";
import { SystemPrompt } from "@/types/storage";
import {
  selectSettings,
  setSelectedPromptName,
} from "@/store/features/settings/settingsSlice";
import { selectPrompts } from "@/store/features/prompts/promptsSlice";
import {
  selectSession,
  goToPrevSession,
  goToNextSession,
  loadSession,
} from "@/store/features/session/sessionSlice";

const ChatPage: React.FC = () => {
  const dispatch = useDispatch();
  const { id: sessionIdFromUrl } = useParams<{ id: string }>();

  // --- Redux State ---
  const { selectedPromptName } = useSelector(selectSettings);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);
  const {
    prevSessionId,
    nextSessionId,
    error,
    currentSessionId,
    hasSessions,
  } = useSelector(selectSession);

  const activeSystemPrompt: SystemPrompt | undefined = useMemo(() => {
    if (!selectedPromptName) return undefined;
    const entity = Object.values(systemPromptsMap).find(
      (p) => p.data.name === selectedPromptName,
    );
    return entity?.data;
  }, [systemPromptsMap, selectedPromptName]);

  const session = useSelector(selectSession);

  useEffect(() => {
    dispatch(loadSession(sessionIdFromUrl ?? "new"));
  }, [sessionIdFromUrl, dispatch]);

  const onPrev = (): void => {
    if (prevSessionId) {
      dispatch(goToPrevSession());
    } else if (!currentSessionId && hasSessions) {
      // If we are on a new chat and there are sessions, go to the most recent one.
      dispatch(goToPrevSession());
    }
  };

  const onNext = (): void => {
    if (nextSessionId) {
      dispatch(goToNextSession());
    }
  };

  const systemPromptEntities = useMemo(
    () => Object.values(systemPromptsMap),
    [systemPromptsMap],
  );

  const handleErrorClear = (): void => {
    // This will be handled by the session slice later
  };

  return (
    <>
      <ChatHeader
        canGoPrev={!!prevSessionId || (!currentSessionId && hasSessions)}
        canGoNext={!!nextSessionId}
        onPrev={onPrev}
        onNext={onNext}
      >
        <SystemPromptBar
          systemPrompts={systemPromptEntities}
          selectedPromptName={selectedPromptName}
          onSelectPrompt={(name) => dispatch(setSelectedPromptName(name))}
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

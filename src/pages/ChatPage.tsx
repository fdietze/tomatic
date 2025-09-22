import React, { useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import ChatHeader from "@/components/ChatHeader";
import ChatInterface from "@/components/ChatInterface";
import SystemPromptBar from "@/components/SystemPromptBar";
import { SystemPrompt } from "@/types/storage";
import {
  selectSettings,
  setSelectedPromptName,
} from "@/store/features/settings/settingsSlice";
import { selectPrompts } from "@/store/features/prompts/promptsSlice";
import { selectSession, goToPrevSession, goToNextSession } from "@/store/features/session/sessionSlice";

const ChatPage: React.FC = () => {
  const dispatch = useDispatch();

  // --- Redux State ---
  const { selectedPromptName } = useSelector(selectSettings);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);
  const { prevSessionId, nextSessionId, error } = useSelector(selectSession);

  const activeSystemPrompt: SystemPrompt | undefined = useMemo(() => {
    if (!selectedPromptName) return undefined;
    const entity = Object.values(systemPromptsMap).find(
      (p) => p.data.name === selectedPromptName,
    );
    return entity?.data;
  }, [systemPromptsMap, selectedPromptName]);

  const session = useSelector(selectSession);

  useEffect(() => {
    return () => {
    };
  }, [session]);

  const canGoPrev = !!prevSessionId;
  const canGoNext = !!nextSessionId;

  const onPrev = (): void => {
    if (prevSessionId) {
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
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
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

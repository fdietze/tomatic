import React, { useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useParams } from "react-router-dom";
import ChatHeader from "@/components/ChatHeader";
import ChatInterface from "@/components/ChatInterface";
import SystemPromptBar from "@/components/SystemPromptBar";
import { SystemPrompt } from "@/types/storage";
import { getErrorMessage } from "@/types/errors";
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
  setSessionError,
  setSystemPromptRequested,
  setSelectedPromptName as setSessionSelectedPromptName,
} from "@/store/features/session/sessionSlice";

const ChatPage: React.FC = () => {
  const dispatch = useDispatch();
  const { sessionId: sessionIdFromUrl } = useParams<{ sessionId: string }>();

  // --- Redux State ---
  const { selectedPromptName: globalSelectedPromptName } = useSelector(selectSettings);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);
  const {
    prevSessionId,
    nextSessionId,
    error,
    currentSessionId,
    hasSessions,
    selectedPromptName: sessionSelectedPromptName,
  } = useSelector(selectSession);
  
  // Use session-specific prompt if available, otherwise fall back to global setting
  const selectedPromptName = sessionSelectedPromptName ?? globalSelectedPromptName;

  const activeSystemPrompt: SystemPrompt | undefined = useMemo(() => {
    if (!selectedPromptName) return undefined;
    const entity = Object.values(systemPromptsMap).find(
      (p) => p.data.name === selectedPromptName,
    );
    return entity?.data;
  }, [systemPromptsMap, selectedPromptName]);

  useEffect(() => {
    dispatch(loadSession(sessionIdFromUrl ?? "new"));
  }, [sessionIdFromUrl, dispatch]);

  // Set initial system prompt if one is selected
  useEffect(() => {
    if (selectedPromptName && activeSystemPrompt) {
      dispatch(setSystemPromptRequested(activeSystemPrompt));
    }
  }, [selectedPromptName, activeSystemPrompt, dispatch]);

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

  const systemPromptEntities = useMemo(() => {
    const entities = Object.values(systemPromptsMap);
    console.log(`[DEBUG] ChatPage.systemPromptEntities: computed ${entities.length} entities`);
    console.log(`[DEBUG] ChatPage.systemPromptEntities: entity names:`, entities.map(e => e.data.name));
    return entities;
  }, [systemPromptsMap]);

  const handleErrorClear = (): void => {
    dispatch(setSessionError(null));
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
          onSelectPrompt={(name) => {
            console.log(`[DEBUG] ChatPage.onSelectPrompt: called with name: "${name}"`);
            console.log(`[DEBUG] ChatPage.onSelectPrompt: current selectedPromptName: "${selectedPromptName}"`);
            console.log(`[DEBUG] ChatPage.onSelectPrompt: systemPromptEntities count: ${systemPromptEntities.length}`);
            
            // Update both session-specific and global settings
            dispatch(setSessionSelectedPromptName(name));
            dispatch(setSelectedPromptName(name));
            
            const selectedPromptEntity = systemPromptEntities.find(
              (entity) => entity.data.name === name,
            );
            console.log(`[DEBUG] ChatPage.onSelectPrompt: found selectedPromptEntity: ${!!selectedPromptEntity}`);
            if (selectedPromptEntity) {
              console.log(`[DEBUG] ChatPage.onSelectPrompt: dispatching setSystemPromptRequested for: ${selectedPromptEntity.data.name}`);
              dispatch(setSystemPromptRequested(selectedPromptEntity.data));
            }
          }}
        />
      </ChatHeader>
      {error && (
        <div className="error-display" data-testid="error-message">
          <p>{getErrorMessage(error)}</p>
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

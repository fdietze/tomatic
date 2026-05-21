import React, { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams } from 'react-router-dom';
import ChatHeader from '@/components/ChatHeader';
import SystemPromptBar from '@/components/SystemPromptBar';
import ScratchpadInputChunk from '@/components/scratchpad/ScratchpadInputChunk';
import ScratchpadResponsePanel from '@/components/scratchpad/ScratchpadResponsePanel';
import ScratchpadComposer from '@/components/scratchpad/ScratchpadComposer';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import {
  loadSession,
  goToPrevSession,
  goToNextSession,
  setSelectedPromptName,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { getErrorMessage } from '@/types/errors';

const ScratchpadPage: React.FC = () => {
  const dispatch = useDispatch();
  const { sessionId } = useParams<{ sessionId: string }>();
  const sp = useSelector(selectScratchpad);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);

  useEffect(() => {
    dispatch(loadSession(sessionId ?? 'new'));
  }, [sessionId, dispatch]);

  const systemPromptEntities = useMemo(() => Object.values(systemPromptsMap), [systemPromptsMap]);

  return (
    <>
      <ChatHeader
        canGoPrev={!!sp.prevSessionId || (!sp.currentSessionId && sp.hasSessions)}
        canGoNext={!!sp.nextSessionId}
        onPrev={() => dispatch(goToPrevSession())}
        onNext={() => dispatch(goToNextSession())}
      >
        <SystemPromptBar
          systemPrompts={systemPromptEntities}
          selectedPromptName={sp.selectedPromptName}
          onSelectPrompt={(name) => dispatch(setSelectedPromptName(name))}
        />
      </ChatHeader>
      {sp.error && (
        <div className="error-display" data-testid="error-message">
          <p>{getErrorMessage(sp.error)}</p>
        </div>
      )}
      <section data-testid="scratchpad-inputs">
        {sp.inputs.map((chunk) => (
          <ScratchpadInputChunk key={chunk.id} chunk={chunk} />
        ))}
      </section>
      <ScratchpadResponsePanel />
      <ScratchpadComposer />
    </>
  );
};

export default ScratchpadPage;

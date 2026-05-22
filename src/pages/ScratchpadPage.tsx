import React, { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams } from 'react-router-dom';
import ChatHeader from '@/components/ChatHeader';
import SystemPromptBar from '@/components/SystemPromptBar';
import Combobox from '@/components/Combobox';
import ScratchpadInputChunk from '@/components/scratchpad/ScratchpadInputChunk';
import ScratchpadResponsePanel from '@/components/scratchpad/ScratchpadResponsePanel';
import ScratchpadComposer from '@/components/scratchpad/ScratchpadComposer';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import {
  selectSettings,
  setModelName,
  saveSettings,
} from '@/store/features/settings/settingsSlice';
import { selectModels, fetchModels } from '@/store/features/models/modelsSlice';
import {
  loadSession,
  goToPrevSession,
  goToNextSession,
  setSelectedPromptName,
  setIncludeLastResponse,
  markResponseStale,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { getErrorMessage } from '@/types/errors';

const ScratchpadPage: React.FC = () => {
  const dispatch = useDispatch();
  const { sessionId } = useParams<{ sessionId: string }>();
  const sp = useSelector(selectScratchpad);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);
  const { modelName } = useSelector(selectSettings);
  const {
    models,
    loading: modelsLoading,
    error: modelsError,
  } = useSelector(selectModels);

  useEffect(() => {
    dispatch(loadSession(sessionId ?? 'new'));
  }, [sessionId, dispatch]);

  useEffect(() => {
    dispatch(fetchModels());
  }, [dispatch]);

  const systemPromptEntities = useMemo(
    () => Object.values(systemPromptsMap),
    [systemPromptsMap],
  );

  const handleModelChange = (newModel: string): void => {
    dispatch(setModelName(newModel));
    dispatch(saveSettings({}));
    // Changing the model marks the displayed response stale, since it was
    // generated with a different model.
    dispatch(markResponseStale());
  };

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
        {/* req:scratchpad-include-last-response: header-level opt-in to feed the
            last assistant response back as an assistant turn on next send/regen. */}
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}
          title="Feed the last assistant response back as context for the next send/regenerate"
        >
          <input
            type="checkbox"
            data-testid="scratchpad-include-last-response"
            checked={sp.includeLastResponse}
            onChange={(e) => dispatch(setIncludeLastResponse(e.target.checked))}
          />
          Include last response
        </label>
      </ChatHeader>
      {sp.error && (
        <div className="error-box" data-testid="error-message">
          <p>{getErrorMessage(sp.error)}</p>
        </div>
      )}
      <div className="chat-interface">
        <div className="chat-history">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
              borderBottom: '1px solid var(--base02)',
            }}
          >
            <div style={{ flexGrow: 1 }}>
              <Combobox
                items={models.map((m) => ({ id: m.id, display_text: m.name }))}
                selectedId={modelName}
                onSelect={handleModelChange}
                placeholder="Select or type model ID (e.g. openai/gpt-4o)"
                loading={modelsLoading === 'loading'}
                onReload={() => dispatch(fetchModels())}
                errorMessage={modelsError}
              />
            </div>
          </div>
          <section data-testid="scratchpad-inputs">
            {sp.inputs.map((chunk, index) => (
              <ScratchpadInputChunk key={chunk.id} chunk={chunk} index={index} />
            ))}
          </section>
          <ScratchpadResponsePanel />
        </div>
        <ScratchpadComposer />
      </div>
    </>
  );
};

export default ScratchpadPage;

import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import SystemPromptItem from '@/components/SystemPromptItem';
import SnippetItem from '@/components/SnippetItem';
import type { Snippet, SystemPrompt } from '@/types/storage';
import { topologicalSort } from '@/utils/snippetUtils';
import { useGlobalState } from '@/context/GlobalStateContext';
import { SnippetsSnapshot } from '@/machines/snippetsMachine';

const SettingsPage: React.FC = () => {
    const { settingsActor, promptsActor, snippetsActor } = useGlobalState();

    const apiKey = useSelector(settingsActor, (state) => state.context.apiKey);
    const autoScrollEnabled = useSelector(settingsActor, (state) => state.context.autoScrollEnabled);
    const systemPrompts = useSelector(promptsActor, (state) => state.context.systemPrompts);
    const snippets = useSelector(snippetsActor, (state: SnippetsSnapshot) => state.context.snippets);

    const [localApiKey, setLocalApiKey] = useState(apiKey);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
    const [isCreatingNewPrompt, setIsCreatingNewPrompt] = useState(false);
    const [isCreatingNewSnippet, setIsCreatingNewSnippet] = useState(false);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  const handleSaveApiKey = (): void => {
    settingsActor.send({ type: 'SET_API_KEY', key: localApiKey });
    setSaveStatus('saved');
    setTimeout(() => { setSaveStatus('idle'); }, 2000);
  };

  // --- Prompt Handlers ---
  const handleNewPrompt = (): void => { setIsCreatingNewPrompt(true); };
  const handleCancelNewPrompt = (): void => { setIsCreatingNewPrompt(false); };
  const handleCreatePrompt = (newPrompt: SystemPrompt): void => {
    promptsActor.send({ type: 'ADD', prompt: newPrompt });
    setIsCreatingNewPrompt(false);
  };
  const handleUpdatePrompt = (oldName: string, updatedPrompt: SystemPrompt): void => {
    promptsActor.send({ type: 'UPDATE', oldName, prompt: updatedPrompt });
  };
  const handleRemovePrompt = (name: string): void => {
    promptsActor.send({ type: 'DELETE', name });
  };

  // --- Snippet Handlers ---
  const handleNewSnippet = (): void => { setIsCreatingNewSnippet(true); };
  const handleCancelNewSnippet = (): void => { setIsCreatingNewSnippet(false); };
  const handleCreateSnippet = (newSnippet: Snippet): Promise<void> => {
    snippetsActor.send({ type: 'ADD', snippet: newSnippet });
    setIsCreatingNewSnippet(false);
    return Promise.resolve(); // Keep signature for SnippetItem
  };
  const handleUpdateSnippet = (oldName: string, updatedSnippet: Snippet): Promise<void> => {
    snippetsActor.send({ 
        type: 'UPDATE', 
        oldName, 
        snippet: updatedSnippet,
    });
    return Promise.resolve();
  };
  const handleRemoveSnippet = (name: string): Promise<void> => {
    snippetsActor.send({ type: 'DELETE', name });
    return Promise.resolve();
  };

  const sortedSnippets = useMemo(() => {
    const { sorted, cyclic } = topologicalSort(snippets);

    if (cyclic.length > 0) {
      console.warn('[SettingsPage] Cycle detected in snippets, falling back to alphabetical sort for all items.');
      return [...snippets].sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
  }, [snippets]);


  return (
    <div style={{ marginBottom: '50px' }}>
      <div className="settings-section">
        <div className="settings-label">OPENROUTER_API_KEY</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={localApiKey}
            onChange={(e) => { setLocalApiKey(e.currentTarget.value); }}
            placeholder="OPENROUTER_API_KEY"
            style={{ flexGrow: 1 }}
          />
          <button onClick={handleSaveApiKey} data-role="primary" disabled={saveStatus === 'saved'}>
            {saveStatus === 'saved' ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">Chat</div>
        <div className="settings-item">
          <label htmlFor="auto-scroll-checkbox" className="checkbox-label">
            <input
              type="checkbox"
              id="auto-scroll-checkbox"
              checked={autoScrollEnabled}
              onChange={() => { settingsActor.send({ type: 'TOGGLE_AUTO_SCROLL' }); }}
            />
            <span className="checkbox-custom"></span>
            Auto-scroll to bottom
          </label>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">system prompts</div>
        <button
          data-testid="new-system-prompt-button"
          data-role="primary"
          data-size="compact"
          onClick={handleNewPrompt}
          style={{ marginBottom: '20px' }}
          disabled={isCreatingNewPrompt || isCreatingNewSnippet}
        >
          New
        </button>
        <div className="system-prompt-list">
          {isCreatingNewPrompt && (
             <SystemPromptItem
              prompt={{ name: '', prompt: '' }}
              isInitiallyEditing={true}
              allPrompts={systemPrompts}
              onUpdate={(prompt) => { handleCreatePrompt(prompt); }}
              onRemove={handleCancelNewPrompt}
              onCancel={handleCancelNewPrompt}
            />
          )}
{systemPrompts.map((prompt: SystemPrompt) => (
            <SystemPromptItem
              key={prompt.name}
              prompt={prompt}
              isInitiallyEditing={false}
              allPrompts={systemPrompts}
              onUpdate={(updatedPrompt) => { handleUpdatePrompt(prompt.name, updatedPrompt); }}
              onRemove={() => { handleRemovePrompt(prompt.name); }}
            />
          ))}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">Snippets</div>
        <button
          data-testid="new-snippet-button"
          data-role="primary"
          data-size="compact"
          onClick={handleNewSnippet}
          style={{ marginBottom: '20px' }}
          disabled={isCreatingNewSnippet || isCreatingNewPrompt}
        >
          New Snippet
        </button>
        <div className="snippet-list">
          {isCreatingNewSnippet && (
            <SnippetItem
              snippet={{ name: '', content: '', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false }}
              isInitiallyEditing={true}
              allSnippets={snippets}
              onUpdate={(_oldName, updatedSnippet) => handleCreateSnippet(updatedSnippet)}
              onRemove={() => {
                handleCancelNewSnippet();
                return Promise.resolve();
              }}
              onCancel={handleCancelNewSnippet}
            />
          )}
          {sortedSnippets.map((snippet: Snippet) => (
            <SnippetItem
              key={snippet.name}
              snippet={snippet}
              isInitiallyEditing={false}
              allSnippets={snippets}
              onUpdate={(_oldName, updatedSnippet) => handleUpdateSnippet(snippet.name, updatedSnippet)}
              onRemove={() => handleRemoveSnippet(snippet.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

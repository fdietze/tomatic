import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import SystemPromptItem from '@/components/SystemPromptItem';
import SnippetItem from '@/components/SnippetItem';
import type { Snippet, SystemPrompt } from '@/types/storage';
import { topologicalSort } from '@/utils/snippetUtils';
import {
  selectSettings,
  setApiKey,
  toggleAutoScroll,
  loadSettings,
  saveSettings,
} from '@/store/features/settings/settingsSlice';
import {
  selectPrompts,
  loadPrompts,
  addPrompt,
  updatePrompt,
  deletePrompt,
} from '@/store/features/prompts/promptsSlice';
import {
  selectSnippets,
  loadSnippets,
  addSnippet,
  updateSnippet,
  deleteSnippet,
} from '@/store/features/snippets/snippetsSlice';

const SettingsPage: React.FC = () => {
  const dispatch = useDispatch();

  // --- Redux State ---
  const { apiKey, autoScrollEnabled, saving } = useSelector(selectSettings);
  const { prompts: systemPrompts } = useSelector(selectPrompts);
  const { snippets } = useSelector(selectSnippets);

  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [isCreatingNewPrompt, setIsCreatingNewPrompt] = useState(false);
  const [isCreatingNewSnippet, setIsCreatingNewSnippet] = useState(false);

  useEffect(() => {
    dispatch(loadSettings());
    dispatch(loadPrompts());
    dispatch(loadSnippets());
  }, [dispatch]);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  const handleSaveApiKey = (): void => {
    dispatch(setApiKey(localApiKey));
    dispatch(saveSettings({}));
  };

  const handleToggleAutoScroll = (): void => {
    dispatch(toggleAutoScroll());
    dispatch(saveSettings({}));
  };

  // --- Prompt Handlers ---
  const handleNewPrompt = (): void => { setIsCreatingNewPrompt(true); };
  const handleCancelNewPrompt = (): void => { setIsCreatingNewPrompt(false); };
  const handleCreatePrompt = (newPrompt: SystemPrompt): void => {
    dispatch(addPrompt(newPrompt));
    setIsCreatingNewPrompt(false);
  };
  const handleUpdatePrompt = (oldName: string, updatedPrompt: SystemPrompt): void => {
    dispatch(updatePrompt({ oldName, prompt: updatedPrompt }));
  };
  const handleRemovePrompt = (name: string): void => {
    dispatch(deletePrompt(name));
  };

  // --- Snippet Handlers ---
  const handleNewSnippet = (): void => { setIsCreatingNewSnippet(true); };
  const handleCancelNewSnippet = (): void => { setIsCreatingNewSnippet(false); };
  const handleCreateSnippet = (newSnippet: Snippet): Promise<void> => {
    dispatch(addSnippet(newSnippet));
    setIsCreatingNewSnippet(false);
    return Promise.resolve();
  };
  const handleUpdateSnippet = (oldName: string, updatedSnippet: Snippet): Promise<void> => {
    dispatch(updateSnippet({ oldName, snippet: updatedSnippet }));
    return Promise.resolve();
  };
  const handleRemoveSnippet = (name: string): Promise<void> => {
    dispatch(deleteSnippet(name));
    return Promise.resolve();
  };

  const sortedSnippets = useMemo(() => {
    const { sorted } = topologicalSort(snippets);
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
          <button onClick={handleSaveApiKey} data-role="primary" disabled={saving === 'saving'}>
            {saving === 'saving' ? 'Saving...' : saving === 'idle' ? 'Save' : 'Saved!'}
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
              onChange={handleToggleAutoScroll}
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

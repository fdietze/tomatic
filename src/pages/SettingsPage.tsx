import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import { AppState } from '@/store/types';
import SystemPromptItem from '@/components/SystemPromptItem';
import SnippetItem from '@/components/SnippetItem';
import type { Snippet, SystemPrompt } from '@/types/storage';
import { useShallow } from 'zustand/react/shallow';

const SettingsPage: React.FC = () => {
  const {
    apiKey: storeApiKey,
    setApiKey,
    systemPrompts,
    snippets,
    autoScrollEnabled,
    toggleAutoScroll,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    addSnippet,
    updateSnippet,
    deleteSnippet,
  } = useAppStore(
useShallow((state: AppState) => ({
      apiKey: state.apiKey,
      setApiKey: state.setApiKey,
      systemPrompts: state.systemPrompts,
      snippets: state.snippets,
      autoScrollEnabled: state.autoScrollEnabled,
      toggleAutoScroll: state.toggleAutoScroll,
      addSystemPrompt: state.addSystemPrompt,
      updateSystemPrompt: state.updateSystemPrompt,
      deleteSystemPrompt: state.deleteSystemPrompt,
      addSnippet: state.addSnippet,
      updateSnippet: state.updateSnippet,
      deleteSnippet: state.deleteSnippet,
    }))
  );

  const [localApiKey, setLocalApiKey] = useState(storeApiKey);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [isCreatingNewPrompt, setIsCreatingNewPrompt] = useState(false);
  const [isCreatingNewSnippet, setIsCreatingNewSnippet] = useState(false);

  useEffect(() => {
    setLocalApiKey(storeApiKey);
  }, [storeApiKey]);

  const handleSaveApiKey = () => {
    setApiKey(localApiKey);
    setSaveStatus('saved');
    setTimeout(() => { setSaveStatus('idle'); }, 2000);
  };

  // --- Prompt Handlers ---
  const handleNewPrompt = () => { setIsCreatingNewPrompt(true); };
  const handleCancelNewPrompt = () => { setIsCreatingNewPrompt(false); };
  const handleCreatePrompt = async (newPrompt: SystemPrompt) => {
    await addSystemPrompt(newPrompt);
    setIsCreatingNewPrompt(false);
  };
  const handleUpdatePrompt = async (oldName: string, updatedPrompt: SystemPrompt) => {
    await updateSystemPrompt(oldName, updatedPrompt);
  };
  const handleRemovePrompt = async (name: string) => {
    await deleteSystemPrompt(name);
  };

  // --- Snippet Handlers ---
  const handleNewSnippet = () => { setIsCreatingNewSnippet(true); };
  const handleCancelNewSnippet = () => { setIsCreatingNewSnippet(false); };
  const handleCreateSnippet = (newSnippet: Snippet) => {
    return addSnippet(newSnippet).then(() => {
        setIsCreatingNewSnippet(false);
    });
  };
  const handleUpdateSnippet = (oldName: string, updatedSnippet: Snippet) => {
    return updateSnippet(oldName, updatedSnippet);
  };
  const handleRemoveSnippet = (name: string) => {
    return deleteSnippet(name);
  };


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
              onChange={() => { toggleAutoScroll(); }}
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
              onUpdate={(prompt) => { void handleCreatePrompt(prompt); }}
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
              onUpdate={(updatedPrompt) => { void handleUpdatePrompt(prompt.name, updatedPrompt); }}
              onRemove={() => { void handleRemovePrompt(prompt.name); }}
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
              onUpdate={handleCreateSnippet}
              onRemove={() => {
                handleCancelNewSnippet();
                return Promise.resolve();
              }}
              onCancel={handleCancelNewSnippet}
            />
          )}
{snippets.map((snippet: Snippet) => (
            <SnippetItem
              key={snippet.name}
              snippet={snippet}
              isInitiallyEditing={false}
              allSnippets={snippets}
              onUpdate={(updatedSnippet) => handleUpdateSnippet(snippet.name, updatedSnippet)}
              onRemove={() => handleRemoveSnippet(snippet.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import SystemPromptItem from '@/components/SystemPromptItem';
import SnippetItem from '@/components/SnippetItem';
import type { SystemPrompt, Snippet } from '@/types/storage';
import { useShallow } from 'zustand/react/shallow';

const SettingsPage: React.FC = () => {
  const {
    apiKey: storeApiKey,
    setApiKey,
    systemPrompts,
    autoScrollEnabled,
    toggleAutoScroll,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    snippets,
    addSnippet,
    updateSnippet,
    deleteSnippet,
  } = useAppStore(
    useShallow((state) => ({
      apiKey: state.apiKey,
      setApiKey: state.setApiKey,
      systemPrompts: state.systemPrompts,
      autoScrollEnabled: state.autoScrollEnabled,
      toggleAutoScroll: state.toggleAutoScroll,
      addSystemPrompt: state.addSystemPrompt,
      updateSystemPrompt: state.updateSystemPrompt,
      deleteSystemPrompt: state.deleteSystemPrompt,
      snippets: state.snippets,
      addSnippet: state.addSnippet,
      updateSnippet: state.updateSnippet,
      deleteSnippet: state.deleteSnippet,
    }))
  );

  const [localApiKey, setLocalApiKey] = useState(storeApiKey);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  // Local state to manage the creation of a new, unsaved prompt
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isCreatingNewSnippet, setIsCreatingNewSnippet] = useState(false);

  useEffect(() => {
    setLocalApiKey(storeApiKey);
  }, [storeApiKey]);

  const handleSaveApiKey = () => {
    setApiKey(localApiKey);
    setSaveStatus('saved');
    setTimeout(() => { setSaveStatus('idle'); }, 2000);
  };

  const handleNewPrompt = () => {
    setIsCreatingNew(true);
  };

  const handleCreatePrompt = async (newPrompt: SystemPrompt) => {
    await addSystemPrompt(newPrompt);
    setIsCreatingNew(false);
  };

  const handleUpdatePrompt = async (oldName: string, updatedPrompt: SystemPrompt) => {
    await updateSystemPrompt(oldName, updatedPrompt);
  };

  const handleRemovePrompt = async (name: string) => {
    await deleteSystemPrompt(name);
  };

  const handleCancelNew = () => {
    setIsCreatingNew(false);
  }

  const handleNewSnippet = () => {
    setIsCreatingNewSnippet(true);
  };

  const handleCreateSnippet = async (newSnippet: Snippet) => {
    await addSnippet(newSnippet);
    setIsCreatingNewSnippet(false);
  };

  const handleUpdateSnippet = async (oldName: string, updatedSnippet: Snippet) => {
    await updateSnippet(oldName, updatedSnippet);
  };

  const handleRemoveSnippet = async (name: string) => {
    await deleteSnippet(name);
  };

  const handleCancelNewSnippet = () => {
    setIsCreatingNewSnippet(false);
  }

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
          data-role="primary"
          data-size="compact"
          onClick={handleNewPrompt}
          style={{ marginBottom: '20px' }}
          disabled={isCreatingNew}
        >
          New
        </button>
        <div className="system-prompt-list">
          {isCreatingNew && (
             <SystemPromptItem
              prompt={{ name: '', prompt: '' }}
              isInitiallyEditing={true}
              allPrompts={systemPrompts}
              onUpdate={(prompt) => { void handleCreatePrompt(prompt); }}
              onRemove={handleCancelNew}
              onCancel={handleCancelNew}
            />
          )}
          {systemPrompts.map((prompt) => (
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
          data-role="primary"
          data-size="compact"
          onClick={handleNewSnippet}
          style={{ marginBottom: '20px' }}
          disabled={isCreatingNewSnippet}
        >
          New Snippet
        </button>
        <div className="system-prompt-list">
          {isCreatingNewSnippet && (
             <SnippetItem
              snippet={{ name: '', content: '', isGenerated: false }}
              isInitiallyEditing={true}
              allSnippets={snippets}
              onUpdate={(snippet) => { void handleCreateSnippet(snippet); }}
              onRemove={handleCancelNewSnippet}
              onCancel={handleCancelNewSnippet}
            />
          )}
          {snippets.map((snippet) => (
            <SnippetItem
              key={snippet.name}
              snippet={snippet}
              isInitiallyEditing={false}
              allSnippets={snippets}
              onUpdate={(updatedSnippet) => { void handleUpdateSnippet(snippet.name, updatedSnippet); }}
              onRemove={() => { void handleRemoveSnippet(snippet.name); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

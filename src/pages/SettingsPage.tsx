import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import SystemPromptItem from '@/components/SystemPromptItem';
import type { SystemPrompt } from '@/types/storage';
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
    importPrompts,
    exportPrompts,
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
      importPrompts: state.importPrompts,
      exportPrompts: state.exportPrompts,
    }))
  );

  const [localApiKey, setLocalApiKey] = useState(storeApiKey);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  // Local state to manage the creation of a new, unsaved prompt
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        await importPrompts(text);
      }
      // Reset the file input value to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
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
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <button
            data-testid="new-system-prompt-button"
            data-role="primary"
            data-size="compact"
            onClick={handleNewPrompt}
            disabled={isCreatingNew}
          >
            New
          </button>
          <button
            data-testid="import-prompts-button"
            data-role="secondary"
            data-size="compact"
            onClick={handleImportClick}
          >
            Import
          </button>
          <button
            data-testid="export-prompts-button"
            data-role="secondary"
            data-size="compact"
            onClick={() => {
              void exportPrompts();
            }}
          >
            Export
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleFileChange}
          />
        </div>
        <div className="system-prompt-list">
          {isCreatingNew && (
            <SystemPromptItem
              prompt={{ name: '', prompt: '' }}
              isInitiallyEditing={true}
              allPrompts={systemPrompts}
              onUpdate={(prompt) => {
                void handleCreatePrompt(prompt);
              }}
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
              onUpdate={(updatedPrompt) => {
                void handleUpdatePrompt(prompt.name, updatedPrompt);
              }}
              onRemove={() => {
                void handleRemovePrompt(prompt.name);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

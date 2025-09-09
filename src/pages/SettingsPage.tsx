import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import SystemPromptItem from '@/components/SystemPromptItem';
import type { SystemPrompt } from '@/types/storage';

const SettingsPage: React.FC = () => {
  const storeApiKey = useAppStore((state) => state.apiKey);
  const setStoreApiKey = useAppStore((state) => state.setApiKey);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const setSystemPrompts = useAppStore((state) => state.setSystemPrompts);
  const autoScrollEnabled = useAppStore((state) => state.autoScrollEnabled);
  const toggleAutoScroll = useAppStore((state) => state.toggleAutoScroll);

  const [localApiKey, setLocalApiKey] = useState(storeApiKey);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    setLocalApiKey(storeApiKey);
  }, [storeApiKey]);

  const handleSaveApiKey = () => {
    setStoreApiKey(localApiKey);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleNewPrompt = () => {
    const newPrompts = [{ name: '', prompt: '' }, ...systemPrompts];
    console.log('[DEBUG] new prompts list in handleNewPrompt:', newPrompts);
    setSystemPrompts(newPrompts);
  };

  const handleUpdatePrompt = (index: number, updatedPrompt: SystemPrompt) => {
    const newPrompts = [...systemPrompts];
    newPrompts[index] = updatedPrompt;
    setSystemPrompts(newPrompts);
  };

  const handleRemovePrompt = (index: number) => {
    const newPrompts = systemPrompts.filter((_, i) => i !== index);
    setSystemPrompts(newPrompts);
  };

  return (
    <div style={{ marginBottom: '50px' }}>
      <div className="settings-section">
        <div className="settings-label">OPENROUTER_API_KEY</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.currentTarget.value)}
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
              onChange={toggleAutoScroll}
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
        >
          New
        </button>
        <div className="system-prompt-list">
          {systemPrompts.map((prompt, index) => (
            <SystemPromptItem
              key={prompt.name || `new-prompt-${index}`} // Use a more stable key
              prompt={prompt}
              promptIndex={index}
              allPrompts={systemPrompts}
              onUpdate={(updatedPrompt) => handleUpdatePrompt(index, updatedPrompt)}
              onRemove={() => handleRemovePrompt(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

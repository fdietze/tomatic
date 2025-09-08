import React from 'react';
import { useAppStore } from '@/store/appStore';
import SystemPromptItem from '@/components/SystemPromptItem';
import type { SystemPrompt } from '@/types/storage';

const SettingsPage: React.FC = () => {
  const apiKey = useAppStore((state) => state.apiKey);
  const setApiKey = useAppStore((state) => state.setApiKey);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const setSystemPrompts = useAppStore((state) => state.setSystemPrompts);

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
        <input
          type="text"
          value={apiKey}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          placeholder="OPENROUTER_API_KEY"
        />
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

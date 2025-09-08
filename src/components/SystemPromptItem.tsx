import React, { useState } from 'react';
import type { SystemPrompt } from '@/types/storage';

interface SystemPromptItemProps {
  prompt: SystemPrompt;
  onUpdate: (updatedPrompt: SystemPrompt) => void;
  onRemove: () => void;
}

const SystemPromptItem: React.FC<SystemPromptItemProps> = ({ prompt, onUpdate, onRemove }) => {
  const [isEditing, setIsEditing] = useState(!prompt.name && !prompt.prompt);
  const [editingName, setEditingName] = useState(prompt.name);
  const [editingPrompt, setEditingPrompt] = useState(prompt.prompt);

  const handleSave = () => {
    onUpdate({ name: editingName, prompt: editingPrompt });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditingName(prompt.name);
    setEditingPrompt(prompt.prompt);
    // If the prompt was new and empty, cancel should remove it.
    if (!prompt.name && !prompt.prompt) {
      onRemove();
    } else {
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="system-prompt-item-edit">
        <div className="system-prompt-inputs">
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            placeholder="name"
          />
          <textarea
            value={editingPrompt}
            onChange={(e) => setEditingPrompt(e.target.value)}
            placeholder="system prompt"
          />
        </div>
        <div className="system-prompt-edit-buttons">
          <button onClick={handleSave} data-size="compact" data-role="primary">
            Save
          </button>
          <button onClick={handleCancel} data-size="compact">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="system-prompt-item-view">
      <span className="system-prompt-name">{prompt.name}</span>
      <span className="system-prompt-text">{prompt.prompt}</span>
      <div className="system-prompt-buttons">
        <button onClick={() => setIsEditing(true)} data-size="compact">
          Edit
        </button>
        <button onClick={onRemove} data-size="compact">
          Delete
        </button>
      </div>
    </div>
  );
};

export default SystemPromptItem;

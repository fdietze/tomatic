import React, { useState, useRef, useEffect } from 'react';
import type { SystemPrompt } from '@/types/storage';

interface SystemPromptItemProps {
  prompt: SystemPrompt;
  isInitiallyEditing: boolean;
  allPrompts: SystemPrompt[];
  onUpdate: (updatedPrompt: SystemPrompt) => void;
  onRemove: () => void;
  onCancel?: () => void;
}

const SystemPromptItem: React.FC<SystemPromptItemProps> = ({
  prompt,
  isInitiallyEditing,
  allPrompts,
  onUpdate,
  onRemove,
  onCancel,
}) => {
  console.log(
    `[DEBUG] SystemPromptItem render. Index: ${prompt.name}, Name: "${prompt.name}", isEditing initially: ${isInitiallyEditing}`
  );
  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(prompt.name);
  const [editingPrompt, setEditingPrompt] = useState(prompt.prompt);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedName = editingName.trim();
    if (trimmedName === '') {
      setNameError('Name cannot be empty.');
      return;
    }
    
    // For existing prompts, the original name is `prompt.name`.
    // For new prompts, `prompt.name` is empty.
    const originalName = prompt.name;

    const isDuplicate = allPrompts.some(
      (p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase() && p.name.trim().toLowerCase() !== originalName.trim().toLowerCase()
    );

    if (isDuplicate) {
      setNameError('A prompt with this name already exists.');
      return;
    }

    onUpdate({ name: trimmedName, prompt: editingPrompt });
    setIsEditing(false);
    setNameError(null);
  };

  const handleCancelEditing = () => {
    if (onCancel) {
      onCancel();
    } else {
      setEditingName(prompt.name);
      setEditingPrompt(prompt.prompt);
      setNameError(null);
      setIsEditing(false);
    }
  };


  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingName(e.target.value);
    if (nameError) {
      setNameError(null);
    }
  };

  if (isEditing) {
    return (
      <div className="system-prompt-item-edit">
        <div className="system-prompt-inputs">
          <input
            ref={nameInputRef}
            type="text"
            value={editingName}
            onChange={handleNameChange}
            placeholder="name"
            data-testid="system-prompt-name-input"
          />
          {nameError && <div className="error-message">{nameError}</div>}
          <textarea
            value={editingPrompt}
            onChange={(e) => setEditingPrompt(e.target.value)}
            placeholder="system prompt"
            data-testid="system-prompt-prompt-input"
          />
        </div>
        <div className="system-prompt-edit-buttons">
          <button
            onClick={handleSave}
            data-size="compact"
            data-role="primary"
            disabled={!!nameError && editingName.trim() !== ''}
            data-testid="system-prompt-save-button"
          >
            Save
          </button>
          <button
            onClick={handleCancelEditing}
            data-size="compact"
            data-testid="system-prompt-cancel-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="system-prompt-item-view" data-testid={`system-prompt-item-${prompt.name}`}>
      <span className="system-prompt-name">{prompt.name}</span>
      <span className="system-prompt-text">{prompt.prompt}</span>
      <div className="system-prompt-buttons">
        <button
          onClick={() => setIsEditing(true)}
          data-size="compact"
          data-testid="system-prompt-edit-button"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          data-size="compact"
          data-testid="system-prompt-delete-button"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default SystemPromptItem;

import React, { useState, useRef, useEffect } from "react";
import type { SystemPrompt } from "@/types/storage";
import { assertUnreachable } from "@/utils/assert";

interface SystemPromptItemProps {
  prompt: SystemPrompt;
  status: "idle" | "saving" | "deleting" | "failed";
  error: string | null;
  isInitiallyEditing: boolean;
  allPrompts: SystemPrompt[];
  onUpdate: (updatedPrompt: SystemPrompt) => void;
  onRemove: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
}

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

const SystemPromptItem: React.FC<SystemPromptItemProps> = ({
  prompt,
  status,
  error,
  isInitiallyEditing,
  allPrompts,
  onUpdate,
  onRemove,
  onCancel,
  onEdit,
}) => {
  // This component doesn't need to be connected to the context,
  // as it receives all necessary data and callbacks as props.
  // The parent (SettingsPage) is responsible for providing them.

  const isEditing = isInitiallyEditing;
  const [editingName, setEditingName] = useState(prompt.name);
  const [editingPrompt, setEditingPrompt] = useState(prompt.prompt);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSave = (): void => {
    const trimmedName = editingName.trim();
    if (nameError || trimmedName === "") {
      if (trimmedName === "") setNameError("Name cannot be empty.");
      return;
    }
    onUpdate({ name: trimmedName, prompt: editingPrompt });
    // The parent will cause this component to unmount or re-render in view mode.
    // No need to set editing state here.
    setNameError(null);
  };

  const handleCancelEditing = (): void => {
    // Reset local state in case it's re-opened
    setEditingName(prompt.name);
    setEditingPrompt(prompt.prompt);
    setNameError(null);
    // Tell the parent to cancel editing
    if (onCancel) {
      onCancel();
    }
  };

  const getSaveButtonText = (
    status: "idle" | "saving" | "deleting" | "failed",
  ) => {
    switch (status) {
      case "idle":
      case "failed":
        return "Save";
      case "saving":
        return "Saving...";
      case "deleting":
        return "Save";
      default:
        assertUnreachable(status);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newName = e.target.value;
    setEditingName(newName);

    if (newName.trim() === "") {
      setNameError("Name cannot be empty.");
      return;
    }

    if (!NAME_REGEX.test(newName)) {
      setNameError(
        "Name can only contain alphanumeric characters and underscores.",
      );
      return;
    }

    const originalName = prompt.name;
    const isDuplicate = allPrompts.some(
      (p) =>
        p.name.trim().toLowerCase() === newName.trim().toLowerCase() &&
        p.name.trim().toLowerCase() !== originalName.trim().toLowerCase(),
    );

    if (isDuplicate) {
      setNameError("A prompt with this name already exists.");
    } else {
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
          {nameError && (
            <div className="error-message" data-testid="error-message">
              {nameError}
            </div>
          )}
          <textarea
            value={editingPrompt}
            onChange={(e) => {
              setEditingPrompt(e.target.value);
            }}
            placeholder="system prompt"
            data-testid="system-prompt-prompt-input"
          />
        </div>
        <div className="system-prompt-edit-buttons">
          <button
            onClick={handleSave}
            data-size="compact"
            data-role="primary"
            disabled={!!nameError || status === "saving"}
            data-testid="system-prompt-save-button"
          >
            {getSaveButtonText(status)}
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
    <div
      className="system-prompt-item-view"
      data-testid={`system-prompt-item-${prompt.name}`}
    >
      <div className="system-prompt-content">
        <span className="system-prompt-name">{prompt.name}</span>
        <span className="system-prompt-text">{prompt.prompt}</span>
        {status === "failed" && error && (
          <div className="error-message" data-testid="error-message">
            {error}
          </div>
        )}
      </div>
      {(() => {
        switch (status) {
          case "idle":
          case "saving":
          case "failed":
            return (
              <div className="system-prompt-buttons">
                <button
                  onClick={onEdit}
                  data-size="compact"
                  data-testid="system-prompt-edit-button"
                >
                  Edit
                </button>
                <button
                  onClick={onRemove}
                  data-size="compact"
                  data-testid="system-prompt-delete-button"
                  disabled={status === "saving"}
                >
                  Delete
                </button>
              </div>
            );
          case "deleting":
            return (
              <div className="spinner-container">
                <div className="spinner" />
              </div>
            );
          default:
            assertUnreachable(status);
        }
      })()}
    </div>
  );
};

export default SystemPromptItem;

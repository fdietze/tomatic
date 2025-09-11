import React, { useState, useRef, useEffect } from 'react';
import type { Snippet } from '@/types/storage';
import { useAppStore } from '@/store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Combobox } from './Combobox';
import { Markdown } from './Markdown';
import { requestMessageContent } from '@/api/openrouter';

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  allSnippets: Snippet[];
  onUpdate: (updatedSnippet: Snippet) => void;
  onRemove: () => void;
  onCancel?: () => void;
}

const SnippetItem: React.FC<SnippetItemProps> = ({
  snippet,
  isInitiallyEditing,
  allSnippets,
  onUpdate,
  onRemove,
  onCancel,
}) => {
  const { models, fetchModelList, apiKey } = useAppStore(
    useShallow((state) => ({
      models: state.cachedModels,
      fetchModelList: state.fetchModelList,
      apiKey: state.apiKey,
    }))
  );

  useEffect(() => {
    if (models.length === 0) {
      void fetchModelList();
    }
  }, [fetchModelList, models.length]);

  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [isGenerated, setIsGenerated] = useState(snippet.isGenerated);
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || '');
  const [editingModel, setEditingModel] = useState(snippet.model || '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSave = async () => {
    const trimmedName = editingName.trim();
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedName)) {
      setNameError('Name can only contain alphanumeric characters and underscores.');
      return;
    }

    if (trimmedName === '') {
      setNameError('Name cannot be empty.');
      return;
    }

    const originalName = snippet.name;

    const isDuplicate = allSnippets.some(
      (s) => s.name.trim().toLowerCase() === trimmedName.toLowerCase() && s.name.trim().toLowerCase() !== originalName.trim().toLowerCase()
    );

    if (isDuplicate) {
      setNameError('A snippet with this name already exists.');
      return;
    }

    let finalContent = editingContent;
    if (isGenerated) {
      setIsLoading(true);
      try {
        finalContent = await requestMessageContent(
          [{ role: 'user', content: editingPrompt }],
          editingModel,
          apiKey
        );
      } catch (error) {
        console.error('Failed to generate snippet content:', error);
        // Optionally, set an error state to show in the UI
      } finally {
        setIsLoading(false);
      }
    }

    onUpdate({
      ...snippet,
      name: trimmedName,
      content: finalContent,
      isGenerated,
      prompt: editingPrompt,
      model: editingModel,
    });

    if (!isGenerated) {
      setIsEditing(false);
    }
    setNameError(null);
  };

  const handleCancelEditing = () => {
    if (onCancel) {
      onCancel();
    } else {
      setEditingName(snippet.name);
      setEditingContent(snippet.content);
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
            data-testid="snippet-name-input"
          />
          {nameError && <div className="error-message">{nameError}</div>}
          <div className="checkbox-label" style={{ margin: '10px 0' }}>
            <input
              type="checkbox"
              id={`generated-snippet-checkbox-${snippet.name}`}
              checked={isGenerated}
              onChange={() => setIsGenerated(!isGenerated)}
            />
            <span className="checkbox-custom"></span>
            Generated Snippet
          </div>

          {isGenerated && (
            <>
              <Combobox
                label="Model"
                options={models.map((m) => ({ value: m.id, label: m.name }))}
                selectedValue={editingModel}
                onSelect={(value) => setEditingModel(value)}
                onClear={() => setEditingModel('')}
              />
              <textarea
                value={editingPrompt}
                onChange={(e) => { setEditingPrompt(e.target.value); }}
                placeholder="prompt"
                data-testid="snippet-prompt-input"
              />
            </>
          )}

          {isGenerated ? (
            <div className="generated-content">
              <Markdown content={editingContent} />
            </div>
          ) : (
            <textarea
              value={editingContent}
              onChange={(e) => { setEditingContent(e.target.value); }}
              placeholder="content"
              data-testid="snippet-content-input"
            />
          )}
        </div>
        <div className="system-prompt-edit-buttons">
          <button
            onClick={() => void handleSave()}
            data-size="compact"
            data-role="primary"
            disabled={(!!nameError && editingName.trim() !== '') || isLoading}
            data-testid="snippet-save-button"
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEditing}
            data-size="compact"
            data-testid="snippet-cancel-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="system-prompt-item-view" data-testid={`snippet-item-${snippet.name}`}>
      <span className="system-prompt-name">{snippet.name}</span>
      <span className="system-prompt-text">{snippet.content}</span>
      <div className="system-prompt-buttons">
        <button
          onClick={() => { setIsEditing(true); }}
          data-size="compact"
          data-testid="snippet-edit-button"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          data-size="compact"
          data-testid="snippet-delete-button"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default SnippetItem;

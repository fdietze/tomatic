import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Snippet } from '@/types/storage';
import { useSelector, useDispatch } from 'react-redux';
import { DisplayModelInfo } from '@/types/storage';
import { validateSnippetDependencies, findNonExistentSnippets } from '@/utils/snippetUtils';
import Combobox, { type ComboboxItem } from './Combobox';
import Markdown from './Markdown';
import { selectModels } from '@/store/features/models/modelsSlice';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import {
  selectSnippets,
  regenerateSnippet,
  addSnippet,
} from '@/store/features/snippets/snippetsSlice';
import { assertUnreachable } from '@/utils/assert';

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  onUpdate: (updatedSnippet: Snippet) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onCancel?: () => void;
}

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

const SnippetItem: React.FC<SnippetItemProps> = ({
  snippet,
  isInitiallyEditing,
  onUpdate,
  onRemove,
  onCancel,
}) => {
    const dispatch = useDispatch();
    const { models: cachedModels } = useSelector(selectModels);
    const { modelName: defaultModelName } = useSelector(selectSettings);
    useSelector(selectPrompts);
    const { snippets: allSnippets, regenerationStatus } = useSelector(selectSnippets);
    
  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [editingIsGenerated, setEditingIsGenerated] = useState(snippet.isGenerated);
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || '');
  const [editingModel, setEditingModel] = useState(snippet.model || defaultModelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptErrors, setPromptErrors] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const modelItems = useMemo((): ComboboxItem[] => {
    return cachedModels.map((model: DisplayModelInfo) => ({
      id: model.id,
      display_text: model.name,
    }));
  }, [cachedModels]);

  useEffect(() => {
    // When the snippet content prop changes (e.g., after a regeneration),
    // update the local editing state to reflect it.
    setEditingContent(snippet.content);
  }, [snippet.content]);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing, snippet.name]);

  useEffect(() => {
    const errors: string[] = [];
    const textToScan = editingIsGenerated ? editingPrompt : editingContent;

    const otherSnippets = allSnippets.filter(s => s.id !== snippet.id);
    const currentSnippetForValidation = {
      ...snippet,
      name: editingName.trim() || snippet.name,
      prompt: editingPrompt,
      isGenerated: editingIsGenerated,
      model: editingModel,
      content: editingContent,
    };
    const snippetsForValidation = [...otherSnippets, currentSnippetForValidation];

    try {
      validateSnippetDependencies(textToScan, snippetsForValidation);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'An unknown cycle was detected.');
    }
    
    const missingSnippets = findNonExistentSnippets(textToScan, snippetsForValidation);
    if(missingSnippets.length > 0) {
      for (const missing of missingSnippets) {
        errors.push(`Warning: Snippet '@${missing}' not found.`);
      }
    }

    setPromptErrors(errors);

  }, [editingIsGenerated, editingPrompt, editingName, allSnippets, snippet, editingModel, editingContent]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newName = e.target.value;
    setEditingName(newName);

    if (newName.trim() === '') {
      setNameError('Name cannot be empty.');
      return;
    }

    if (!NAME_REGEX.test(newName)) {
      setNameError('Name can only contain alphanumeric characters and underscores.');
      return;
    }

    const isDuplicate = allSnippets.some(
      (s) => s.name.trim().toLowerCase() === newName.trim().toLowerCase() && s.id !== snippet.id
    );

    if (isDuplicate) {
      setNameError('A snippet with this name already exists.');
    } else {
      setNameError(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    const trimmedName = editingName.trim();
    if (nameError || trimmedName === '') {
        if (trimmedName === '') setNameError('Name cannot be empty.');
        return;
    }

    const snippetForSave: Snippet = {
      ...snippet,
      id: snippet.id || crypto.randomUUID(),
      name: trimmedName,
      // The content will be updated by the generation process if needed
      content: editingContent,
      isGenerated: editingIsGenerated,
      prompt: editingPrompt,
      model: editingModel,
    };

    if (!snippet.id) {
      dispatch(addSnippet(snippetForSave));
    } else {
      void onUpdate(snippetForSave);
    }

    setIsEditing(false);
    setNameError(null);
  };

  const generateAndSetContent = (): void => {
    const snippetForRegeneration: Snippet = {
      ...snippet,
      id: snippet.id || crypto.randomUUID(),
      name: editingName.trim(),
      content: editingContent, // This is a placeholder, the saga will replace it
      isGenerated: editingIsGenerated,
      prompt: editingPrompt,
      model: editingModel,
    };
    dispatch(regenerateSnippet(snippetForRegeneration));
  };

  const handleCancelEditing = (): void => {
    if (isInitiallyEditing && onCancel) {
      onCancel();
    } else {
      setEditingName(snippet.name);
      setEditingContent(snippet.content);
      setEditingIsGenerated(snippet.isGenerated);
      setEditingPrompt(snippet.prompt || '');
      setEditingModel(snippet.model || defaultModelName);
      setNameError(null);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="system-prompt-item-edit" data-testid={`snippet-item-edit-${snippet.id || 'new'}`}>
        <div className="system-prompt-inputs">
          <input
            ref={nameInputRef}
            type="text"
            value={editingName}
            onChange={handleNameChange}
            placeholder="name"
            data-testid="snippet-name-input"
          />
          {nameError && <div className="error-message" data-testid="error-message">{nameError}</div>}

          <div className="settings-item">
            <label htmlFor={`generated-checkbox-${snippet.id}`} className="checkbox-label">
              <input
                type="checkbox"
                id={`generated-checkbox-${snippet.id}`}
                checked={editingIsGenerated}
                onChange={(e) => { setEditingIsGenerated(e.target.checked); }}
                data-testid="snippet-generated-checkbox"
              />
              <span className="checkbox-custom"></span>
              Generated Snippet
            </label>
          </div>

          {editingIsGenerated && (
            <>
              <Combobox
                label="Model"
                items={modelItems}
                selectedId={editingModel}
                onSelect={setEditingModel}
                placeholder="Inherit from chat settings"
              />
              <textarea
                value={editingPrompt}
                onChange={(e) => { setEditingPrompt(e.target.value); }}
                placeholder="Prompt to generate content..."
                data-testid="snippet-prompt-input"
                rows={5}
              />
            </>
          )}

          {editingIsGenerated ? (
            <div className="generated-content-readonly" data-testid="snippet-content-display">
                <div className="settings-label" style={{fontSize: 'var(--font-size-small)', marginTop: '10px'}}>Content (read-only)</div>
                {promptErrors.length > 0 ? (
                  <div className="error-message" data-testid="prompt-error-message">
                    {promptErrors.map((error, i) => <div key={i}>{error}</div>)}
                  </div>
                ) : (
                  <Markdown markdownText={editingContent} />
                )}
            </div>
          ) : (
            <>
              <textarea
                value={editingContent}
                onChange={(e) => { setEditingContent(e.target.value); }}
                placeholder="content"
                data-testid="snippet-content-input"
                rows={5}
              />
              {promptErrors.length > 0 && (
                <div className="error-message" data-testid="prompt-error-message">
                  {promptErrors.map((error, i) => <div key={i}>{error}</div>)}
                </div>
              )}
            </>
          )}

        </div>
        <div className="system-prompt-edit-buttons">
          {editingIsGenerated && (
            <button
              onClick={() => { generateAndSetContent(); }}
              data-size="compact"
              disabled={promptErrors.length > 0}
              data-testid="snippet-regenerate-button"
            >
              Regenerate
            </button>
          )}
          <button
            onClick={() => void handleSave()}
            data-size="compact"
            data-role="primary"
            disabled={!!nameError && editingName.trim() !== ''}
            data-testid="snippet-save-button"
          >
            Save
          </button>
          <button
            onClick={handleCancelEditing}
            data-size="compact"
            data-testid="snippet-cancel-button"
          >
            Cancel
          </button>
        </div>
        <div className="error-message" data-testid="generation-error-message">
          {snippet.generationError}
        </div>
      </div>
    );
  }

  return (
    <div className="system-prompt-item-view" data-testid={`snippet-item-${snippet.id}`}>
      <div className="system-prompt-header">
        <span className="system-prompt-name">{snippet.name}</span>
        <div className="system-prompt-actions">
          {(() => {
            const status = regenerationStatus[snippet.name]?.status || 'idle';
            switch (status) {
              case 'idle':
              case 'success':
              case 'error':
                return (
                  <div className="system-prompt-buttons">
                    <button
                      onClick={() => { setIsEditing(true); }}
                      data-size="compact"
                      data-testid="snippet-edit-button"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { void onRemove(snippet.id); }}
                      data-size="compact"
                      data-testid="snippet-delete-button"
                    >
                      Delete
                    </button>
                  </div>
                );
              case 'in_progress':
                return <span className="spinner" data-testid="regenerating-spinner" />;
              default:
                assertUnreachable(status);
            }
          })()}
        </div>
      </div>
      <span className="system-prompt-text">{snippet.content}</span>
      {regenerationStatus[snippet.name]?.status === 'error' && (
          <div className="error-message" data-testid="generation-error-message">
              {`Generation failed: ${regenerationStatus[snippet.name]?.error ?? 'Unknown error'}`}
          </div>
      )}
      {snippet.generationError && <div className="error-message" data-testid="generation-error-message">{snippet.generationError}</div>}
    </div>
  );
};

export default SnippetItem;

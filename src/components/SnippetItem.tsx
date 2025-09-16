import React, { useState, useRef, useEffect, useMemo, useContext } from 'react';
import type { Snippet } from '@/types/storage';
import { useSelector } from '@xstate/react';
import { DisplayModelInfo } from '@/types/storage';
import { validateSnippetDependencies, findNonExistentSnippets } from '@/utils/snippetUtils';
import Combobox, { type ComboboxItem } from './Combobox';
import Markdown from './Markdown';
import { GlobalStateContext } from '@/context/GlobalStateContext';
import { ModelsSnapshot } from '@/machines/modelsMachine';
import { SnippetsSnapshot } from '@/machines/snippetsMachine';

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  allSnippets: Snippet[]; // This will come from a selector
  onUpdate: (updatedSnippet: Snippet) => Promise<void>;
  onRemove: () => Promise<void>;
  onCancel?: () => void;
}

const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

const SnippetItem: React.FC<SnippetItemProps> = ({
  snippet,
  isInitiallyEditing,
  allSnippets,
  onUpdate,
  onRemove,
  onCancel,
}) => {
    const { modelsActor, snippetsActor } = useContext(GlobalStateContext);
    const { cachedModels, modelName: defaultModelName } = useSelector(modelsActor, (state: ModelsSnapshot) => ({
        cachedModels: state.context.cachedModels,
        modelName: 'openai/gpt-4o', // This should probably come from settingsActor
    }));
    const { regeneratingSnippetNames } = useSelector(snippetsActor, (state: SnippetsSnapshot) => ({
        regeneratingSnippetNames: state.context.regeneratingSnippetNames,
    }));


  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [editingIsGenerated, setEditingIsGenerated] = useState(snippet.isGenerated);
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || '');
  const [editingModel, setEditingModel] = useState(snippet.model || defaultModelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptErrors, setPromptErrors] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isActuallyRegenerating = regeneratingSnippetNames.includes(snippet.name);
  const shouldShowSpinner = isActuallyRegenerating || snippet.isDirty;

  const modelItems = useMemo((): ComboboxItem[] => {
    return cachedModels.map((model: DisplayModelInfo) => ({
      id: model.id,
      display_text: model.name,
      model_info: model,
    }));
  }, [cachedModels]);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing, snippet.name]);

  useEffect(() => {
    const errors: string[] = [];
    const textToScan = editingIsGenerated ? editingPrompt : editingContent;

    // We need a complete and up-to-date list of snippets for validation.
    const otherSnippets = allSnippets.filter(s => s.name !== snippet.name);
    const currentSnippetForValidation = {
      ...snippet,
      name: editingName.trim() || snippet.name,
      prompt: editingPrompt,
      isGenerated: editingIsGenerated,
      model: editingModel,
      content: editingContent,
    };
    const snippetsForValidation = [...otherSnippets, currentSnippetForValidation];

    // 1. Check for cyclical dependencies (hard error).
    try {
      validateSnippetDependencies(textToScan, snippetsForValidation);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'An unknown cycle was detected.');
    }
    
    // 2. Check for non-existent snippets (warning).
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

    const originalName = snippet.name;
    const isDuplicate = allSnippets.some(
      (s) => s.name.trim().toLowerCase() === newName.trim().toLowerCase() && s.name.trim().toLowerCase() !== originalName.trim().toLowerCase()
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

    const finalContent = editingContent;

    const snippetForSave: Snippet = {
      ...snippet,
      name: trimmedName,
      content: finalContent,
      isGenerated: editingIsGenerated,
      prompt: editingPrompt,
      model: editingModel,
    };

    await onUpdate(snippetForSave);

    setIsEditing(false);
    setNameError(null);
  };

  const generateAndSetContent = (): void => {
    // This function will need to be refactored to send an event to the snippetsActor
    console.warn("generateAndSetContent is not yet refactored for XState");
  };

  const handleCancelEditing = (): void => {
    if (onCancel) {
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
      <div className="system-prompt-item-edit" data-testid={`snippet-item-edit-${snippet.name || 'new'}`}> {/* Re-using style for now */}
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
            <label htmlFor={`generated-checkbox-${snippet.name}`} className="checkbox-label">
              <input
                type="checkbox"
                id={`generated-checkbox-${snippet.name}`}
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
        <div className="error-message" data-testid="generation-error-message"></div>
      </div>
    );
  }

  return (
    <div className="system-prompt-item-view" data-testid={`snippet-item-${snippet.name}`}>
      <div className="system-prompt-header">
        <span className="system-prompt-name">{snippet.name}</span>
        <div className="system-prompt-actions">
          {shouldShowSpinner && <span className="spinner" data-testid="regenerating-spinner" />}
          <div className="system-prompt-buttons">
            <button
              onClick={() => { setIsEditing(true); }}
              data-size="compact"
              data-testid="snippet-edit-button"
              disabled={isActuallyRegenerating}
            >
              Edit
            </button>
            <button
              onClick={() => { void onRemove(); }}
              data-size="compact"
              data-testid="snippet-delete-button"
              disabled={isActuallyRegenerating}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      <span className="system-prompt-text">{snippet.content}</span>
      {snippet.generationError && <div className="error-message" data-testid="generation-error-message">{`Generation failed: ${snippet.generationError}`}</div>}
    </div>
  );
};

export default SnippetItem;

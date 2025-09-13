import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Snippet } from '@/types/storage';
import { useAppStore } from '@/store';
import { AppState } from '@/store/types';
import { DisplayModelInfo } from '@/types/storage';
import { useShallow } from 'zustand/react/shallow';
import { validateSnippetDependencies, findNonExistentSnippets } from '@/utils/snippetUtils';
import Combobox, { type ComboboxItem } from './Combobox';
import Markdown from './Markdown';

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  allSnippets: Snippet[];
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
  const { cachedModels, modelName: defaultModelName, generateSnippetContent } = useAppStore(
    useShallow((state: AppState) => ({
      cachedModels: state.cachedModels,
      modelName: state.modelName,
      generateSnippetContent: state.generateSnippetContent,
    }))
  );

  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [editingIsGenerated, setEditingIsGenerated] = useState(snippet.isGenerated);
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || '');
  const [editingModel, setEditingModel] = useState(snippet.model || defaultModelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptErrors, setPromptErrors] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  console.log(`[SnippetItem|render] START @${snippet.name}`, { 
    isInitiallyEditing, 
    isEditing, 
    snippet: JSON.parse(JSON.stringify(snippet)) as Snippet
  });

  const { regeneratingSnippetNames } = useAppStore(useShallow(state => ({
    regeneratingSnippetNames: state.regeneratingSnippetNames,
  })));

  const isCurrentSnippetRegenerating = regeneratingSnippetNames.includes(snippet.name);
  console.log(`[SnippetItem|render] @${snippet.name} isCurrentSnippetRegenerating: ${String(isCurrentSnippetRegenerating)}`);

  const modelItems = useMemo((): ComboboxItem[] => {
    return cachedModels.map((model: DisplayModelInfo) => ({
      id: model.id,
      display_text: model.name,
      model_info: model,
    }));
  }, [cachedModels]);

  useEffect(() => {
    console.log(`[SnippetItem|useEffect|isEditing] @${snippet.name} isEditing changed to: ${String(isEditing)}`);
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing, snippet.name]);

  useEffect(() => {
    const errors: string[] = [];
    const textToScan = editingIsGenerated ? editingPrompt : editingContent;
    console.log(`[SnippetItem|useEffect|validation] @${snippet.name} textToScan: "${textToScan}"`);

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
    console.log(`[SnippetItem|useEffect|validation] @${snippet.name} snippetsForValidation:`, snippetsForValidation.map(s=>s.name));

    // 1. Check for cyclical dependencies (hard error).
    try {
      validateSnippetDependencies(textToScan, snippetsForValidation);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'An unknown cycle was detected.');
    }
    
    // 2. Check for non-existent snippets (warning).
    const missingSnippets = findNonExistentSnippets(textToScan, snippetsForValidation);
    if(missingSnippets.length > 0) console.log(`[SnippetItem|useEffect|validation] @${snippet.name} missing snippets:`, missingSnippets);
    for (const missing of missingSnippets) {
      errors.push(`Warning: Snippet '@${missing}' not found.`);
    }

    if(errors.length > 0) console.log(`[SnippetItem|useEffect|validation] @${snippet.name} validation errors:`, errors);
    setPromptErrors(errors);

  }, [editingIsGenerated, editingPrompt, editingName, allSnippets, snippet, editingModel, editingContent]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSave = async () => {
    console.log(`[SnippetItem|handleSave] @${snippet.name} called.`);
    const trimmedName = editingName.trim();
    if (nameError || trimmedName === '') {
        if (trimmedName === '') setNameError('Name cannot be empty.');
        console.log(`[SnippetItem|handleSave] @${snippet.name} aborted due to name error: "${nameError ?? ''}" or empty name.`);
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

    console.log(`[SnippetItem|handleSave] @${snippet.name} calling onUpdate with:`, JSON.parse(JSON.stringify(snippetForSave)));
    await onUpdate(snippetForSave);

    setIsEditing(false);
    setNameError(null);
    console.log(`[SnippetItem|handleSave] @${snippet.name} finished.`);
  };

  const generateAndSetContent = async () => {
    console.log(`[SnippetItem|generateAndSetContent] @${snippet.name} called.`);
    // This function now uses local state for immediate UI feedback on manual regeneration.
    // The final save is handled by handleSave, which sends data to the store.
    const setIsGenerating = (isGenerating: boolean) => {
        // A simple way to manage transient generating state without adding a state variable.
        // This could be improved, but is out of scope for the current refactor.
        const button = document.querySelector(`[data-testid="snippet-regenerate-button"]`);
        if (button) button.textContent = isGenerating ? 'Generating...' : 'Regenerate';
    };
    const setGenerationError = (error: string | null) => {
        const errorElement = document.querySelector(`[data-testid="generation-error-message"]`);
        if (errorElement) errorElement.textContent = error || '';
    };

    setIsGenerating(true);
    setGenerationError(null);

    console.log(`[SnippetItem|generateAndSetContent] @${snippet.name} local state:`, { editingName, editingPrompt, editingModel });
    const snippetToGenerate: Snippet = {
        ...snippet,
      name: editingName.trim(),
      content: '', // This will be replaced by the generated content
      isGenerated: true,
      prompt: editingPrompt,
      model: editingModel,
    };

    console.log(`[SnippetItem|generateAndSetContent] @${snippet.name} calling generateSnippetContent with:`, JSON.parse(JSON.stringify(snippetToGenerate)));
    try {
      const updatedSnippet = await generateSnippetContent(snippetToGenerate);
      console.log(`[SnippetItem|generateAndSetContent] @${snippet.name} received updated snippet:`, JSON.parse(JSON.stringify(updatedSnippet)));
      setEditingContent(updatedSnippet.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      console.error(`[SnippetItem|generateAndSetContent] @${snippet.name} generation failed:`, error);
      setGenerationError(`Generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCancelEditing = () => {
    console.log(`[SnippetItem|handleCancelEditing] @${snippet.name} called.`);
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
              onClick={() => { void generateAndSetContent(); }}
              data-size="compact"
              disabled={promptErrors.length > 0}
              data-testid="snippet-regenerate-button"
            >
              Regenerate
            </button>
          )}
          <button
            onClick={() => { void handleSave(); }}
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
      <span className="system-prompt-name">{snippet.name}</span>
      {isCurrentSnippetRegenerating && <span className="spinner" data-testid="regenerating-spinner" />}
      <span className="system-prompt-text">{snippet.content}</span>
      {snippet.generationError && <div className="error-message" data-testid="generation-error-message">{`Generation failed: ${snippet.generationError}`}</div>}
      <div className="system-prompt-buttons">
        <button
          onClick={() => { console.log(`[SnippetItem|onClick] Edit button for @${snippet.name} clicked.`); setIsEditing(true); }}
          data-size="compact"
          data-testid="snippet-edit-button"
          disabled={isCurrentSnippetRegenerating}
        >
          Edit
        </button>
        <button
          onClick={() => { console.log(`[SnippetItem|onClick] Delete button for @${snippet.name} clicked.`); void onRemove(); }}
          data-size="compact"
          data-testid="snippet-delete-button"
          disabled={isCurrentSnippetRegenerating}
        >
          Delete
        </button>
      </div>
    </div>
  );
};

export default SnippetItem;

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Message } from '@/types/chat';
import type { Snippet } from '@/types/storage';
import { useAppStore } from '@/store/appStore';
import { useShallow } from 'zustand/react/shallow';
import Combobox, { type ComboboxItem } from './Combobox';
import Markdown from './Markdown';
import { requestMessageContentStreamed } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  allSnippets: Snippet[];
  onUpdate: (updatedSnippet: Snippet) => void;
  onRemove: () => void;
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
  const { cachedModels, modelName: defaultModelName, apiKey, allSnippets: allStoreSnippets } = useAppStore(
    useShallow((state) => ({
      cachedModels: state.cachedModels,
      modelName: state.modelName,
      apiKey: state.apiKey,
      allSnippets: state.snippets,
    }))
  );

  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [editingIsGenerated, setEditingIsGenerated] = useState(snippet.isGenerated);
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || '');
  const [editingModel, setEditingModel] = useState(snippet.model || defaultModelName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const modelItems = useMemo((): ComboboxItem[] => {
    return cachedModels.map((model) => ({
      id: model.id,
      display_text: model.name,
      model_info: model,
    }));
  }, [cachedModels]);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

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

  const validateAndSaveChanges = () => {
    const trimmedName = editingName.trim();
    if (nameError || trimmedName === '') {
        if (trimmedName === '') setNameError('Name cannot be empty.');
        return;
    }

    if (editingIsGenerated) {
      void generateContentAndSave(trimmedName);
    } else {
      onUpdate({
        name: trimmedName,
        content: editingContent,
        isGenerated: false,
      });
      setIsEditing(false);
      setNameError(null);
    }
  };

  const generateContentAndSave = async (name: string) => {
    if (!editingPrompt || !editingModel || !apiKey) {
      setGenerationError('Prompt, model, and API key are required for generation.');
      return;
    }
    setIsGenerating(true);
    setGenerationError(null);
    let newContent = '';
    try {
      const resolvedPrompt = resolveSnippets(editingPrompt, allStoreSnippets);
      const messages: Message[] = [{ id: uuidv4(), role: 'user', content: resolvedPrompt }];
      const stream = await requestMessageContentStreamed(messages, editingModel, apiKey);
      for await (const chunk of stream) {
        newContent += chunk.choices[0]?.delta?.content || '';
      }

      onUpdate({
        name,
        content: newContent,
        isGenerated: true,
        prompt: editingPrompt,
        model: editingModel,
      });
      setIsEditing(false);
      setNameError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      console.error('Snippet generation failed:', message);
      setGenerationError(`Generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCancelEditing = () => {
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
                <Markdown markdownText={editingContent} />
            </div>
          ) : (
            <textarea
              value={editingContent}
              onChange={(e) => { setEditingContent(e.target.value); }}
              placeholder="content"
              data-testid="snippet-content-input"
              rows={5}
            />
          )}

        </div>
        <div className="system-prompt-edit-buttons">
          <button
            onClick={validateAndSaveChanges}
            data-size="compact"
            data-role="primary"
            disabled={isGenerating || (!!nameError && editingName.trim() !== '')}
            data-testid="snippet-save-button"
          >
            {isGenerating ? 'Generating...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEditing}
            data-size="compact"
            data-testid="snippet-cancel-button"
            disabled={isGenerating}
          >
            Cancel
          </button>
        </div>
        {generationError && <div className="error-message" data-testid="generation-error-message">{generationError}</div>}
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

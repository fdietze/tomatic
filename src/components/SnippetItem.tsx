import React, { useState, useRef, useEffect, useMemo } from "react";
import type { Snippet } from "@/types/storage";
import { useSelector, useDispatch } from "react-redux";
import { DisplayModelInfo } from "@/types/storage";
import {
  validateSnippetDependencies,
  findNonExistentSnippets,
} from "@/utils/snippetUtils";
import Combobox, { type ComboboxItem } from "./Combobox";
import Markdown from "./Markdown";
import { selectModels } from "@/store/features/models/modelsSlice";
import { selectSettings } from "@/store/features/settings/settingsSlice";
import { selectPrompts } from "@/store/features/prompts/promptsSlice";
import {
  selectSnippets,
  regenerateSnippet,
  updateAndRegenerateSnippetRequested,
} from "@/store/features/snippets/snippetsSlice";
import { getErrorMessage } from "@/types/errors";

interface SnippetItemProps {
  snippet: Snippet;
  isInitiallyEditing: boolean;
  isCyclic?: boolean;
  onUpdate: (updatedSnippet: Snippet) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onCancel?: () => void;
}

// req:name-validation: Snippet names must contain only alphanumeric characters and underscores
const NAME_REGEX = /^[a-zA-Z0-9_]+$/;

const SnippetItem: React.FC<SnippetItemProps> = ({
  snippet,
  isInitiallyEditing,
  isCyclic = false,
  onUpdate,
  onRemove,
  onCancel,
}) => {
  const dispatch = useDispatch();
  const { models: cachedModels } = useSelector(selectModels);
  const { modelName: defaultModelName } = useSelector(selectSettings);
  useSelector(selectPrompts);
  const { snippets: allSnippets, regenerationStatus } =
    useSelector(selectSnippets);

  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [isExpanded, setIsExpanded] = useState(false); // req:snippet-expand-collapse
  const [editingName, setEditingName] = useState(snippet.name);
  const [editingContent, setEditingContent] = useState(snippet.content);
  const [editingIsGenerated, setEditingIsGenerated] = useState(
    snippet.isGenerated
  );
  const [editingPrompt, setEditingPrompt] = useState(snippet.prompt || "");
  const [editingModel, setEditingModel] = useState(
    snippet.model || defaultModelName
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptErrors, setPromptErrors] = useState<string[]>([]);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [hasManuallyRegenerated, setHasManuallyRegenerated] = useState(false);
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
    // Reset manual regeneration flag when prompt changes
    setHasManuallyRegenerated(false);
  }, [editingPrompt]);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing, snippet.name]);

  useEffect(() => {
    const errors: string[] = [];
    const textToScan = editingIsGenerated ? editingPrompt : editingContent;

    const otherSnippets = allSnippets.filter((s) => s.id !== snippet.id);
    const currentSnippetForValidation = {
      ...snippet,
      name: editingName.trim() || snippet.name,
      prompt: editingPrompt,
      isGenerated: editingIsGenerated,
      model: editingModel,
      content: editingContent,
    };
    const snippetsForValidation = [
      ...otherSnippets,
      currentSnippetForValidation,
    ];

    try {
      validateSnippetDependencies(textToScan, snippetsForValidation);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "An unknown cycle was detected."
      );
    }

    const missingSnippets = findNonExistentSnippets(
      textToScan,
      snippetsForValidation
    );
    if (missingSnippets.length > 0) {
      for (const missing of missingSnippets) {
        errors.push(`Warning: Snippet '@${missing}' not found.`);
      }
    }

    setPromptErrors(errors);
  }, [
    editingIsGenerated,
    editingPrompt,
    editingName,
    allSnippets,
    snippet,
    editingModel,
    editingContent,
  ]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newName = e.target.value;
    setEditingName(newName);

    // req:name-required: Name cannot be empty
    if (newName.trim() === "") {
      setNameError("Name cannot be empty.");
      return;
    }

    // req:name-validation: Name can only contain alphanumeric characters and underscores
    if (!NAME_REGEX.test(newName)) {
      setNameError(
        "Name can only contain alphanumeric characters and underscores."
      );
      return;
    }

    // req:name-uniqueness: Names must be unique (case-insensitive)
    const isDuplicate = allSnippets.some(
      (s) =>
        s.name.trim().toLowerCase() === newName.trim().toLowerCase() &&
        s.id !== snippet.id
    );

    if (isDuplicate) {
      setNameError("A snippet with this name already exists.");
    } else {
      setNameError(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    const trimmedName = editingName.trim();
    if (nameError || trimmedName === "") {
      if (trimmedName === "") setNameError("Name cannot be empty.");
      return;
    }

    // req:save-button-dirty-detection: Check if prompt has changed for generated snippets
    const promptChanged =
      editingIsGenerated && editingPrompt !== (snippet.prompt || "");

    // Only trigger automatic regeneration if:
    // 1. This is an existing snippet (not being created for the first time)
    // 2. The prompt has changed
    // 3. The user hasn't manually regenerated
    // 4. There are no prompt errors (like cycles)
    const isExistingSnippet = Boolean(snippet.id);
    const hasPromptErrors = promptErrors.length > 0;
    const shouldAutoRegenerate =
      isExistingSnippet &&
      promptChanged &&
      !hasManuallyRegenerated &&
      !hasPromptErrors;

    const snippetForSave: Snippet = {
      ...snippet,
      id: snippet.id || crypto.randomUUID(),
      name: trimmedName,
      // The content will be updated by the generation process if needed
      content: editingContent,
      isGenerated: editingIsGenerated,
      prompt: editingPrompt,
      model: editingModel,
      // Mark as dirty if we need to auto-regenerate
      isDirty: shouldAutoRegenerate || snippet.isDirty,
    };

    // req:save-button-dirty-detection: Use new orchestrated flow for auto-regeneration
    // The new action ensures snippet regenerates BEFORE its dependents, eliminating race condition
    if (shouldAutoRegenerate) {
      // Use the new master orchestrator saga that handles the entire flow:
      // 1. Save snippet
      // 2. Regenerate snippet and WAIT for completion
      // 3. Regenerate dependents with fresh data
      dispatch(updateAndRegenerateSnippetRequested({ snippet: snippetForSave }));
    } else {
      // No auto-regeneration needed, just save normally
      await onUpdate(snippetForSave);
    }

    setIsEditing(false);
    setNameError(null);
  };

  const generateAndSetContent = (): void => {
    const id = snippet.id || crypto.randomUUID();
    const snippetForRegeneration: Snippet = {
      ...snippet,
      id,
      name: editingName.trim(),
      content: editingContent, // This is a placeholder, the saga will replace it
      isGenerated: editingIsGenerated,
      prompt: editingPrompt,
      model: editingModel,
    };
    // Store the generated ID so we can look up regeneration status
    setGeneratedId(id);
    // Mark that user has manually regenerated
    setHasManuallyRegenerated(true);
    dispatch(regenerateSnippet(snippetForRegeneration));
  };

  const handleCancelEditing = (): void => {
    if (isInitiallyEditing && onCancel) {
      onCancel();
    } else {
      setEditingName(snippet.name);
      setEditingContent(snippet.content);
      setEditingIsGenerated(snippet.isGenerated);
      setEditingPrompt(snippet.prompt || "");
      setEditingModel(snippet.model || defaultModelName);
      setNameError(null);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div
        className="system-prompt-item-edit"
        data-testid={`snippet-item-edit-${snippet.id || "new"}`}
      >
        <div className="system-prompt-inputs">
          <input
            ref={nameInputRef}
            type="text"
            value={editingName}
            onChange={handleNameChange}
            placeholder="name"
            data-testid="snippet-name-input"
          />
          {nameError && (
            <div className="error-message" data-testid="error-message">
              {nameError}
            </div>
          )}

          <div className="settings-item">
            <label
              htmlFor={`generated-checkbox-${snippet.id}`}
              className="checkbox-label"
            >
              <input
                type="checkbox"
                id={`generated-checkbox-${snippet.id}`}
                checked={editingIsGenerated}
                onChange={(e) => {
                  setEditingIsGenerated(e.target.checked);
                }}
                data-testid="snippet-generated-checkbox"
              />
              <span className="checkbox-custom"></span>
              Generated Snippet
            </label>
          </div>

          {/* req:generated-snippet-ui: Show generated snippet fields when checkbox is checked */}
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
                onChange={(e) => {
                  setEditingPrompt(e.target.value);
                }}
                placeholder="Prompt to generate content..."
                data-testid="snippet-prompt-input"
                rows={5}
              />
            </>
          )}

          {editingIsGenerated ? (
            <div
              className="generated-content-readonly"
              data-testid="snippet-content-display"
            >
              <div
                className="settings-label"
                style={{
                  fontSize: "var(--font-size-small)",
                  marginTop: "10px",
                }}
              >
                Content (read-only)
              </div>
              {promptErrors.length > 0 ? (
                <div
                  className="error-message"
                  data-testid="prompt-error-message"
                >
                  {promptErrors.map((error, i) => (
                    <div key={i}>{error}</div>
                  ))}
                </div>
              ) : (
                <Markdown markdownText={editingContent} />
              )}
            </div>
          ) : (
            <>
              <textarea
                value={editingContent}
                onChange={(e) => {
                  setEditingContent(e.target.value);
                }}
                placeholder="content"
                data-testid="snippet-content-input"
                rows={5}
              />
              {promptErrors.length > 0 && (
                <div
                  className="error-message"
                  data-testid="prompt-error-message"
                >
                  {promptErrors.map((error, i) => (
                    <div key={i}>{error}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="system-prompt-edit-buttons">
          {editingIsGenerated && (
            <button
              onClick={() => {
                generateAndSetContent();
              }}
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
            disabled={!!nameError && editingName.trim() !== ""}
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
          {(() => {
            // Check both regenerationStatus (for current session errors) and snippet.generationError (for persisted errors)
            // Use the generated ID if available, otherwise use the snippet ID
            const idToLookup = generatedId || snippet.id;
            const regenerationError = regenerationStatus[idToLookup]?.error;
            const persistedError = snippet.generationError;

            if (regenerationError) {
              return getErrorMessage(regenerationError);
            } else if (persistedError) {
              return getErrorMessage(persistedError);
            } else {
              return "";
            }
          })()}
        </div>
      </div>
    );
  }

  return (
    <div
      className="system-prompt-item-view"
      data-testid={`snippet-item-${snippet.id}`}
    >
      <div className="system-prompt-header">
        <span className="system-prompt-name">
          {snippet.name}
          {/* req:error-warning-sign: Show warning for cyclic dependencies */}
          {isCyclic && (
            <span
              className="cycle-warning-icon"
              data-testid="cycle-warning-icon"
              title="This snippet is part of a dependency cycle. Automatic regeneration is disabled."
              style={{
                marginLeft: "8px",
                color: "var(--color-warning, #ff9800)",
                fontSize: "16px",
                cursor: "help",
              }}
            >
              ⚠️
            </span>
          )}
        </span>
        <div className="system-prompt-actions">
          {(() => {
            const status = regenerationStatus[snippet.id]?.status || "idle";
            const isRegenerating = status === "in_progress";
            const shouldShowSpinner = isRegenerating || snippet.isDirty;

            return (
              <div className="system-prompt-buttons">
                {/* req:dirty-loading-indicator: Show loading indicator for dirty/regenerating snippets */}
                {shouldShowSpinner && (
                  <span
                    className="spinner"
                    data-testid="regenerating-spinner"
                  />
                )}
                <button
                  onClick={() => {
                    setIsExpanded(!isExpanded);
                  }}
                  data-size="compact"
                  data-testid="snippet-toggle-button"
                >
                  {isExpanded ? "Collapse" : "Expand"}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(true);
                  }}
                  data-size="compact"
                  data-testid="snippet-edit-button"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    void onRemove(snippet.id);
                  }}
                  data-size="compact"
                  data-testid="snippet-delete-button"
                >
                  Delete
                </button>
              </div>
            );
          })()}
        </div>
      </div>
      <div>
        {/* req:snippet-expand-collapse: Show plain text when collapsed, markdown when expanded */}
        {isExpanded ? (
          <Markdown markdownText={snippet.content} />
        ) : (
          <div className="system-prompt-text">{snippet.content}</div>
        )}
      </div>
      {(() => {
        const regenerationError = regenerationStatus[snippet.id]?.error;
        const persistedError = snippet.generationError;

        // req:error-warning-sign: Show error messages for failed generation
        if (regenerationError) {
          // For snippet regeneration errors, extract just the core error message
          let errorMessage: string;
          if (regenerationError.type === "SNIPPET_REGENERATION_ERROR") {
            // The reason field might be a formatted error message like "API Error: 500 Internal Server Error"
            // Extract just the core message for cleaner display
            const reason = regenerationError.reason;
            if (reason.startsWith("API Error: ")) {
              errorMessage = reason.substring("API Error: ".length);
            } else {
              errorMessage = reason;
            }
          } else {
            errorMessage = getErrorMessage(regenerationError);
          }
          return (
            <div
              className="error-message"
              data-testid="generation-error-message"
            >
              {`Generation failed: ${errorMessage}`}
            </div>
          );
        } else if (persistedError) {
          return (
            <div
              className="error-message"
              data-testid="generation-error-message"
            >
              {getErrorMessage(persistedError)}
            </div>
          );
        } else {
          return null;
        }
      })()}
    </div>
  );
};

export default SnippetItem;

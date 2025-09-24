import React, { useState, useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import SystemPromptItem from "@/components/SystemPromptItem";
import SnippetItem from "@/components/SnippetItem";
import type { Snippet, SystemPrompt } from "@/types/storage";
import type { PromptEntity } from "@/store/features/prompts/promptsSlice";
import { topologicalSort } from "@/utils/snippetUtils";
import {
  selectSettings,
  setApiKey,
  toggleAutoScroll,
  loadSettings,
  saveSettings,
} from "@/store/features/settings/settingsSlice";
import {
  selectPrompts,
  loadPrompts,
  addPromptRequest,
  updatePromptRequest,
  deletePromptRequest,
} from "@/store/features/prompts/promptsSlice";
import {
  selectSnippets,
  loadSnippets,
  addSnippet,
  updateSnippet,
  deleteSnippet,
} from "@/store/features/snippets/snippetsSlice";

const SettingsPage: React.FC = () => {
  const dispatch = useDispatch();

  // --- Redux State ---
  const { apiKey, autoScrollEnabled, saving } = useSelector(selectSettings);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);
  const { snippets, loading: snippetsLoading } = useSelector(selectSnippets);

  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [editingPromptName, setEditingPromptName] = useState<string | null>(
    null,
  );
  const [isCreatingNewSnippet, setIsCreatingNewSnippet] = useState(false);

  useEffect(() => {
    dispatch(loadSettings());
    dispatch(loadPrompts());
    dispatch(loadSnippets());
  }, [dispatch]);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  const systemPromptEntities = useMemo(
    () => Object.values(systemPromptsMap),
    [systemPromptsMap],
  );

  const allPromptsData = useMemo(
    () => systemPromptEntities.map((entity) => entity.data),
    [systemPromptEntities],
  );

  const handleSaveApiKey = (): void => {
    dispatch(setApiKey(localApiKey));
    dispatch(saveSettings({}));
  };

  const handleToggleAutoScroll = (): void => {
    dispatch(toggleAutoScroll());
    dispatch(saveSettings({}));
  };

  // --- Prompt Handlers ---
  const handleNewPrompt = (): void => {
    setEditingPromptName("__new__");
  };
  const handleCancelNewPrompt = (): void => {
    setEditingPromptName(null);
  };
  const handleCreatePrompt = (newPrompt: SystemPrompt): void => {
    dispatch(addPromptRequest(newPrompt));
    setEditingPromptName(null);
  };
  const handleUpdatePrompt = (
    oldName: string,
    updatedPrompt: SystemPrompt,
  ): void => {
    dispatch(updatePromptRequest({ oldName, prompt: updatedPrompt }));
    setEditingPromptName(null);
  };
  const handleRemovePrompt = (name: string): void => {
    dispatch(deletePromptRequest(name));
  };

  // --- Snippet Handlers ---
  const handleNewSnippet = (): void => {
    setIsCreatingNewSnippet(true);
  };
  const handleCancelNewSnippet = (): void => {
    setIsCreatingNewSnippet(false);
  };
  const handleCreateSnippet = (newSnippet: Snippet): Promise<void> => {
    dispatch(addSnippet(newSnippet));
    setIsCreatingNewSnippet(false);
    return Promise.resolve();
  };
  const handleUpdateSnippet = (
    updatedSnippet: Snippet,
  ): Promise<void> => {
    dispatch(updateSnippet(updatedSnippet));
    return Promise.resolve();
  };
  const handleRemoveSnippet = (id: string): Promise<void> => {
    dispatch(deleteSnippet(id));
    return Promise.resolve();
  };

  const sortedSnippets = useMemo(() => {
    const { sorted } = topologicalSort(snippets);
    return sorted;
  }, [snippets]);

  if (snippetsLoading === "loading") {
    return <div className="loading-spinner">Loading...</div>;
  }

  return (
    <div style={{ marginBottom: "50px" }}>
      <div className="settings-section">
        <div className="settings-label">OPENROUTER_API_KEY</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            value={localApiKey}
            onChange={(e) => {
              setLocalApiKey(e.currentTarget.value);
            }}
            placeholder="OPENROUTER_API_KEY"
            style={{ flexGrow: 1 }}
          />
          <button
            onClick={handleSaveApiKey}
            data-role="primary"
            disabled={saving === "saving"}
          >
            {saving === "saving"
              ? "Saving..."
              : saving === "idle"
                ? "Save"
                : "Saved!"}
          </button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">Chat</div>
        <div className="settings-item">
          <label htmlFor="auto-scroll-checkbox" className="checkbox-label">
            <input
              type="checkbox"
              id="auto-scroll-checkbox"
              checked={autoScrollEnabled}
              onChange={handleToggleAutoScroll}
            />
            <span className="checkbox-custom"></span>
            Auto-scroll to bottom
          </label>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">system prompts</div>
        <button
          data-testid="new-system-prompt-button"
          data-role="primary"
          data-size="compact"
          onClick={handleNewPrompt}
          style={{ marginBottom: "20px" }}
          disabled={!!editingPromptName || isCreatingNewSnippet}
        >
          New
        </button>
        <div className="system-prompt-list">
          {editingPromptName === "__new__" && (
            <SystemPromptItem
              prompt={{ name: "", prompt: "" }}
              status="idle"
              error={null}
              isInitiallyEditing={true}
              allPrompts={allPromptsData}
              onUpdate={handleCreatePrompt}
              onRemove={handleCancelNewPrompt}
              onCancel={handleCancelNewPrompt}
            />
          )}
          {systemPromptEntities.map((entity: PromptEntity) => (
            <SystemPromptItem
              key={entity.data.name}
              prompt={entity.data}
              status={entity.status}
              error={entity.error ?? null}
              isInitiallyEditing={editingPromptName === entity.data.name}
              allPrompts={allPromptsData}
              onUpdate={(updatedPrompt) =>
                handleUpdatePrompt(entity.data.name, updatedPrompt)
              }
              onRemove={() => {
                handleRemovePrompt(entity.data.name);
              }}
              onEdit={() => setEditingPromptName(entity.data.name)}
              onCancel={() => setEditingPromptName(null)}
            />
          ))}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">Snippets</div>
        <button
          data-testid="new-snippet-button"
          data-role="primary"
          data-size="compact"
          onClick={handleNewSnippet}
          style={{ marginBottom: "20px" }}
          disabled={isCreatingNewSnippet || !!editingPromptName}
        >
          New Snippet
        </button>
        <div className="snippet-list">
          {isCreatingNewSnippet && (
            <SnippetItem
              snippet={{
                id: "", // ID will be generated in the component
                name: "",
                content: "",
                isGenerated: false,
                createdAt_ms: 0,
                updatedAt_ms: 0,
                generationError: null,
                isDirty: false,
              }}
              isInitiallyEditing={true}
              onUpdate={(updatedSnippet) =>
                handleCreateSnippet(updatedSnippet)
              }
              onRemove={() => {
                handleCancelNewSnippet();
                return Promise.resolve();
              }}
              onCancel={handleCancelNewSnippet}
            />
          )}
          {sortedSnippets.map((snippet: Snippet) => (
            <SnippetItem
              key={snippet.id}
              snippet={snippet}
              isInitiallyEditing={false}
              onUpdate={(updatedSnippet) =>
                handleUpdateSnippet(updatedSnippet)
              }
              onRemove={() => handleRemoveSnippet(snippet.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

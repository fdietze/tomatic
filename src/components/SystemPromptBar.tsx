import React from "react";

import { PromptEntity } from "../store/features/prompts/promptsSlice";

interface SystemPromptBarProps {
  systemPrompts: PromptEntity[];
  selectedPromptName: string | null;
  onSelectPrompt: (name: string | null) => void;
}

const SystemPromptBar: React.FC<SystemPromptBarProps> = ({
  systemPrompts,
  selectedPromptName,
  onSelectPrompt,
}) => {
  const visiblePrompts = systemPrompts.filter((p) => p.status !== "deleting");
  console.log("[DEBUG] SystemPromptBar: rendering with systemPrompts:", systemPrompts.map(p => ({ name: p.data.name, status: p.status })));
  console.log("[DEBUG] SystemPromptBar: visiblePrompts:", visiblePrompts.map(p => p.data.name));
  console.log("[DEBUG] SystemPromptBar: selectedPromptName:", selectedPromptName);
  
  const selectedPrompt = visiblePrompts.find(
    (p) => p.data.name === selectedPromptName,
  );
  const unselectedPrompts = visiblePrompts.filter(
    (p) => p.data.name !== selectedPromptName,
  );
  
  console.log(`[DEBUG] SystemPromptBar: selectedPrompt found: ${!!selectedPrompt}`);
  console.log(`[DEBUG] SystemPromptBar: unselectedPrompts count: ${unselectedPrompts.length}`);
  if (selectedPrompt) {
    console.log(`[DEBUG] SystemPromptBar: will render SELECTED button for: ${selectedPrompt.data.name} with testid: system-prompt-button-${selectedPrompt.data.name}`);
  }
  unselectedPrompts.forEach(prompt => {
    console.log(`[DEBUG] SystemPromptBar: will render UNSELECTED button for: ${prompt.data.name} with testid: system-prompt-button-${prompt.data.name}`);
  });

  const handleSelectPrompt = (name: string): void => {
    console.log("[DEBUG] SystemPromptBar: handleSelectPrompt called with name:", name);
    if (selectedPromptName === name) {
      console.log("[DEBUG] SystemPromptBar: deselecting prompt");
      onSelectPrompt(null); // Deselect if already selected
    } else {
      console.log("[DEBUG] SystemPromptBar: selecting prompt");
      onSelectPrompt(name);
    }
  };

  return (
    <>
      {selectedPrompt && (
        <button
          key={selectedPrompt.data.name}
          data-size="compact"
          data-role="outline"
          className="chat-controls-system-prompt"
          data-selected={true}
          data-testid={`system-prompt-button-${selectedPrompt.data.name}`}
          onClick={() => {
            handleSelectPrompt(selectedPrompt.data.name);
          }}
        >
          {selectedPrompt.data.name}
        </button>
      )}
      <div className="unselected-prompts">
        {unselectedPrompts.map((prompt) => (
          <button
            key={prompt.data.name}
            data-size="compact"
            data-role="outline"
            className="chat-controls-system-prompt"
            data-selected={false}
            data-testid={`system-prompt-button-${prompt.data.name}`}
            onClick={() => {
              handleSelectPrompt(prompt.data.name);
            }}
          >
            {prompt.data.name}
          </button>
        ))}
      </div>
    </>
  );
};

export default SystemPromptBar;

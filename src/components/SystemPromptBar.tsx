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
  
  const selectedPrompt = visiblePrompts.find(
    (p) => p.data.name === selectedPromptName,
  );
  const unselectedPrompts = visiblePrompts.filter(
    (p) => p.data.name !== selectedPromptName,
  );

  const handleSelectPrompt = (name: string): void => {
    if (selectedPromptName === name) {
      onSelectPrompt(null); // Deselect if already selected
    } else {
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

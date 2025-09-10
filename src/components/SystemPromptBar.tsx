import React from 'react';
import type { SystemPrompt } from '@/types/storage';

interface SystemPromptBarProps {
  systemPrompts: SystemPrompt[];
  selectedPromptName: string | null;
  onSelectPrompt: (name: string | null) => void;
}

const SystemPromptBar: React.FC<SystemPromptBarProps> = ({
  systemPrompts,
  selectedPromptName,
  onSelectPrompt,
}) => {
  const selectedPrompt = systemPrompts.find((p) => p.name === selectedPromptName);
  const unselectedPrompts = systemPrompts.filter((p) => p.name !== selectedPromptName);

  const handleSelectPrompt = (name: string) => {
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
          key={selectedPrompt.name}
          data-size="compact"
          data-role="outline"
          className="chat-controls-system-prompt"
          data-selected={true}
          onClick={() => handleSelectPrompt(selectedPrompt.name)}
        >
          {selectedPrompt.name}
        </button>
      )}
      <div className="unselected-prompts">
        {unselectedPrompts.map((prompt) => (
          <button
            key={prompt.name}
            data-size="compact"
            data-role="outline"
            className="chat-controls-system-prompt"
            data-selected={false}
            onClick={() => handleSelectPrompt(prompt.name)}
          >
            {prompt.name}
          </button>
        ))}
      </div>
    </>
  );
};

export default SystemPromptBar;

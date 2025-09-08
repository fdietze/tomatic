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
  return (
    <>
      {systemPrompts.map((prompt) => (
        <button
          key={prompt.name}
          data-size="compact"
          data-role="outline"
          className="chat-controls-system-prompt"
          data-selected={selectedPromptName === prompt.name}
          onClick={() => {
            if (selectedPromptName === prompt.name) {
              onSelectPrompt(null); // Deselect if already selected
            } else {
              onSelectPrompt(prompt.name);
            }
          }}
        >
          {prompt.name}
        </button>
      ))}
    </>
  );
};

export default SystemPromptBar;

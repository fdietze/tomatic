import React from 'react';
import type { SystemPrompt } from '@/types/storage';
import Combobox, { type ComboboxItem } from './Combobox';

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
  const items: ComboboxItem[] = systemPrompts.map((prompt) => ({
    id: prompt.name,
    display_text: prompt.name,
    model_info: {
      id: '',
      name: '',
      prompt_cost_usd_pm: null,
      completion_cost_usd_pm: null,
    },
  }));

  const handleSelect = (id: string) => {
    if (selectedPromptName === id) {
      onSelectPrompt(null);
    } else {
      onSelectPrompt(id);
    }
  };

  return (
    <Combobox
      items={items}
      selectedId={selectedPromptName || ''}
      onSelect={handleSelect}
      placeholder="Select a system prompt"
    />
  );
};

export default SystemPromptBar;

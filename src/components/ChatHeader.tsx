import React from 'react';
import { useNavigate } from 'react-router-dom';
import SystemPromptBar from './SystemPromptBar';
import type { SystemPrompt } from '@/types/storage';

interface ChatHeaderProps {
  systemPrompts: SystemPrompt[];
  selectedPromptName: string | null;
  setSelectedPromptName: (name: string | null) => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  systemPrompts,
  selectedPromptName,
  setSelectedPromptName,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}) => {
  const navigate = useNavigate();

  const onNewChat = () => {
    void navigate('/chat/new');
  };

  return (
    <div className="chat-header">
      <button data-size="compact" onClick={onPrev} disabled={!canGoPrev} data-testid="prev-session-button">
        Prev
      </button>
      <button data-testid="next-session-button"
        data-size="compact"
        onClick={onNext}
        disabled={!canGoNext}
        style={{ marginRight: 'auto' }}
      >
        Next
      </button>
      <div className="system-prompt-container">
        <SystemPromptBar
          systemPrompts={systemPrompts}
          selectedPromptName={selectedPromptName}
          onSelectPrompt={setSelectedPromptName}
        />
      </div>
      <button data-role="primary" data-size="compact" onClick={onNewChat} data-testid="new-chat-button">
        New Chat
      </button>
    </div>
  );
};

export default ChatHeader;

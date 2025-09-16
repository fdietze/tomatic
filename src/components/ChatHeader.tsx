import { useNavigate } from 'react-router-dom';
import React from 'react';

interface ChatHeaderProps {
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  children: React.ReactNode;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  children,
}) => {
  const navigate = useNavigate();

  const handleNewChat = (): void => {
    void navigate('/chat/new');
  };

  return (
    <div className="chat-header">
      <button data-size="compact" onClick={onPrev} disabled={!canGoPrev} data-testid="prev-session-button">
        Prev
      </button>
      <button
        data-testid="next-session-button"
        data-size="compact"
        onClick={onNext}
        disabled={!canGoNext}
        style={{ marginRight: 'auto' }}
      >
        Next
      </button>
      <div className="system-prompt-container">{children}</div>
      <button data-role="primary" data-size="compact" onClick={handleNewChat} data-testid="new-chat-button">
        New Chat
      </button>
    </div>
  );
};

export default ChatHeader;

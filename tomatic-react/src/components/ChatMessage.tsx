import React, { useState, useMemo } from 'react';
import type { Message } from '@/types/chat';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';

interface ChatMessageProps {
  message: Message;
  messageIndex: number;
  onRegenerate: (index: number) => void;
  onEditAndResubmit: (index: number, newContent: string) => void;
  isMobile: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  messageIndex,
  onRegenerate,
  onEditAndResubmit,
  isMobile,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editInput, setEditInput] = useState(message.content);

  const isSystemMessage = message.role === 'system';
  const [collapsed, setCollapsed] = useState(isSystemMessage);

  const handleResubmit = () => {
    onEditAndResubmit(messageIndex, editInput);
    setIsEditing(false);
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleResubmit);

  const textForCopyButton = isEditing ? editInput : message.content;

  const roleDisplay = useMemo(() => {
    let displayString: string = message.role;
    if (message.role === 'assistant' && message.model_name) {
      displayString = `assistant (${message.model_name})`;
    } else if (message.role === 'system' && message.prompt_name) {
      displayString = `system @${message.prompt_name}`;
    }

    if (isSystemMessage) {
      const indicator = collapsed ? '▶' : '▼';
      return `${indicator} ${displayString}`;
    }
    return displayString;
  }, [message, isSystemMessage, collapsed]);

  const toggleCollapsed = () => {
    if (isSystemMessage) {
      setCollapsed((c) => !c);
    }
  };

  const renderButtons = () => {
    if (message.role === 'assistant') {
      return (
        <button data-size="compact" onClick={() => onRegenerate(messageIndex)}>
          regenerate
        </button>
      );
    }
    if (message.role === 'user') {
      return (
        <button data-size="compact" onClick={() => setIsEditing(!isEditing)}>
          edit
        </button>
      );
    }
    return null;
  };

  return (
    <div
      className={`chat-message ${isSystemMessage && collapsed ? 'collapsed' : ''}`}
      data-role={message.role}
      data-testid="chat-message"
    >
      <div style={{ display: 'flex' }} onClick={toggleCollapsed}>
        <div className="chat-message-role">{roleDisplay}</div>
        <div className="chat-message-buttons">
          <CopyButton textToCopy={textForCopyButton} />
          {renderButtons()}
        </div>
      </div>
      <div className="chat-message-content">
        {isEditing ? (
          <>
            <textarea
              style={{ width: '100%' }}
              value={editInput}
              onInput={(e) => setEditInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
              <button
                data-role="secondary"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  setEditInput(message.content);
                  setIsEditing(false);
                }}
              >
                Discard
              </button>
              <button onClick={handleResubmit}>Re-submit</button>
            </div>
          </>
        ) : (
          <Markdown markdownText={message.content} />
        )}
      </div>
      {message.cost && (
        <div className="chat-message-cost" style={{ textAlign: 'right', fontSize: '0.8em', opacity: 0.6, marginTop: '4px' }}>
          {`prompt: $${message.cost.prompt.toFixed(6)}, completion: $${message.cost.completion.toFixed(6)}, total: $${(message.cost.prompt + message.cost.completion).toFixed(6)}`}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;

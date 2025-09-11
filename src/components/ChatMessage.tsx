import React, { useState, useMemo } from 'react';
import type { Message } from '@/types/chat';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';

interface CostProps {
  value: number;
}

const Cost: React.FC<CostProps> = ({ value }) => {
  const costStr = value.toFixed(6);

  if (value < 0.01) {
    return <span style={{ color: 'var(--base03)' }}>${costStr}</span>;
  }

  const parts = costStr.split('.');
  const dollarsAndCents = parts[0] + '.' + parts[1].substring(0, 2);
  const fractionsOfCents = parts[1].substring(2);

  return (
    <span>
      <span style={{ color: 'var(--base05)' }}>${dollarsAndCents}</span>
      <span style={{ color: 'var(--base03)' }}>{fractionsOfCents}</span>
    </span>
  );
};

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
  const [editInput, setEditInput] = useState(message.raw_content || message.content);

  const isSystemMessage = message.role === 'system';
  const [collapsed, setCollapsed] = useState(isSystemMessage);

  const handleResubmit = () => {
    onEditAndResubmit(messageIndex, editInput);
    setIsEditing(false);
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleResubmit);

  const contentToDisplay = message.raw_content || message.content;
  const textForCopyButton = isEditing ? editInput : contentToDisplay;

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
        <button data-size="compact" onClick={() => { onRegenerate(messageIndex); }}>
          regenerate
        </button>
      );
    }
    if (message.role === 'user') {
      return (
        <button data-size="compact" onClick={() => { setIsEditing(!isEditing); }}>
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
      data-message-id={message.id}
      data-testid={`chat-message-${String(messageIndex)}`}
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
              onInput={(e) => { setEditInput(e.currentTarget.value); }}
              onKeyDown={handleKeyDown}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
              <button
                data-role="secondary"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  setEditInput(message.raw_content || message.content);
                  setIsEditing(false);
                }}
              >
                Discard
              </button>
              <button onClick={handleResubmit}>Re-submit</button>
            </div>
          </>
        ) : (
          <Markdown markdownText={contentToDisplay} />
        )}
      </div>
      {message.cost && (
        <div className="chat-message-cost" style={{ textAlign: 'right', fontSize: '0.8em', color: 'var(--base03)', marginTop: '4px' }}>
          prompt: <Cost value={message.cost.prompt} />
          {message.cost.prompt_tokens && <span> ({message.cost.prompt_tokens} tokens)</span>},
          completion: <Cost value={message.cost.completion} />
          {message.cost.completion_tokens && <span> ({message.cost.completion_tokens} tokens)</span>},
          total: <Cost value={message.cost.prompt + message.cost.completion} />
          {(message.cost.prompt_tokens && message.cost.completion_tokens) && <span> ({message.cost.prompt_tokens + message.cost.completion_tokens} tokens)</span>}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;

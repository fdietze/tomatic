import React, { useState, useMemo } from 'react';
import type { Message } from '@/types/chat';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';
import { assertUnreachable } from '@/utils/assert';
import { getErrorMessage } from '@/types/errors';

interface CostProps {
  value: number;
}

const Cost: React.FC<CostProps> = ({ value }) => {
  if (isNaN(value)) {
    return <span style={{ color: 'var(--base03)' }}>$?.??????</span>;
  }
  const costStr = value.toFixed(6);

  if (value < 0.01) {
    return <span style={{ color: 'var(--base03)' }}>${costStr}</span>;
  }

  const parts = costStr.split('.');
  const dollarsAndCents = (parts[0] || '0') + '.' + (parts[1] || '00').substring(0, 2);
  const fractionsOfCents = (parts[1] || '00').substring(2);

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
  // req:raw-content-preservation: Display raw content with snippet references
  const contentToDisplay = message.raw_content ?? message.content;
  // req:edit-textarea-population: Use raw content for editing
  const contentForEditing = message.raw_content ?? message.content;
  const [isEditing, setIsEditing] = useState(false);
  const [editInput, setEditInput] = useState(contentForEditing);

  const isSystemMessage = message.role === 'system';
  const [collapsed, setCollapsed] = useState(isSystemMessage);

  const handleResubmit = (): void => {
    onEditAndResubmit(messageIndex, editInput);
    setIsEditing(false);
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleResubmit);

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

  const toggleCollapsed = (): void => {
    if (isSystemMessage) {
      setCollapsed((c) => !c);
    }
  };

  const renderButtons = (): React.JSX.Element | null => {
    switch (message.role) {
      case 'assistant':
        return (
          <button data-size="compact" onClick={() => { onRegenerate(messageIndex); }} data-testid="regenerate-button">
            regenerate
          </button>
        );
      case 'user':
        return (
          <button data-size="compact" onClick={() => { setIsEditing(!isEditing); }} data-testid="edit-button">
            edit
          </button>
        );
      case 'system':
        return null;
      default:
        return assertUnreachable(message.role);
    }
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
              data-testid="edit-textarea"
              style={{ width: '100%' }}
              value={editInput}
              onInput={(e) => { setEditInput(e.currentTarget.value); }}
              onKeyDown={handleKeyDown}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
              <button
                data-role="secondary"
                style={{ marginLeft: 'auto' }}
                data-testid="discard-edit-button"
                onClick={() => {
                  setEditInput(contentToDisplay);
                  setIsEditing(false);
                }}
              >
                Discard
              </button>
              <button onClick={handleResubmit} data-testid="resubmit-button">Re-submit</button>
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
      {message.error && (
        <div className="error-message" data-testid="error-message">
            <p>{getErrorMessage(message.error)}</p>
        </div>
      )}
    </div>
  );
};

export default ChatMessage;

import React from 'react';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';
import { useGlobalState } from '@/context/GlobalStateContext';

interface ChatControlsProps {
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  isMobile: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  apiKey: string;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  input,
  setInput,
  isStreaming,
  isMobile,
  inputRef,
  apiKey,
}) => {
  const { sessionActor } = useGlobalState();

  const handleSubmit = (): void => {
    if (!isStreaming && input.trim().length > 0) {
      sessionActor.send({ type: 'SUBMIT', prompt: input });
    }
  };

  const handleCancel = (): void => {
    sessionActor.send({ type: 'CANCEL' });
  };

  const handleFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    handleSubmit();
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleSubmit);

  return (
    <div className="chat-controls">
      <form onSubmit={handleFormSubmit}>
        <div style={{ display: 'flex', padding: '4px', gap: '4px' }}>
          <textarea
            ref={inputRef}
            value={input}
            onInput={(e) => { setInput(e.currentTarget.value); }}
            placeholder="Message"
            onKeyDown={handleKeyDown}
            disabled={isStreaming || !apiKey}
            data-testid="chat-input"
          />
          {isStreaming ? (
            <button
              type="button"
              data-role="destructive"
              style={{ flexShrink: 0 }}
              onClick={handleCancel}
            >
              <span className="spinner" />
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              data-role="primary"
              style={{ flexShrink: 0 }}
              disabled={input.trim().length === 0 || !apiKey}
              data-testid="chat-submit"
            >
              Go
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default ChatControls;

import React from "react";
import { useTextAreaEnterHandler } from "@/hooks/useTextAreaEnterHandler";

interface ChatControlsProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (prompt: string) => void;
  isStreaming: boolean;
  isMobile: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  apiKey: string;
  onCancel: () => void;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  input,
  setInput,
  onSubmit,
  isStreaming,
  isMobile,
  inputRef,
  apiKey,
  onCancel,
}) => {
  const handleSend = (): void => {
    if (input.trim() && !isStreaming) {
      onSubmit(input.trim());
    }
  };

  const handleFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    handleSend();
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleSend);

  return (
    <div className="chat-controls">
      <form onSubmit={handleFormSubmit}>
        <div style={{ display: "flex", padding: "4px", gap: "4px" }}>
          <textarea
            ref={inputRef}
            value={input}
            onInput={(e) => {
              setInput(e.currentTarget.value);
            }}
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
              onClick={onCancel}
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

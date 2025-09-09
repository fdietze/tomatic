import React from 'react';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';

interface ChatControlsProps {
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  onSubmit: (promptOverride?: string) => void;
  onCancel: () => void;
  isMobile: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  apiKey: string;
  imagePreviewUrl: string | null;
  setImagePreviewUrl: (url: string | null) => void;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  input,
  setInput,
  isStreaming,
  onSubmit,
  onCancel,
  isMobile,
  inputRef,
  apiKey,
  imagePreviewUrl,
  setImagePreviewUrl,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStreaming) {
      onSubmit();
    }
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, () => {
    if (!isStreaming) {
      onSubmit();
    }
  });

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="chat-controls">
      {imagePreviewUrl && (
        <div className="image-preview">
          <img src={imagePreviewUrl} alt="Preview" />
          <button onClick={() => setImagePreviewUrl(null)}>X</button>
        </div>
      )}
      <form onSubmit={handleFormSubmit}>
        <div style={{ display: 'flex', padding: '4px', gap: '4px' }}>
          <textarea
            ref={inputRef}
            value={input}
            onInput={(e) => setInput(e.currentTarget.value)}
            placeholder="Message"
            onKeyDown={handleKeyDown}
            disabled={isStreaming || !apiKey}
            data-testid="chat-input"
          />
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept="image/*"
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
            <>
              <button
                type="button"
                onClick={handleAttachClick}
                style={{ flexShrink: 0 }}
                disabled={!apiKey}
              >
                Attach
              </button>
              <button
                type="submit"
                data-role="primary"
                style={{ flexShrink: 0 }}
                disabled={(input.trim().length === 0 && !imagePreviewUrl) || !apiKey}
                data-testid="chat-submit"
              >
                Go
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
};

export default ChatControls;

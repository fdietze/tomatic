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
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

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

  const handleCameraClick = () => {
    cameraInputRef.current?.click();
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
    // Reset the input value to allow selecting the same file again
    event.target.value = '';
  };

  return (
    <div className="chat-controls">
      {imagePreviewUrl && (
        <div style={{ position: 'relative', width: '80px', height: '80px', margin: '4px' }}>
          <img src={imagePreviewUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
          <button
            onClick={() => setImagePreviewUrl(null)}
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '20px',
              height: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0',
              lineHeight: '20px',
            }}
          >
            X
          </button>
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
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept="image/*"
            capture="environment"
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
                onClick={handleCameraClick}
                style={{ flexShrink: 0 }}
                disabled={!apiKey}
              >
                Camera
              </button>
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

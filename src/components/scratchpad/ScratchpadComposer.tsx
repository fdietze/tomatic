import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import {
  sendRequested,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { useTextAreaEnterHandler } from '@/hooks/useTextAreaEnterHandler';
import { isMobile as checkIsMobile } from '@/utils/isMobile';

const ScratchpadComposer: React.FC = () => {
  const dispatch = useDispatch();
  const { modelName, apiKey } = useSelector(selectSettings);
  const { submitting } = useSelector(selectScratchpad);
  const [draft, setDraft] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsMobile(checkIsMobile());
  }, []);

  const handleSend = (): void => {
    if (!draft.trim() || submitting) return;
    dispatch(sendRequested({ raw_content: draft, modelName }));
    setDraft('');
  };

  const handleFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    handleSend();
  };

  const handleKeyDown = useTextAreaEnterHandler(isMobile, handleSend);

  return (
    <div className="chat-controls" data-testid="scratchpad-composer">
      <form onSubmit={handleFormSubmit}>
        <div style={{ display: 'flex', padding: '4px', gap: '4px' }}>
          <textarea
            ref={inputRef}
            value={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            placeholder="Add to prompt"
            onKeyDown={handleKeyDown}
            disabled={submitting || !apiKey}
            data-testid="scratchpad-input"
          />
          <button
            type="submit"
            data-role="primary"
            style={{ flexShrink: 0 }}
            disabled={draft.trim().length === 0 || submitting || !apiKey}
            data-testid="scratchpad-send"
          >
            {submitting ? (
              <>
                <span className="spinner" />
                Sending
              </>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ScratchpadComposer;

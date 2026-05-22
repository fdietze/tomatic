import React from 'react';
import Markdown from '@/components/Markdown';
import CopyButton from '@/components/CopyButton';
import { useDispatch, useSelector } from 'react-redux';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import {
  regenerateRequested,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { getErrorMessage } from '@/types/errors';

const ScratchpadResponsePanel: React.FC = () => {
  const dispatch = useDispatch();
  const { response, inputs, submitting } = useSelector(selectScratchpad);
  const { modelName } = useSelector(selectSettings);

  if (!response && !submitting) return null;

  const roleLabel = response?.model_name
    ? `assistant (${response.model_name})`
    : 'assistant';

  return (
    <div
      className="chat-message"
      data-role="assistant"
      data-testid="scratchpad-response"
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="chat-message-role">
          {roleLabel}
          {response?.is_stale && (
            <span
              data-testid="scratchpad-stale-badge"
              style={{
                marginLeft: '8px',
                padding: '0 6px',
                borderRadius: '4px',
                background: 'var(--base09)',
                color: 'var(--base00)',
                fontSize: 'smaller',
              }}
            >
              stale
            </span>
          )}
        </div>
        <div className="chat-message-buttons">
          {response && <CopyButton textToCopy={response.content} />}
          <button
            data-size="compact"
            data-testid="scratchpad-regenerate"
            disabled={inputs.length === 0 || submitting}
            onClick={() => dispatch(regenerateRequested({ modelName }))}
          >
            regenerate
          </button>
        </div>
      </div>
      <div className="chat-message-content">
        {response?.error ? (
          <div className="error-box" data-testid="scratchpad-response-error">
            {getErrorMessage(response.error)}
          </div>
        ) : (
          <Markdown markdownText={response?.content ?? ''} />
        )}
      </div>
    </div>
  );
};

export default ScratchpadResponsePanel;

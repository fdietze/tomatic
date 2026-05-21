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

  return (
    <section data-testid="scratchpad-response">
      <header>
        <span>Response</span>
        {response?.is_stale && (
          <span data-testid="scratchpad-stale-badge">stale</span>
        )}
        <button
          data-testid="scratchpad-regenerate"
          disabled={inputs.length === 0 || submitting}
          onClick={() => dispatch(regenerateRequested({ modelName }))}
        >
          ⟳ regenerate
        </button>
      </header>
      {response?.error ? (
        <div data-testid="scratchpad-response-error">{getErrorMessage(response.error)}</div>
      ) : (
        <>
          <Markdown markdownText={response?.content ?? ''} />
          {response && <CopyButton textToCopy={response.content} />}
        </>
      )}
    </section>
  );
};

export default ScratchpadResponsePanel;

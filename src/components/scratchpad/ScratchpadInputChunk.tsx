import React, { useState } from 'react';
import Markdown from '@/components/Markdown';
import CopyButton from '@/components/CopyButton';
import { useDispatch } from 'react-redux';
import { deleteInput, editInput } from '@/store/features/scratchpad/scratchpadSlice';
import type { ScratchpadInput } from '@/types/scratchpad';

interface Props {
  chunk: ScratchpadInput;
  index: number;
}

const ScratchpadInputChunk: React.FC<Props> = ({ chunk, index }) => {
  const dispatch = useDispatch();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(chunk.raw_content);

  const handleSave = (): void => {
    dispatch(editInput({ inputId: chunk.id, raw_content: draft }));
    setIsEditing(false);
  };

  const handleDiscard = (): void => {
    setDraft(chunk.raw_content);
    setIsEditing(false);
  };

  const textForCopy = isEditing ? draft : chunk.raw_content;

  return (
    <div
      className="chat-message"
      data-role="user"
      data-message-id={chunk.id}
      data-testid={`scratchpad-chunk-${chunk.id}`}
    >
      <div style={{ display: 'flex' }}>
        <div className="chat-message-role">{`input ${String(index + 1)}`}</div>
        <div className="chat-message-buttons">
          <CopyButton textToCopy={textForCopy} />
          {!isEditing && (
            <>
              <button
                data-size="compact"
                data-testid={`scratchpad-chunk-edit-${chunk.id}`}
                onClick={() => setIsEditing(true)}
              >
                edit
              </button>
              <button
                data-size="compact"
                data-role="destructive"
                data-testid={`scratchpad-chunk-delete-${chunk.id}`}
                onClick={() => dispatch(deleteInput(chunk.id))}
              >
                delete
              </button>
            </>
          )}
        </div>
      </div>
      <div className="chat-message-content">
        {isEditing ? (
          <>
            <textarea
              data-testid={`scratchpad-chunk-textarea-${chunk.id}`}
              style={{ width: '100%' }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
              <button data-role="secondary" onClick={handleDiscard}>
                Discard
              </button>
              <button
                data-testid={`scratchpad-chunk-save-${chunk.id}`}
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <Markdown markdownText={chunk.raw_content} />
        )}
      </div>
    </div>
  );
};

export default ScratchpadInputChunk;

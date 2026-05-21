import React, { useState } from 'react';
import Markdown from '@/components/Markdown';
import { useDispatch } from 'react-redux';
import { deleteInput, editInput } from '@/store/features/scratchpad/scratchpadSlice';
import type { ScratchpadInput } from '@/types/scratchpad';

interface Props {
  chunk: ScratchpadInput;
}

const ScratchpadInputChunk: React.FC<Props> = ({ chunk }) => {
  const dispatch = useDispatch();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chunk.raw_content);

  if (editing) {
    return (
      <div className="scratchpad-chunk" data-testid={`scratchpad-chunk-${chunk.id}`}>
        <textarea
          data-testid={`scratchpad-chunk-textarea-${chunk.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          data-testid={`scratchpad-chunk-save-${chunk.id}`}
          onClick={() => {
            dispatch(editInput({ inputId: chunk.id, raw_content: draft }));
            setEditing(false);
          }}
        >
          Save
        </button>
        <button onClick={() => { setDraft(chunk.raw_content); setEditing(false); }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="scratchpad-chunk" data-testid={`scratchpad-chunk-${chunk.id}`}>
      <div onClick={() => setExpanded((v) => !v)} data-testid={`scratchpad-chunk-body-${chunk.id}`}>
        {/* Toggling between plain text and markdown rendering on click */}
        {expanded ? <Markdown markdownText={chunk.raw_content} /> : <pre>{chunk.raw_content}</pre>}
      </div>
      <button data-testid={`scratchpad-chunk-edit-${chunk.id}`} onClick={() => setEditing(true)} aria-label="edit">✎</button>
      <button data-testid={`scratchpad-chunk-delete-${chunk.id}`} onClick={() => dispatch(deleteInput(chunk.id))} aria-label="delete">🗑</button>
    </div>
  );
};

export default ScratchpadInputChunk;

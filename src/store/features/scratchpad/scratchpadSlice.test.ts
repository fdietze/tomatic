import { describe, it, expect } from 'vitest';
import scratchpadReducer, {
  appendInput,
  editInput,
  deleteInput,
  setResolvedContent,
  setSelectedPromptName,
  markResponseStale,
  startGeneration,
  responseChunk,
  responseDone,
  responseFailed,
  loadSessionSuccess,
  startNewSession,
} from './scratchpadSlice';

const init = scratchpadReducer(undefined, { type: '@@INIT' });

describe('scratchpadSlice', () => {
  it('appendInput adds a chunk with empty resolved_content', () => {
    // Purpose: composer submission seeds the chunk; saga fills resolved_content afterwards
    const s = scratchpadReducer(init, appendInput({ raw_content: 'hello' }));
    expect(s.inputs).toHaveLength(1);
    expect(s.inputs[0]!.raw_content).toBe('hello');
    expect(s.inputs[0]!.resolved_content).toBe('');
  });

  it('editInput marks response stale', () => {
    // Purpose: req:scratchpad-staleness — editing a chunk must mark the response stale without regenerating
    const withInput = scratchpadReducer(init, appendInput({ raw_content: 'a' }));
    const withResp = scratchpadReducer(withInput, responseDone({ model_name: 'm' }));
    const id = withResp.inputs[0]!.id;
    const after = scratchpadReducer(withResp, editInput({ inputId: id, raw_content: 'b' }));
    expect(after.inputs[0]!.raw_content).toBe('b');
    expect(after.response?.is_stale).toBe(true);
  });

  it('deleteInput marks response stale', () => {
    // Purpose: req:scratchpad-staleness — deleting a chunk marks response stale
    const a = scratchpadReducer(init, appendInput({ raw_content: 'a' }));
    const b = scratchpadReducer(a, responseDone({ model_name: 'm' }));
    const id = b.inputs[0]!.id;
    const c = scratchpadReducer(b, deleteInput(id));
    expect(c.inputs).toHaveLength(0);
    expect(c.response?.is_stale).toBe(true);
  });

  it('setSelectedPromptName marks response stale when it changes', () => {
    // Purpose: req:scratchpad-staleness — system prompt change must mark response stale
    const a = scratchpadReducer(init, responseDone({ model_name: 'm' }));
    const b = scratchpadReducer(a, setSelectedPromptName('promptA'));
    expect(b.response?.is_stale).toBe(true);
    expect(b.selectedPromptName).toBe('promptA');
  });

  it('responseChunk appends streamed text', () => {
    // Purpose: streaming updates accumulate into response.content
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const b = scratchpadReducer(a, responseChunk({ delta: 'hel' }));
    const c = scratchpadReducer(b, responseChunk({ delta: 'lo' }));
    expect(c.response?.content).toBe('hello');
    expect(c.submitting).toBe(true);
  });

  it('responseDone clears submitting and stale flag', () => {
    // Purpose: completion ends submission and resets stale to false
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const b = scratchpadReducer(a, responseChunk({ delta: 'x' }));
    const c = scratchpadReducer(b, responseDone({ model_name: 'gpt-4' }));
    expect(c.submitting).toBe(false);
    expect(c.response?.is_stale).toBe(false);
    expect(c.response?.model_name).toBe('gpt-4');
  });

  it('responseFailed records error and clears submitting', () => {
    // Purpose: errors land in response.error so the UI can surface them
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const fakeErr = { type: 'UNKNOWN_ERROR', message: 'boom' } as any;
    const c = scratchpadReducer(a, responseFailed({ error: fakeErr }));
    expect(c.submitting).toBe(false);
    expect(c.response?.error).toBeTruthy();
  });

  it('setResolvedContent updates only the targeted chunk', () => {
    // Purpose: saga writes back resolved snippet text per chunk
    const a = scratchpadReducer(init, appendInput({ raw_content: '@x' }));
    const id = a.inputs[0]!.id;
    const b = scratchpadReducer(a, setResolvedContent({ inputId: id, resolved_content: 'X' }));
    expect(b.inputs[0]!.resolved_content).toBe('X');
  });

  it('startNewSession clears the in-memory session', () => {
    // Purpose: navigating to /scratchpad/new resets state
    const a = scratchpadReducer(init, appendInput({ raw_content: 'x' }));
    const b = scratchpadReducer(a, startNewSession());
    expect(b.inputs).toHaveLength(0);
    expect(b.response).toBeNull();
    expect(b.currentSessionId).toBeNull();
  });

  it('loadSessionSuccess populates state and clears submitting', () => {
    // Purpose: navigating to an existing session replaces in-memory state
    const after = scratchpadReducer(init, loadSessionSuccess({
      session: {
        session_id: 's1',
        inputs: [{ id: 'i1', raw_content: 'a', resolved_content: 'a' }],
        response: { content: 'r', model_name: 'm', is_stale: false, error: null },
        created_at_ms: 1, updated_at_ms: 2,
      },
      prevId: null,
      nextId: null,
    }));
    expect(after.currentSessionId).toBe('s1');
    expect(after.inputs).toHaveLength(1);
    expect(after.response?.content).toBe('r');
  });

  it('markResponseStale flips the flag', () => {
    // Purpose: explicit stale dispatch is used when model changes externally
    const a = scratchpadReducer(init, responseDone({ model_name: 'm' }));
    const b = scratchpadReducer(a, markResponseStale());
    expect(b.response?.is_stale).toBe(true);
  });
});

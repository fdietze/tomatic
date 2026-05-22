import { describe, it, expect } from 'vitest';
import { scratchpadSessionSchema } from './scratchpadSchemas';
import { getErrorMessage } from '@/types/errors';

describe('scratchpadSessionSchema', () => {
  it('parses a minimal valid session', () => {
    // Purpose: ensure schema accepts the canonical shape persisted to IndexedDB
    const result = scratchpadSessionSchema.safeParse({
      session_id: 's1',
      inputs: [
        { id: 'i1', raw_content: 'hello', resolved_content: 'hello' },
      ],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a session missing session_id', () => {
    // Purpose: schema must catch malformed persisted data so loadSession returns null
    const result = scratchpadSessionSchema.safeParse({
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(result.success).toBe(false);
  });

  it('defaults include_last_response to false when missing on disk', () => {
    // Purpose: req:scratchpad-include-last-response-persisted — lazy v4 -> v5
    // backfill: old rows without the field load with include_last_response=false.
    const parsed = scratchpadSessionSchema.parse({
      session_id: 's1',
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(parsed.include_last_response).toBe(false);
  });

  it('preserves include_last_response when present on disk', () => {
    // Purpose: req:scratchpad-include-last-response-persisted — explicit true round-trips.
    const parsed = scratchpadSessionSchema.parse({
      session_id: 's1',
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
      include_last_response: true,
    });
    expect(parsed.include_last_response).toBe(true);
  });

  it('parses a stored error string back into AppError', () => {
    // Purpose: response.error round-trips from a stored string into the in-memory AppError shape
    const parsed = scratchpadSessionSchema.parse({
      session_id: 's1',
      inputs: [],
      response: {
        content: '',
        model_name: 'm',
        is_stale: false,
        error: 'boom',
      },
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(parsed.response?.error && getErrorMessage(parsed.response.error)).toContain('boom');
  });
});

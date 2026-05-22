// src/types/scratchpad.ts
import { MessageCost } from './chat';
import { AppError } from './errors';

export interface ScratchpadInput {
  id: string;
  raw_content: string;
  resolved_content: string;
}

export interface ScratchpadResponse {
  content: string;
  model_name: string;
  cost?: MessageCost | null;
  error?: AppError | null;
  is_stale: boolean;
}

export interface ScratchpadSession {
  session_id: string;
  prompt_name?: string | null;
  inputs: ScratchpadInput[];
  response: ScratchpadResponse | null;
  name?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  // req:scratchpad-include-last-response-persisted: per-session opt-in to feed
  // the last assistant response back as an assistant turn on next send/regen.
  include_last_response: boolean;
}

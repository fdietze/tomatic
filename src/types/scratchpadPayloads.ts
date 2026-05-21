// src/types/scratchpadPayloads.ts
import { AppError } from './errors';
import { MessageCost } from './chat';
import { ScratchpadSession } from './scratchpad';

export interface LoadScratchpadSuccessPayload {
  session: ScratchpadSession;
  prevId: string | null;
  nextId: string | null;
}

export interface ScratchpadCreatedPayload {
  session: ScratchpadSession;
  prevId: string | null;
  nextId: string | null;
}

export interface AppendInputPayload {
  raw_content: string;
}

export interface EditInputPayload {
  inputId: string;
  raw_content: string;
}

export interface SetResolvedContentPayload {
  inputId: string;
  resolved_content: string;
}

export interface SendScratchpadRequestPayload {
  raw_content: string;
  modelName: string;
}

export interface RegenerateScratchpadRequestPayload {
  modelName: string;
}

export interface ScratchpadResponseChunkPayload {
  delta: string;
}

export interface ScratchpadResponseDonePayload {
  model_name: string;
  cost?: MessageCost | null;
}

export interface ScratchpadResponseFailedPayload {
  error: AppError;
}

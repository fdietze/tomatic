// This service contains the core logic for making API requests for chat completions.
// It is invoked by sagas, which are responsible for assembling the request payload.

import type { Stream } from "openai/streaming";
import type OpenAI from "openai";
import { Message } from "@/types/chat";
import { requestMessageContentStream } from "@/api/openrouter";

export type ChatRequest = {
  messagesToSubmit: Message[];
  modelName: string;
  apiKey: string;
};

export type StreamChatInput = ChatRequest & {
  /** Aborts the HTTP request, e.g. when the user cancels or leaves the session. */
  signal: AbortSignal;
};

/**
 * Initiates a streaming chat request and returns the raw stream iterator,
 * so the UI can display the assistant's response as it's being generated.
 */
export const streamChat = async ({
  messagesToSubmit,
  modelName,
  apiKey,
  signal,
}: StreamChatInput): Promise<
  Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
> => {
  return requestMessageContentStream(messagesToSubmit, modelName, apiKey, signal);
};

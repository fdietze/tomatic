// This service contains the core logic for making API requests for chat completions.
// It is invoked by sagas, which are responsible for assembling the request payload.

import type { Stream } from "openai/streaming";
import type OpenAI from "openai";
import { Message } from "@/types/chat";
import { requestMessageContentStream } from "@/api/openrouter";

export type StreamChatResponseOutput = {
  finalMessages: Message[];
  assistantResponse: string;
};

export type StreamChatInput = {
  messagesToSubmit: Message[];
  modelName: string;
  apiKey: string;
};

/**
 * Initiates a streaming chat request and returns the raw stream iterator.
 * This is the preferred method for real-time UI updates, allowing the UI
 * to display the assistant's response as it's being generated.
 */
export const streamChat = async ({
  messagesToSubmit,
  modelName,
  apiKey,
}: StreamChatInput): Promise<
  Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
> => {
  return requestMessageContentStream(messagesToSubmit, modelName, apiKey);
};

/**
 * @deprecated This function consumes the entire stream and returns only the final,
 * complete response. It prevents real-time UI updates. Use `streamChat` instead
 * to get the raw stream.
 */
export const streamChatResponse = async ({
  messagesToSubmit,
  modelName,
  apiKey,
}: StreamChatInput): Promise<StreamChatResponseOutput> => {
  const streamCompletion = await streamChat({
    messagesToSubmit,
    modelName,
    apiKey,
  });

  let assistantResponse = "";
  for await (const chunk of streamCompletion) {
    assistantResponse += chunk.choices[0]?.delta?.content || "";
  }

  return {
    finalMessages: messagesToSubmit,
    assistantResponse,
  };
};

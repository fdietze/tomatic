import { all, call, put, select, take, takeLatest } from "redux-saga/effects";
import { END, eventChannel, EventChannel } from "redux-saga";
import { PayloadAction } from "@reduxjs/toolkit";
import OpenAI from "openai";
import type { Stream } from "openai/streaming";

import { ChatSession, Message } from "@/types/chat";
import * as db from "@/services/db/chat-sessions";
import { streamChat, StreamChatInput } from "@/services/chatService";
import { RootState } from "../../store";

import {
  addAssistantMessagePlaceholder,
  appendChunkToLatestMessage,
  loadSession,
  loadSessionFailure,
  loadSessionSuccess,
  submitUserMessage,
  submitUserMessageFailure,
  submitUserMessageSuccess,
} from "./sessionSlice";

// --- Worker Sagas ---

function* loadSessionSaga(action: PayloadAction<string>) {
  try {
    const session: ChatSession | null = yield call(
      db.loadSession,
      action.payload,
    );
    if (session) {
      const { prevId, nextId } = yield call(
        db.findNeighbourSessionIds,
        session,
      );
      yield put(
        loadSessionSuccess({
          messages: session.messages,
          sessionId: session.session_id,
          prevId,
          nextId,
        }),
      );
    } else {
      yield put(loadSessionFailure("Session not found."));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    yield put(loadSessionFailure(message));
  }
}

type ChatStreamEvent = { chunk: string } | { done: true } | { error: Error };

function createChatStreamChannel(
  input: StreamChatInput,
): EventChannel<ChatStreamEvent> {
  return eventChannel((emitter) => {
    const processStream = async () => {
      try {
        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> =
          await streamChat(input);

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            emitter({ chunk: content });
          }
        }
        emitter({ done: true });
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error("Streaming failed");
        emitter({ error: err });
      } finally {
        emitter(END);
      }
    };

    void processStream();

    // Return the unsubscribe function
    return () => {
      // In a real-world scenario with AbortController, you'd call abort() here.
    };
  });
}

function* submitUserMessageSaga(
  action: PayloadAction<{
    prompt: string;
    isRegeneration: boolean;
    editMessageIndex?: number;
  }>,
) {
  try {
    const { isRegeneration } = action.payload;
    // --- 1. Get state and prepare for API call ---
    const { settings, session, prompts }: RootState = yield select(
      (state: RootState) => state,
    );

    if (!settings.apiKey) {
      throw new Error("OpenRouter API key is not set.");
    }

    // Base messages are from the current session state.
    let messagesToSubmit: Message[] = [...session.messages];

    // For regenerations, we need to ensure we're using the LATEST system prompt
    // from the prompts store, not the one that was snapshotted in the message history.
    if (isRegeneration) {
      const systemMessage = messagesToSubmit.find(
        (msg) => msg.role === "system",
      );
      if (systemMessage?.prompt_name && prompts?.prompts) {
        const latestPromptEntity = prompts.prompts[systemMessage.prompt_name];

        if (
          latestPromptEntity &&
          latestPromptEntity.data.prompt !== systemMessage.content
        ) {
          const latestPrompt = latestPromptEntity.data;
          // Replace the stale system message with an updated one.
          messagesToSubmit = messagesToSubmit.map((msg) =>
            msg.id === systemMessage.id
              ? { ...systemMessage, content: latestPrompt.prompt }
              : msg,
          );
        }
      }
    }

    yield put(addAssistantMessagePlaceholder());

    // --- 2. Create the event channel ---
    const channel: EventChannel<ChatStreamEvent> = yield call(
      createChatStreamChannel,
      {
        messagesToSubmit,
        modelName: settings.modelName,
        apiKey: settings.apiKey,
      },
    );

    // --- 3. Process events in a try/finally to ensure channel is closed ---\
    try {
      while (true) {
        const event: ChatStreamEvent = yield take(channel);

        if ("chunk" in event) {
          yield put(appendChunkToLatestMessage({ chunk: event.chunk }));
        } else if ("done" in event) {
          yield put(
            submitUserMessageSuccess({ model: settings.modelName }),
          );
          break; // Exit the loop
        } else if ("error" in event) {
          throw event.error;
        }
      }
    } finally {
      channel.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    yield put(submitUserMessageFailure(message));
  }
}

// --- Watcher Saga ---

export function* sessionSaga() {
  yield all([
    takeLatest(loadSession.type, loadSessionSaga),
    takeLatest(submitUserMessage.type, submitUserMessageSaga),
  ]);
}

import "fake-indexeddb/auto";
import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import rootReducer from "@/store/rootReducer";
import rootSaga from "@/store/rootSaga";
import { streamChat } from "@/services/chatService";
import { submitUserMessage } from "./sessionSlice";
import { type RootState } from "@/store/store";
import type { Message } from "@/types/chat";
import { expectSaga } from "redux-saga-test-plan";
import { select, call } from "redux-saga/effects";

import { goToPrevSession, selectSession, loadSession, loadSessionSuccess } from "./sessionSlice";
import { sessionSaga } from "./sessionSaga";
import { ROUTES } from "@/utils/routes";
import { getNavigationService } from "@/services/NavigationProvider";
import { setSelectedPromptName as setSettingsSelectedPromptName } from "@/store/features/settings/settingsSlice";
import * as db from "@/services/db/chat-sessions";
import type { ChatSession } from "@/types/chat";

// Mock the chat service to avoid real API calls
vi.mock("@/services/chatService", () => ({
  streamChat: vi.fn(),
}));

vi.mock("@/services/NavigationProvider", () => ({
  getNavigationService: vi.fn(),
}));

// Note: We don't mock the entire db module to avoid breaking existing tests

// Mock nanoid to have predictable IDs for snapshot consistency
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-123"),
}));

// Mock the event dispatcher to avoid window is not defined error in Node.js env
vi.mock("@/utils/events", () => ({
  dispatchEvent: vi.fn(),
}));

// Helper function to create a store for each test
const createTestStore = (preloadedState?: Partial<RootState>) => {
  const sagaMiddleware = createSagaMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      // We need to disable the immutable check middleware because it causes performance issues
      // in the test environment when processing saga results.
      getDefaultMiddleware({
        thunk: false,
        immutableCheck: false,
        serializableCheck: false,
      }).concat(sagaMiddleware),
  });
  sagaMiddleware.run(rootSaga);
  return store;
};

// Helper to wait for saga completion by polling the store state
const waitForSagaCompletion = (store: ReturnType<typeof createTestStore>) => {
  return new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      // The saga is complete when the submitting flag is set back to false.
      if (state.session.submitting === false) {
        unsubscribe();
        resolve();
      }
    });
  });
};

describe("sessionSaga", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  test("should handle the full chat flow: user message -> assistant response", async () => {
    // Purpose: This test verifies that the saga correctly handles a successful streaming chat flow,
    // from dispatching the user message to receiving and assembling the complete assistant response.
    const store = createTestStore({
      settings: {
        apiKey: "test-api-key",
        modelName: "test-model",
        autoScrollEnabled: true,
        selectedPromptName: null,
        initialChatPrompt: null,
        loading: "idle",
        saving: "idle",
      },
    });
    const userMessageContent = "Hello, world!";
    const assistantChunks = ["Hello! ", "I am a ", "helpful assistant."];
    const fullAssistantResponse = assistantChunks.join("");

    // Mock the streaming API response as an async generator
    async function* mockStream() {
      for (const chunk of assistantChunks) {
        yield { choices: [{ delta: { content: chunk } }] };
      }
    }
    (streamChat as Mock).mockResolvedValue(mockStream());

    // 2. Dispatch Action
    const responsePromise = waitForSagaCompletion(store);
    store.dispatch(
      submitUserMessage({ prompt: userMessageContent, isRegeneration: false }),
    );

    // 3. Wait for saga to complete
    await responsePromise;

    // 4. Assert Final State
    const finalState = store.getState() as RootState;
    const finalMessages = finalState.session.messages;

    expect(finalMessages).toHaveLength(2);
    expect(finalMessages[0]?.content).toBe(userMessageContent);
    expect(finalMessages[1]?.content).toBe(fullAssistantResponse);
    expect(finalState.session.submitting).toBe(false);
    expect(finalState.session.error).toBeNull();

    // Verify the service was called correctly
    expect(streamChat).toHaveBeenCalledOnce();
    expect(streamChat).toHaveBeenCalledWith({
      messagesToSubmit: [
        expect.objectContaining({
          role: "user",
          content: userMessageContent,
        }),
      ],
      modelName: "test-model",
      apiKey: "test-api-key",
    });
  });

  test("should handle API errors gracefully", async () => {
    // Purpose: This test ensures that if the API call fails, the saga catches the error,
    // updates the state to reflect the error, and cleans up any incomplete messages.
    const store = createTestStore({
      settings: {
        apiKey: "test-api-key",
        modelName: "test-model",
        autoScrollEnabled: true,
        selectedPromptName: null,
        initialChatPrompt: null,
        loading: "idle",
        saving: "idle",
      },
    });
    const userMessageContent = "This will fail.";
    const apiError = new Error("API Failure");

    (streamChat as Mock).mockRejectedValue(apiError);

    const responsePromise = waitForSagaCompletion(store);
    store.dispatch(
      submitUserMessage({ prompt: userMessageContent, isRegeneration: false }),
    );
    await responsePromise;

    const finalState = store.getState() as RootState;
    // The user message should exist, but the assistant placeholder should have been removed.
    expect(finalState.session.messages).toHaveLength(1);
    expect(finalState.session.messages[0]?.content).toBe(userMessageContent);
    expect(finalState.session.submitting).toBe(false);
    expect(finalState.session.error).toEqual({
      type: 'UNKNOWN_ERROR',
      message: apiError.message,
    });
  });

  test("should handle editing a message and resubmitting the chat", async () => {
    // Purpose: This test verifies that editing a user message correctly truncates
    // the chat history and resubmits the conversation from that point.
    const initialMessages: Message[] = [
      { id: "1", role: "user", content: "Initial Message", raw_content: "Initial Message" },
      { id: "2", role: "assistant", content: "Initial Response", raw_content: "Initial Response" },
      { id: "3", role: "user", content: "Second Message", raw_content: "Second Message" },
      { id: "4", role: "assistant", content: "Second Response", raw_content: "Second Response" },
    ];
    const store = createTestStore({
      session: {
        messages: initialMessages,
        currentSessionId: "edit-session",
        prevSessionId: null,
        nextSessionId: null,
        loading: "idle",
        submitting: false,
        error: null,
        hasSessions: false,
        selectedPromptName: null,
      },
      settings: {
        apiKey: "test-api-key",
        modelName: "test-model",
        autoScrollEnabled: true,
        selectedPromptName: null,
        initialChatPrompt: null,
        loading: "idle",
        saving: "idle",
      },
    });

    const editedMessageContent = "Edited Initial Message";
    const newAssistantResponse = "Response to edited message.";

    async function* mockStream() {
      yield { choices: [{ delta: { content: newAssistantResponse } }] };
    }
    (streamChat as Mock).mockResolvedValue(mockStream());

    const responsePromise = waitForSagaCompletion(store);
    store.dispatch(
      submitUserMessage({
        prompt: editedMessageContent,
        isRegeneration: false,
        editMessageIndex: 0, // Edit the first message
      }),
    );
    await responsePromise;

    const finalState = store.getState() as RootState;
    const finalMessages = finalState.session.messages;

    // History should be truncated to the edited message + the new response.
    expect(finalMessages).toHaveLength(2);
    expect(finalMessages[0]?.content).toBe(editedMessageContent);
    expect(finalMessages[1]?.content).toBe(newAssistantResponse);

    // Verify the API was called with the correct truncated history.
    expect(streamChat).toHaveBeenCalledWith({
      messagesToSubmit: [
        expect.objectContaining({
          role: "user",
          content: editedMessageContent,
        }),
      ],
      modelName: "test-model",
      apiKey: "test-api-key",
    });
  });

  test("should navigate to the previous session when goToPrevSession is dispatched", () => {
    // Purpose: This test verifies that the saga retrieves the previous session ID from the state
    // and calls the navigation service to change the URL.
    const mockState = {
      session: {
        prevSessionId: "prev-session-id",
      },
    };

    const mockNavigationService = {
      navigate: vi.fn(),
    };

    (getNavigationService as Mock).mockReturnValue(mockNavigationService);

    return expectSaga(sessionSaga)
      .withState(mockState)
      .provide([
        [select(selectSession), mockState.session],
      ])
      .dispatch(goToPrevSession())
      .call(getNavigationService)
      .call(
        [mockNavigationService, mockNavigationService.navigate],
        ROUTES.chat.session("prev-session-id"),
      )
      .run();
  });

  test("should update selected prompt when loading session with system message", () => {
    // Purpose: This test verifies that when loading a session with a system message containing
    // a prompt_name, the saga updates both session and settings selected prompt name
    // req:system-prompt-navigation-sync
    const mockSession: ChatSession = {
      session_id: "test-session",
      messages: [
        {
          id: "system-msg",
          role: "system",
          content: "You are a helpful assistant.",
          raw_content: "You are a helpful assistant.",
          prompt_name: "assistant",
        },
        {
          id: "user-msg",
          role: "user",
          content: "Hello",
          raw_content: "Hello",
        },
      ],
      name: null,
      created_at_ms: Date.now(),
      updated_at_ms: Date.now(),
    };

    const mockNeighbors = { prevId: null, nextId: "next-session" };

    return expectSaga(sessionSaga)
      .provide([
        [call(db.loadSession, "test-session"), mockSession],
        [call(db.findNeighbourSessionIds, mockSession), mockNeighbors],
      ])
      .dispatch(loadSession("test-session"))
      .put(setSettingsSelectedPromptName("assistant"))
      .put(loadSessionSuccess({
        messages: mockSession.messages,
        sessionId: "test-session",
        prevId: null,
        nextId: "next-session",
        selectedPromptName: "assistant",
      }))
      .run();
  });

  test("should deselect prompt when loading session without system message", () => {
    // Purpose: This test verifies that when loading a session without a system message,
    // the saga deselects the prompt to reflect what is persisted with the session
    const mockSession: ChatSession = {
      session_id: "test-session",
      messages: [
        {
          id: "user-msg",
          role: "user",
          content: "Hello",
          raw_content: "Hello",
        },
      ],
      name: null,
      created_at_ms: Date.now(),
      updated_at_ms: Date.now(),
    };

    const mockNeighbors = { prevId: null, nextId: null };

    return expectSaga(sessionSaga)
      .provide([
        [call(db.loadSession, "test-session"), mockSession],
        [call(db.findNeighbourSessionIds, mockSession), mockNeighbors],
      ])
      .dispatch(loadSession("test-session"))
      .put(setSettingsSelectedPromptName(null))
      .put(loadSessionSuccess({
        messages: mockSession.messages,
        sessionId: "test-session",
        prevId: null,
        nextId: null,
        selectedPromptName: null,
      }))
      .run();
  });

});

import "fake-indexeddb/auto";
import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import rootReducer from "@/store/rootReducer";
import rootSaga from "@/store/rootSaga";
import { streamChat } from "@/services/chatService";
import { sendMessageRequested, editMessageRequested, cancelSubmission } from "./sessionSlice";
import { type RootState } from "@/store/store";
import type { Message } from "@/types/chat";
import { expectSaga } from "redux-saga-test-plan";
import { select, call } from "redux-saga/effects";

import { goToPrevSession, selectSession, loadSession, loadSessionSuccess, setSelectedPromptName } from "./sessionSlice";
import { sessionSaga } from "./sessionSaga";
import { ROUTES } from "@/utils/routes";
import { getNavigationService } from "@/services/NavigationProvider";
import { setSelectedPromptName as setSettingsSelectedPromptName } from "@/store/features/settings/settingsSlice";
import * as db from "@/services/db/chat-sessions";
import type { ChatSession } from "@/types/chat";
import type { Snippet } from "@/types/storage";
import { regenerateSnippetSuccess, regenerateSnippetFailure } from "@/store/features/snippets/snippetsSlice";
import { createAppError, getErrorMessage } from "@/types/errors";

// Mock the chat service to avoid real API calls
vi.mock("@/services/chatService", () => ({
  streamChat: vi.fn(),
}));

vi.mock("@/services/NavigationProvider", () => ({
  getNavigationService: vi.fn(),
}));

// Note: We don't mock the entire db module to avoid breaking existing tests

// Mock crypto.randomUUID to have predictable, distinct IDs for test consistency
let uuidCounter = 0;
const mockUUID = vi.fn(() => `test-id-${++uuidCounter}`);
vi.stubGlobal('crypto', {
  ...crypto,
  randomUUID: mockUUID,
});

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
        chatSnippetResolutionEnabled: false,
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
      sendMessageRequested({ prompt: userMessageContent }),
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
      signal: expect.any(AbortSignal),
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
        chatSnippetResolutionEnabled: false,
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
      sendMessageRequested({ prompt: userMessageContent }),
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
        chatSnippetResolutionEnabled: false,
        selectedPromptName: null,
        initialChatPrompt: null,
        loading: "idle",
        saving: "idle",
      },
    });

    await db.saveSession({ session_id: "edit-session", messages: initialMessages, name: null, created_at_ms: 1, updated_at_ms: 1 });
    const editedMessageContent = "Edited Initial Message";
    const newAssistantResponse = "Response to edited message.";

    async function* mockStream() {
      yield { choices: [{ delta: { content: newAssistantResponse } }] };
    }
    (streamChat as Mock).mockResolvedValue(mockStream());

    const responsePromise = waitForSagaCompletion(store);
    store.dispatch(
      editMessageRequested({ index: 0, newPrompt: editedMessageContent }),
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
      signal: expect.any(AbortSignal),
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
      .put(setSelectedPromptName("assistant"))
      .put(setSettingsSelectedPromptName("assistant"))
      .put(loadSessionSuccess({
        messages: mockSession.messages,
        sessionId: "test-session",
        prevId: null,
        nextId: "next-session",
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
      .put(setSelectedPromptName(null))
      .put(setSettingsSelectedPromptName(null))
      .put(loadSessionSuccess({
        messages: mockSession.messages,
        sessionId: "test-session",
        prevId: null,
        nextId: null,
      }))
      .run();
  });

  describe("Feature: chat snippet resolution setting (req:chat-snippet-resolution-setting)", () => {
    const settingsWith = (chatSnippetResolutionEnabled: boolean): RootState["settings"] => ({
      apiKey: "test-api-key",
      modelName: "test-model",
      autoScrollEnabled: true,
      chatSnippetResolutionEnabled,
      selectedPromptName: null,
      initialChatPrompt: null,
      loading: "idle",
      saving: "idle",
    });
    const snippetA: Snippet = {
      id: "a-id", name: "a", content: "A", isGenerated: false, prompt: "",
      createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false,
    };
    const dirtyGenerated: Snippet = {
      id: "gen-id", name: "gen", content: "old", isGenerated: true, prompt: "p", model: "m",
      createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: true,
    };

    async function* emptyStream() {
      yield { choices: [{ delta: { content: "ok" } }] };
    }

    test("when disabled, the user message is sent exactly as typed", async () => {
      // Purpose: with the setting off, pasted text with @names (even of dirty or missing snippets), `${...}` and backticks
      // is neither resolved nor waited on, and produces no error.
      const store = createTestStore({
        settings: settingsWith(false),
        snippets: { snippets: [snippetA, dirtyGenerated], loading: "idle", error: null, regenerationStatus: {} },
      });
      (streamChat as Mock).mockResolvedValue(emptyStream());
      const prompt = "mail x@a.com, @gen, @missing, ${HOME} `ls` $&";

      const done = waitForSagaCompletion(store);
      store.dispatch(sendMessageRequested({ prompt }));
      await done;

      const state = store.getState() as RootState;
      expect(state.session.error).toBeNull();
      expect(state.session.messages[0]).toEqual(expect.objectContaining({ role: "user", content: prompt, raw_content: prompt }));
      expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({
        messagesToSubmit: [expect.objectContaining({ role: "user", content: prompt })],
      }));
    });

    test("when enabled, @name references in the user message are resolved", async () => {
      // Purpose: with the setting on, snippet references are substituted before sending while raw_content keeps the original.
      const store = createTestStore({
        settings: settingsWith(true),
        snippets: { snippets: [snippetA], loading: "idle", error: null, regenerationStatus: {} },
      });
      (streamChat as Mock).mockResolvedValue(emptyStream());

      const done = waitForSagaCompletion(store);
      store.dispatch(sendMessageRequested({ prompt: "say @a" }));
      await done;

      const state = store.getState() as RootState;
      expect(state.session.messages[0]).toEqual(expect.objectContaining({ content: "say A", raw_content: "say @a" }));
      expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({
        messagesToSubmit: [expect.objectContaining({ role: "user", content: "say A" })],
      }));
    });
  });

  describe("Feature: chat turns are robust (req:submit-turn-atomic, req:stream-bound-to-message, req:turn-cancellation)", () => {
    const settings: RootState["settings"] = {
      apiKey: "test-api-key",
      modelName: "test-model",
      autoScrollEnabled: true,
      chatSnippetResolutionEnabled: true,
      selectedPromptName: null,
      initialChatPrompt: null,
      loading: "idle",
      saving: "idle",
    };
    const sessionState = (sessionId: string, messages: Message[]): RootState["session"] => ({
      messages,
      currentSessionId: sessionId,
      prevSessionId: null,
      nextSessionId: null,
      loading: "idle",
      submitting: false,
      error: null,
      hasSessions: true,
      selectedPromptName: null,
    });
    const storedSession = (session_id: string, messages: Message[]): ChatSession => ({
      session_id, messages, name: "kept name", created_at_ms: 7, updated_at_ms: 7,
    });

    // A stream whose chunks are released manually, so tests can act in the middle of a reply.
    function manualStream() {
      const pending: string[] = [];
      let wake: (() => void) | null = null;
      async function* chunks() {
        while (true) {
          while (pending.length > 0) {
            yield { choices: [{ delta: { content: pending.shift() } }] };
          }
          await new Promise<void>((resolve) => { wake = resolve; });
        }
      }
      return {
        stream: chunks(),
        push: (chunk: string) => { pending.push(chunk); wake?.(); },
      };
    }

    const waitUntil = (store: ReturnType<typeof createTestStore>, predicate: (state: RootState) => boolean) =>
      new Promise<void>((resolve) => {
        if (predicate(store.getState() as RootState)) return resolve();
        const unsubscribe = store.subscribe(() => {
          if (predicate(store.getState() as RootState)) {
            unsubscribe();
            resolve();
          }
        });
      });

    test("switching sessions mid-stream aborts the request and never writes into the other session", async () => {
      // Purpose: regression for chunks being appended to "the last message" of whatever session is loaded,
      // and the finished turn being saved under the newly loaded session's id.
      const otherMessages: Message[] = [{ id: "o1", role: "user", content: "other", raw_content: "other" }];
      await db.saveSession(storedSession("turn-session", []));
      await db.saveSession(storedSession("other-session", otherMessages));
      const store = createTestStore({ settings, session: sessionState("turn-session", []) });
      const { stream, push } = manualStream();
      (streamChat as Mock).mockResolvedValue(stream);

      store.dispatch(sendMessageRequested({ prompt: "hi" }));
      push("partial");
      await waitUntil(store, (state) => state.session.messages[1]?.content === "partial");
      const ended = waitForSagaCompletion(store);
      store.dispatch(loadSession("other-session"));
      await ended;
      await waitUntil(store, (state) => state.session.currentSessionId === "other-session");
      push(" late chunk");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const roleAndContent = (messages: Message[] | undefined) => messages?.map((m) => [m.role, m.content]);
      expect(roleAndContent((store.getState() as RootState).session.messages)).toEqual([["user", "other"]]);
      expect((streamChat as Mock).mock.calls[0]?.[0].signal.aborted).toBe(true);
      const stored = await db.loadSession("turn-session");
      expect(stored?.messages.map((m) => [m.role, m.content])).toEqual([["user", "hi"], ["assistant", "partial"]]);
      expect(stored?.name).toBe("kept name");
      expect(stored?.created_at_ms).toBe(7);
      expect(roleAndContent((await db.loadSession("other-session"))?.messages)).toEqual([["user", "other"]]);
    });

    test("cancelling mid-stream aborts the request and keeps the partial reply", async () => {
      // Purpose: regression for the cancel button only flipping `submitting` while the stream kept writing.
      await db.saveSession(storedSession("cancel-session", []));
      const store = createTestStore({ settings, session: sessionState("cancel-session", []) });
      const { stream, push } = manualStream();
      (streamChat as Mock).mockResolvedValue(stream);

      store.dispatch(sendMessageRequested({ prompt: "hi" }));
      push("partial");
      await waitUntil(store, (state) => state.session.messages[1]?.content === "partial");
      const ended = waitForSagaCompletion(store);
      store.dispatch(cancelSubmission());
      await ended;
      push(" late chunk");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const state = store.getState() as RootState;
      expect(state.session.messages.map((m) => [m.role, m.content])).toEqual([["user", "hi"], ["assistant", "partial"]]);
      expect(state.session.error).toBeNull();
      expect((streamChat as Mock).mock.calls[0]?.[0].signal.aborted).toBe(true);
      expect((await db.loadSession("cancel-session"))?.messages).toHaveLength(2);
    });

    test("a failing edit leaves the whole history untouched", async () => {
      // Purpose: regression for the edit reducer truncating history before resolution, with a rollback
      // that only removed the new message, so a failed edit lost every message after the edited one.
      const history: Message[] = [
        { id: "1", role: "user", content: "first", raw_content: "first" },
        { id: "2", role: "assistant", content: "answer", raw_content: "answer" },
        { id: "3", role: "user", content: "second", raw_content: "second" },
        { id: "4", role: "assistant", content: "answer 2", raw_content: "answer 2" },
      ];
      const store = createTestStore({ settings, session: sessionState("edit-fail-session", history) });

      const done = waitForSagaCompletion(store);
      store.dispatch(editMessageRequested({ index: 0, newPrompt: "use @missing" }));
      await done;

      const state = store.getState() as RootState;
      expect(state.session.messages).toEqual(history);
      expect(state.session.error).toEqual({ type: "UNKNOWN_ERROR", message: "Snippet '@missing' not found." });
      expect(streamChat).not.toHaveBeenCalled();
    });

    test("a dirty snippet in a dependency cycle fails the submit instead of hanging", async () => {
      // Purpose: regression for submit waiting on a window event that the regeneration batch never fired
      // when it found a cycle, which left `submitting` true forever.
      const generated = (name: string, prompt: string): Snippet => ({
        id: `${name}-id`, name, content: "", isGenerated: true, prompt, model: "m",
        createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: true,
      });
      const store = createTestStore({
        settings,
        snippets: { snippets: [generated("a", "@b"), generated("b", "@a")], loading: "idle", error: null, regenerationStatus: {} },
      });

      const done = waitForSagaCompletion(store);
      store.dispatch(sendMessageRequested({ prompt: "use @a" }));
      await done;

      const state = store.getState() as RootState;
      expect(state.session.error?.type).toBe("UNKNOWN_ERROR");
      expect(state.session.error && "message" in state.session.error && state.session.error.message).toMatch(/cycle/);
      expect(state.session.messages).toEqual([]);
      expect(streamChat).not.toHaveBeenCalled();
    });

    describe("Scenario: a referenced snippet is already regenerating in the background", () => {
      const regeneratingB: Snippet = {
        id: "b-id", name: "B", content: "stale", isGenerated: true, prompt: "p", model: "m",
        createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: true,
      };
      const snippetsState: RootState["snippets"] = {
        snippets: [regeneratingB], loading: "idle", error: null,
        regenerationStatus: { "b-id": { status: "in_progress" } },
      };

      test("the turn waits for that generation and sends its result", async () => {
        // Purpose: regression for the turn starting a second, duplicate generation of a snippet that was
        // already in flight, instead of waiting for the running one.
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network call"));
        const store = createTestStore({ settings, snippets: snippetsState });
        (streamChat as Mock).mockResolvedValue((async function* () {
          yield { choices: [{ delta: { content: "ok" } }] };
        })());

        const done = waitForSagaCompletion(store);
        store.dispatch(sendMessageRequested({ prompt: "use @B" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(streamChat).not.toHaveBeenCalled();
        store.dispatch(regenerateSnippetSuccess({ id: "b-id", name: "B", content: "fresh" }));
        await done;

        expect(fetchSpy).not.toHaveBeenCalled();
        const sent = (streamChat as Mock).mock.calls[0]?.[0].messagesToSubmit as Message[];
        expect(sent.map((m) => m.content)).toEqual(["use fresh"]);
        expect((store.getState() as RootState).session.error).toBeNull();
        fetchSpy.mockRestore();
      });

      test("the turn fails with that generation's error", async () => {
        // Purpose: a message must not be sent with stale content when the awaited background generation fails.
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network call"));
        const store = createTestStore({ settings, snippets: snippetsState });

        const done = waitForSagaCompletion(store);
        store.dispatch(sendMessageRequested({ prompt: "use @B" }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        store.dispatch(regenerateSnippetFailure({
          id: "b-id", name: "B", error: createAppError.snippetRegeneration("B", "boom"),
        }));
        await done;

        expect(fetchSpy).not.toHaveBeenCalled();
        const state = store.getState() as RootState;
        expect(state.session.error && getErrorMessage(state.session.error)).toBe(
          getErrorMessage(createAppError.snippetRegeneration("B", "boom")),
        );
        expect(state.session.messages).toEqual([]);
        expect(streamChat).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      });
    });
  });
});

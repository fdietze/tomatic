import "fake-indexeddb/auto";
// Mock external dependencies.
// These MUST be hoisted above all other imports by Vitest.

vi.mock("@/utils/events", () => ({
  dispatchEvent: vi.fn(),
}));

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";

import rootReducer from "@/store/rootReducer";
import rootSaga from "@/store/rootSaga";
import { requestMessageContent } from "@/api/openrouter";
import {
  loadSnippetsSuccess,
  regenerateSnippet,
} from "./snippetsSlice";
import { type RootState } from "@/store/store";
import { type Snippet } from "@/types/storage";

// Helper to create a fully configured store for each test
const createTestStore = (initialState?: Partial<RootState>) => {
  const sagaMiddleware = createSagaMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: initialState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: false,
        immutableCheck: false,
        serializableCheck: false,
      }).concat(sagaMiddleware),
  });
  sagaMiddleware.run(rootSaga);
  return store;
};

describe("snippetsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the fake DB before each test
    const FDBFactory = new IDBFactory();
    FDBFactory.deleteDatabase("tomatic_chat_db");
  });

  test("should regenerate a snippet and update its content", async () => {
    const snippetA: Snippet = {
      id: "snippet-a-id",
      name: "A",
      content: "Initial content",
      isGenerated: true,
      prompt: "A prompt",
      model: "mock-model/a",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false,
    };
    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess([snippetA]));

    (requestMessageContent as Mock).mockResolvedValueOnce("New content");

    store.dispatch(regenerateSnippet(snippetA));

    // Allow the saga to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    const finalState = store.getState();
    const finalSnippet = finalState.snippets.snippets.find(
      (s) => s.name === "A",
    );
    expect(finalSnippet?.content).toBe("New content");
    expect(
      finalState.snippets.regenerationStatus["A"]?.status,
    ).toBe("success");
    expect(requestMessageContent).toHaveBeenCalledTimes(1);
    expect(requestMessageContent).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: "A prompt" }),
      ]),
      "mock-model/a",
      "",
    );
  });
});

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
import { updateSnippetSuccess, loadSnippetsSuccess } from "./snippetsSlice";
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

// Helper to wait for saga completion by polling the store state
const waitForSagaCompletion = (
  store: ReturnType<typeof createTestStore>,
  snippetNames: string[],
) => {
  const initialState = store.getState();
  const initialContents = new Map(
    snippetNames.map((name) => {
      const snippet = initialState.snippets.snippets.find(
        (s) => s.name === name,
      );
      return [name, snippet?.content];
    }),
  );

  return new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      const statuses = snippetNames.map(
        (name) => state.snippets.regenerationStatus[name],
      );
      const contents = snippetNames.map((name) => {
        const snippet = state.snippets.snippets.find((s) => s.name === name);
        return snippet?.content;
      });

      const allDone =
        statuses.every((status) => status === "success" || !status) &&
        contents.every(
          (content, i) => content !== initialContents.get(snippetNames[i]!),
        );

      if (allDone) {
        unsubscribe();
        resolve();
      }
    });
  });
};

describe("snippetsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the fake DB before each test
    const FDBFactory = new IDBFactory();
    FDBFactory.deleteDatabase("tomatic_chat_db");
  });

  test("should transitively regenerate snippets in the correct order", async () => {
    // Purpose: This test verifies the core orchestration logic for snippet regeneration.
    // When a base snippet (A) is updated, it should trigger regeneration for its direct
    // dependent (B), and then transitively for B's dependent (C), using the updated
    // content at each step.

    // 1. Arrange: Define the dependency chain A -> B -> C
    const snippetA_v1: Snippet = {
      name: "A",
      content: "v1",
      isGenerated: false,
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false,
    };
    const snippetB: Snippet = {
      name: "B",
      content: "Content from A_v1",
      isGenerated: true,
      prompt: "Prompt using @A",
      model: "mock-model/b",
      createdAt_ms: 2,
      updatedAt_ms: 2,
      generationError: null,
      isDirty: false,
    };
    const snippetC: Snippet = {
      name: "C",
      content: "Content from B_v1",
      isGenerated: true,
      prompt: "Prompt using @B",
      model: "mock-model/c",
      createdAt_ms: 3,
      updatedAt_ms: 3,
      generationError: null,
      isDirty: false,
    };

    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess([snippetA_v1, snippetB, snippetC]));

    // Define the updated version of snippet A
    const snippetA_v2: Snippet = { ...snippetA_v1, content: "v2" };

    // 2. Mock API calls for the regeneration chain
    const requestMessageContentMock = requestMessageContent as Mock;

    // Mock for B's regeneration (depends on A's new content "v2")
    requestMessageContentMock.mockResolvedValueOnce("Content from A_v2");

    // Mock for C's regeneration (depends on B's new content "Content from A_v2")
    requestMessageContentMock.mockResolvedValueOnce("Content from B_v2");

    // 3. Act: Dispatch the action that signals snippet A has been updated
    const sagaPromise = waitForSagaCompletion(store, ["B", "C"]);
    store.dispatch(
      updateSnippetSuccess({ oldName: "A", snippet: snippetA_v2 }),
    );
    await sagaPromise;

    // 4. Assert
    const finalState = store.getState();

    // Assert API calls
    expect(requestMessageContentMock).toHaveBeenCalledTimes(2);

    // Assert call for snippet B
    expect(requestMessageContentMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: "Prompt using v2" }),
      ]), // Check that A's content was resolved correctly
      "mock-model/b",
      "", // API key from initial settings state
    );

    // Assert call for snippet C
    expect(requestMessageContentMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: "Prompt using Content from A_v2",
        }), // Check that B's NEW content was resolved
      ]),
      "mock-model/c",
      "", // API key from initial settings state
    );

    // Assert final state of snippets
    const finalSnippets = finalState.snippets.snippets;
    const finalSnippetB = finalSnippets.find((s) => s.name === "B");
    const finalSnippetC = finalSnippets.find((s) => s.name === "C");

    expect(finalSnippetB?.content).toBe("Content from A_v2");
    expect(finalSnippetC?.content).toBe("Content from B_v2");
  });
});

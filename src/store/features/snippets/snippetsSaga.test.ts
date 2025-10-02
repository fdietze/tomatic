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
import * as db from "@/services/persistence";

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
      finalState.snippets.regenerationStatus[snippetA.id]?.status,
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

  test("should persist snippet to IndexedDB after successful regeneration", async () => {
    // Purpose: This test would have caught the bug where regenerated snippet content
    // was not persisted to IndexedDB, causing it to disappear on page reload.
    
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

    // Mock the API call
    (requestMessageContent as Mock).mockResolvedValueOnce("New regenerated content");
    
    // Spy on the persistence function
    const saveSnippetSpy = vi.spyOn(db, 'saveSnippet').mockResolvedValueOnce();

    // Trigger regeneration
    store.dispatch(regenerateSnippet(snippetA));

    // Allow the saga to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify the snippet was persisted to IndexedDB with updated content
    expect(saveSnippetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "snippet-a-id",
        name: "A",
        content: "New regenerated content",
        isDirty: false, // Should be false after successful regeneration
      })
    );
    
    saveSnippetSpy.mockRestore();
  });

  describe("importSnippetsSaga", () => {
    test("should add new snippets and update existing ones without deleting others", async () => {
      // Purpose: This test verifies that importing snippets correctly adds new ones,
      // updates snippets with the same name, and does not delete existing snippets
      // that are not part of the import.
      const initialSnippets: Snippet[] = [
        {
          id: "snippet-a-id",
          name: "A",
          content: "Initial content A",
          isGenerated: false,
          prompt: "",
          createdAt_ms: 1,
          updatedAt_ms: 1,
          generationError: null,
          isDirty: false,
        },
        {
          id: "snippet-b-id",
          name: "B",
          content: "Initial content B",
          isGenerated: false,
          prompt: "",
          createdAt_ms: 1,
          updatedAt_ms: 1,
          generationError: null,
          isDirty: false,
        },
      ];

      const snippetsToImport: Snippet[] = [
        {
          id: "new-snippet-b-id", // ID should be ignored and a new one generated for existing snippet
          name: "B", // Existing name, should update
          content: "Updated content B",
          isGenerated: false,
          prompt: "",
          createdAt_ms: 2,
          updatedAt_ms: 2,
          generationError: null,
          isDirty: false,
        },
        {
          id: "snippet-c-id",
          name: "C", // New name, should be added
          content: "New content C",
          isGenerated: false,
          prompt: "",
          createdAt_ms: 2,
          updatedAt_ms: 2,
          generationError: null,
          isDirty: false,
        },
      ];

      const store = createTestStore({
        snippets: {
          snippets: initialSnippets,
          loading: 'idle',
          error: null,
          regenerationStatus: {},
        }
      });

      const saveSnippetSpy = vi.spyOn(db, 'saveSnippet').mockResolvedValue();
      const clearAllSnippetsSpy = vi.spyOn(db, 'clearAllSnippets');
      const loadSnippetsSpy = vi.spyOn(db, 'loadAllSnippets').mockResolvedValueOnce(initialSnippets);

      // Dispatch the import action
      store.dispatch({ type: "snippets/importSnippets", payload: snippetsToImport });

      // Allow the saga to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify that clearAllSnippets was NOT called
      expect(clearAllSnippetsSpy).not.toHaveBeenCalled();

      // Verify that saveSnippet was called for the updated and new snippets
      expect(saveSnippetSpy).toHaveBeenCalledTimes(2);

      // Check the updated snippet (B)
      expect(saveSnippetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "snippet-b-id", // Should keep the original ID
          name: "B",
          content: "Updated content B",
        })
      );

      // Check the new snippet (C)
      expect(saveSnippetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String), // A new ID should be generated
          name: "C",
          content: "New content C",
        })
      );

      // Verify that the reload process was initiated
      expect(loadSnippetsSpy).toHaveBeenCalledTimes(1);

      saveSnippetSpy.mockRestore();
      clearAllSnippetsSpy.mockRestore();
      loadSnippetsSpy.mockRestore();
    });
  });
});

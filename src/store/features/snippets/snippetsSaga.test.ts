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
import { type Message } from "@/types/chat";

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

  test("should regenerate snippets in correct topological order for a diamond dependency", async () => {
    // Purpose: This test ensures that when a batch of dirty snippets with complex
    // inter-dependencies is regenerated, the process respects the topological sort order
    // to prevent using stale data. It reproduces a bug where sorting was done on a
    // subset of snippets, leading to an incomplete dependency graph.

    const snippetA: Snippet = { id: "a", name: "A", content: "new content for A", isGenerated: true, prompt: "A", model: "mock-model/A", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false };
    const snippetB: Snippet = { id: "b", name: "B", content: "initial B", isGenerated: true, prompt: "B needs @A", model: "mock-model/B", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true };
    const snippetC: Snippet = { id: "c", name: "C", content: "initial C", isGenerated: true, prompt: "C needs @A", model: "mock-model/C", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true };
    const snippetD: Snippet = { id: "d", name: "D", content: "initial D", isGenerated: true, prompt: "D needs @B and @C", model: "mock-model/D", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true };

    const allSnippetsInStore = [snippetA, snippetB, snippetC, snippetD];

    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess(allSnippetsInStore));

    const regenerationLog: {name: string, prompt: string}[] = [];
    (requestMessageContent as Mock).mockImplementation((messages: Message[], model: string) => {
      const name = model.split('/')[1];
      if (!name) {
        throw new Error("Test implementation received a model without a name: " + model);
      }
      if (!messages[0]) {
        throw new Error("Test implementation received empty message array");
      }
      const prompt = messages[0].content;
      regenerationLog.push({ name, prompt });
      // This simulates the API generating new content
      return Promise.resolve(`new content for ${name}`);
    });

    // The batch regeneration should be triggered automatically by the resumeDirtySnippetGenerationSaga
    // after the initial load of dirty snippets. We don't need to dispatch it manually.

    // Wait for the entire batch regeneration process to complete
    await new Promise(resolve => {
      window.addEventListener("app:snippet:regeneration:batch:complete", resolve, { once: true });
    });

    const regeneratedNames = regenerationLog.map(l => l.name);
    expect(regeneratedNames).toHaveLength(3);

    const bIndex = regeneratedNames.indexOf("B");
    const cIndex = regeneratedNames.indexOf("C");
    const dIndex = regeneratedNames.indexOf("D");

    expect(bIndex).not.toBe(-1);
    expect(cIndex).not.toBe(-1);
    expect(dIndex).not.toBe(-1);

    // D must be regenerated after B and C have finished
    expect(dIndex).toBeGreaterThan(bIndex);
    expect(dIndex).toBeGreaterThan(cIndex);

    // Crucially, check that D was regenerated with the *new* content of B and C,
    // which proves that it waited for them to complete.
    const dLog = regenerationLog.find(l => l.name === 'D');
    expect(dLog).toBeDefined();
    expect(dLog!.prompt).toContain('new content for B');
    expect(dLog!.prompt).toContain('new content for C');
    expect(dLog!.prompt).not.toContain('initial B');
    expect(dLog!.prompt).not.toContain('initial C');
  });
});

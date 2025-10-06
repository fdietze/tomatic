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
  updateAndRegenerateSnippetRequested,
} from "./snippetsSlice";
import { regenerateSnippetWorkerWithContext } from "./snippetsSaga";
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

  describe("regenerateSnippetWorkerWithContext", () => {
    test("should regenerate a snippet using the provided resolver context", async () => {
      // Purpose: Verify the worker uses the resolver context instead of Redux state
      // This worker will be tested more thoroughly through the orchestrator tests
      // Here we just verify it's exported and has the right signature
      
      const snippetB: Snippet = {
        id: "snippet-b-id",
        name: "B",
        content: "old B content",
        isGenerated: true,
        prompt: "Generate using @A",
        model: "mock-model/b",
        createdAt_ms: 1,
        updatedAt_ms: 1,
        generationError: null,
        isDirty: false,
      };

      const store = createTestStore({
        settings: {
          apiKey: '',
          modelName: 'mock-model/b',
          autoScrollEnabled: true,
          selectedPromptName: null,
          initialChatPrompt: null,
          loading: 'idle' as const,
          saving: 'idle' as const
        }
      });

      // Create a resolver context with fresh content for A
      const resolverContext = new Map([["A", "fresh A content"]]);

      // Mock the API call
      (requestMessageContent as Mock).mockResolvedValueOnce("new B content");

      // Manually step through the generator to test it
      const generator = regenerateSnippetWorkerWithContext(snippetB, resolverContext);
      
      // Step 1: select settings
      let step = generator.next();
      expect(step.value).toBeDefined();
      
      // Step 2: call evaluateTemplate - provide mock return
      step = generator.next(store.getState().settings);
      
      // Step 3: call API - provide the resolved prompt value first
      step = generator.next("Generate using fresh A content");
      
      // Step 4: get the API response
      step = generator.next("new B content");
      
      // Final result
      expect(step.done).toBe(true);
      expect(step.value).toEqual({
        id: "snippet-b-id",
        name: "B",
        content: "new B content",
      });
    });
  });

  test("should regenerate snippets in correct topological order with wave-based approach", async () => {
    // Purpose: This test ensures that the new wave-based orchestrator correctly
    // processes a diamond dependency (A -> B/C -> D) without using stale data.
    
    const snippetA: Snippet = {
      id: "a",
      name: "A",
      content: "fresh A content",
      isGenerated: false,  // Not generated, so it won't be regenerated
      prompt: "",
      model: undefined,
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false
    };
    const snippetB: Snippet = {
      id: "b",
      name: "B",
      content: "stale B",
      isGenerated: true,
      prompt: "B uses @A",
      model: "mock-model/B",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };
    const snippetC: Snippet = {
      id: "c",
      name: "C",
      content: "stale C",
      isGenerated: true,
      prompt: "C uses @A",
      model: "mock-model/C",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };
    const snippetD: Snippet = {
      id: "d",
      name: "D",
      content: "stale D",
      isGenerated: true,
      prompt: "D uses @B and @C",
      model: "mock-model/D",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };

    const allSnippetsInStore = [snippetA, snippetB, snippetC, snippetD];

    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess(allSnippetsInStore));

    const regenerationLog: {name: string, prompt: string}[] = [];
    (requestMessageContent as Mock).mockReset(); // Ensure clean state
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
      return Promise.resolve(`regenerated ${name}`);
    });

    // Wait for batch regeneration to complete
    await new Promise(resolve => {
      window.addEventListener("app:snippet:regeneration:batch:complete", resolve, { once: true });
    });

    // Verify the correct number of regenerations
    expect(regenerationLog).toHaveLength(3);

    const regeneratedNames = regenerationLog.map(l => l.name);
    const bIndex = regeneratedNames.indexOf("B");
    const cIndex = regeneratedNames.indexOf("C");
    const dIndex = regeneratedNames.indexOf("D");

    // All three dirty snippets should be regenerated
    expect(bIndex).not.toBe(-1);
    expect(cIndex).not.toBe(-1);
    expect(dIndex).not.toBe(-1);

    // D must come after both B and C (wave ordering)
    expect(dIndex).toBeGreaterThan(bIndex);
    expect(dIndex).toBeGreaterThan(cIndex);

    // CRITICAL: D's prompt should use the FRESH/REGENERATED content from B and C
    const dLog = regenerationLog.find(l => l.name === 'D');
    expect(dLog).toBeDefined();
    expect(dLog!.prompt).toContain('regenerated B');
    expect(dLog!.prompt).toContain('regenerated C');
    
    // D should NOT use the stale content
    expect(dLog!.prompt).not.toContain('stale B');
    expect(dLog!.prompt).not.toContain('stale C');

    // Verify final Redux state has updated content
    const finalState = store.getState();
    const finalD = finalState.snippets.snippets.find(s => s.name === 'D');
    expect(finalD?.content).toBe('regenerated D');
    expect(finalD?.isDirty).toBe(false);
  });

  test("should use fresh data when A is regenerated in a diamond dependency (A->B->C, A->C)", async () => {
    // Purpose: This test ensures that the new wave-based orchestrator correctly
    // processes a diamond dependency (A -> B/C -> D) without using stale data.
    
    const snippetA: Snippet = {
      id: "a",
      name: "A",
      content: "fresh A content",
      isGenerated: false,  // Not generated, so it won't be regenerated
      prompt: "",
      model: undefined,
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false
    };
    const snippetB: Snippet = {
      id: "b",
      name: "B",
      content: "stale B",
      isGenerated: true,
      prompt: "B uses @A",
      model: "mock-model/B",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };
    const snippetC: Snippet = {
      id: "c",
      name: "C",
      content: "stale C",
      isGenerated: true,
      prompt: "C uses @A",
      model: "mock-model/C",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };
    const snippetD: Snippet = {
      id: "d",
      name: "D",
      content: "stale D",
      isGenerated: true,
      prompt: "D uses @B and @C",
      model: "mock-model/D",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true
    };

    const allSnippetsInStore = [snippetA, snippetB, snippetC, snippetD];

    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess(allSnippetsInStore));

    const regenerationLog: {name: string, prompt: string}[] = [];
    (requestMessageContent as Mock).mockReset(); // Ensure clean state
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
      return Promise.resolve(`regenerated ${name}`);
    });

    // Wait for batch regeneration to complete
    await new Promise(resolve => {
      window.addEventListener("app:snippet:regeneration:batch:complete", resolve, { once: true });
    });

    // Verify the correct number of regenerations
    expect(regenerationLog).toHaveLength(3);

    const regeneratedNames = regenerationLog.map(l => l.name);
    const bIndex = regeneratedNames.indexOf("B");
    const cIndex = regeneratedNames.indexOf("C");
    const dIndex = regeneratedNames.indexOf("D");

    // All three dirty snippets should be regenerated
    expect(bIndex).not.toBe(-1);
    expect(cIndex).not.toBe(-1);
    expect(dIndex).not.toBe(-1);

    // D must come after both B and C (wave ordering)
    expect(dIndex).toBeGreaterThan(bIndex);
    expect(dIndex).toBeGreaterThan(cIndex);

    // CRITICAL: D's prompt should use the FRESH/REGENERATED content from B and C
    const dLog = regenerationLog.find(l => l.name === 'D');
    expect(dLog).toBeDefined();
    expect(dLog!.prompt).toContain('regenerated B');
    expect(dLog!.prompt).toContain('regenerated C');
    
    // D should NOT use the stale content
    expect(dLog!.prompt).not.toContain('stale B');
    expect(dLog!.prompt).not.toContain('stale C');

    // Verify final Redux state has updated content
    const finalState = store.getState();
    const finalD = finalState.snippets.snippets.find(s => s.name === 'D');
    expect(finalD?.content).toBe('regenerated D');
    expect(finalD?.isDirty).toBe(false);
  });

  test("should use fresh data when A is updated via master orchestrator saga", async () => {
    // Purpose: This test verifies the FIX for the stale data bug in a diamond dependency (A → B → C, A → C).
    //
    // The new master orchestrator saga (updateAndRegenerateSaga) ensures correct sequencing:
    // 1. Save A to DB and update Redux state
    // 2. Regenerate A and WAIT for completion
    // 3. Only after A completes, mark B and C as dirty
    // 4. Trigger batch regeneration for B and C (they now use fresh A content)
    //
    // This test should PASS because the orchestrator eliminates the race condition.
    
    const snippetA: Snippet = {
      id: "a",
      name: "A",
      content: "content A v1",  // OLD content
      isGenerated: true,
      prompt: "prompt A v1",   // Will be changed to v2
      model: "mock-model/A",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false
    };
    const snippetB: Snippet = {
      id: "b",
      name: "B",
      content: "content B using A v1",
      isGenerated: true,
      prompt: "B uses @A",
      model: "mock-model/B",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false
    };
    const snippetC: Snippet = {
      id: "c",
      name: "C",
      content: "content C using A v1 and B v1",
      isGenerated: true,
      prompt: "C uses @A and @B",
      model: "mock-model/C",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: false
    };

    const store = createTestStore();
    store.dispatch(loadSnippetsSuccess([snippetA, snippetB, snippetC]));

    const regenerationLog: {name: string, prompt: string}[] = [];
    (requestMessageContent as Mock).mockReset();
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
      return Promise.resolve(`content ${name} v2`);
    });

    // Mock persistence to allow the update to proceed
    vi.spyOn(db, 'saveSnippet').mockResolvedValue();
    vi.spyOn(db, 'updateSnippetProperty').mockResolvedValue();

    // Use the new master orchestrator saga that ensures sequential execution:
    // 1. Save A
    // 2. Regenerate A and WAIT
    // 3. Regenerate dependents with fresh A
    const updatedA = { ...snippetA, prompt: "prompt A v2" };
    
    store.dispatch(updateAndRegenerateSnippetRequested({ snippet: updatedA }));

    // Wait for the batch regeneration to complete
    await new Promise(resolve => {
      window.addEventListener("app:snippet:regeneration:batch:complete", resolve, { once: true });
    });

    // A is regenerated via the orchestrator, B and C via batch orchestrator
    // All three should be in the log
    expect(regenerationLog.length).toBe(3);
    
    // Verify A was regenerated with new prompt
    const aLog = regenerationLog.find(l => l.name === 'A');
    expect(aLog).toBeDefined();
    expect(aLog!.prompt).toBe('prompt A v2');

    // Verify B was regenerated
    const bLog = regenerationLog.find(l => l.name === 'B');
    expect(bLog).toBeDefined();
    
    // FIXED: B now uses A's FRESH content because the orchestrator waits for A to complete
    expect(bLog!.prompt).toBe('B uses content A v2'); // Should PASS with the fix

    // Verify C was regenerated
    const cLog = regenerationLog.find(l => l.name === 'C');
    expect(cLog).toBeDefined();
    
    // FIXED: C now uses FRESH content from both A and B
    expect(cLog!.prompt).toBe('C uses content A v2 and content B v2'); // Should PASS with the fix
  });
  test("should use fresh data when A is regenerated in a diamond dependency (A->B->C, A->C)", async () => {
    // Purpose: Reproduce the stale data bug where A → B → C, A → C.
    // When A needs regeneration, B and C must also regenerate.
    // C depends on BOTH A and B, so it's critical that C uses:
    // - Fresh regenerated content from A (not stale)
    // - Fresh regenerated content from B (not stale)
    // This diamond dependency pattern is where the wave-based approach is essential.
    
    const snippetA: Snippet = {
      id: "a",
      name: "A",
      content: "stale A",
      isGenerated: true,
      prompt: "Generate A",
      model: "mock-model/A",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true  // A needs regeneration
    };
    const snippetB: Snippet = {
      id: "b",
      name: "B",
      content: "stale B",
      isGenerated: true,
      prompt: "B uses @A",
      model: "mock-model/B",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true  // B needs regeneration (depends on A)
    };
    const snippetC: Snippet = {
      id: "c",
      name: "C",
      content: "stale C",
      isGenerated: true,
      prompt: "C uses @A and @B",
      model: "mock-model/C",
      createdAt_ms: 1,
      updatedAt_ms: 1,
      generationError: null,
      isDirty: true  // C needs regeneration (depends on A and B)
    };

    const allSnippetsInStore = [snippetA, snippetB, snippetC];

    const store = createTestStore();
    
    const regenerationLog: {name: string, prompt: string}[] = [];
    (requestMessageContent as Mock).mockReset();
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
      return Promise.resolve(`regenerated ${name}`);
    });

    // Load snippets with all marked as dirty - this triggers resumeDirtySnippetGenerationSaga
    store.dispatch(loadSnippetsSuccess(allSnippetsInStore));

    // Wait for batch regeneration to complete
    await new Promise(resolve => {
      window.addEventListener("app:snippet:regeneration:batch:complete", resolve, { once: true });
    });

    // Verify all three were regenerated
    expect(regenerationLog).toHaveLength(3);
    expect(regenerationLog.some(l => l.name === "A")).toBe(true);
    expect(regenerationLog.some(l => l.name === "B")).toBe(true);
    expect(regenerationLog.some(l => l.name === "C")).toBe(true);

    // Verify regeneration order: A must come before B, and both A and B must come before C
    const aIndex = regenerationLog.findIndex(l => l.name === 'A');
    const bIndex = regenerationLog.findIndex(l => l.name === 'B');
    const cIndex = regenerationLog.findIndex(l => l.name === 'C');
    
    expect(aIndex).toBeLessThan(bIndex); // A before B
    expect(aIndex).toBeLessThan(cIndex); // A before C
    expect(bIndex).toBeLessThan(cIndex); // B before C

    // CRITICAL: B's prompt should use FRESH regenerated content from A
    const bLog = regenerationLog.find(l => l.name === 'B');
    expect(bLog).toBeDefined();
    expect(bLog!.prompt).toContain('regenerated A');
    expect(bLog!.prompt).not.toContain('stale A');

    // CRITICAL: C's prompt should use FRESH regenerated content from BOTH A and B
    const cLog = regenerationLog.find(l => l.name === 'C');
    expect(cLog).toBeDefined();
    expect(cLog!.prompt).toContain('regenerated A');
    expect(cLog!.prompt).toContain('regenerated B');
    
    // C should NOT use any stale content
    expect(cLog!.prompt).not.toContain('stale A');
    expect(cLog!.prompt).not.toContain('stale B');

    // Verify final Redux state
    const finalState = store.getState();
    const finalA = finalState.snippets.snippets.find(s => s.name === 'A');
    const finalB = finalState.snippets.snippets.find(s => s.name === 'B');
    const finalC = finalState.snippets.snippets.find(s => s.name === 'C');
    
    expect(finalA?.content).toBe('regenerated A');
    expect(finalA?.isDirty).toBe(false);
    expect(finalB?.content).toBe('regenerated B');
    expect(finalB?.isDirty).toBe(false);
    expect(finalC?.content).toBe('regenerated C');
    expect(finalC?.isDirty).toBe(false);
  });
});

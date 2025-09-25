import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { initialState } from "./features/settings/settingsSlice";

describe("Redux Store Initialization", () => {
  beforeEach(() => {
    // Reset modules to ensure store.ts is re-evaluated in each test,
    // as it reads from localStorage only once on initial load.
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up mocks after each test
    vi.restoreAllMocks();
  });

  it("should load preloadedState from localStorage if a valid state exists", async () => {
    // Purpose: This test verifies that the store correctly hydrates its state
    // from a valid entry found in localStorage upon initialization.

    // 1. Define a mock state that mimics the structure in localStorage
    const mockPreloadedState = {
      apiKey: "key-from-storage-123",
      modelName: "model-from-storage",
      cachedModels: [],
      input: "",
      selectedPromptName: null,
      autoScrollEnabled: false,
    };

    const mockStorageValue = JSON.stringify({
      version: 1,
      state: mockPreloadedState,
    });

    // 2. Mock localStorage.getItem to return our mock state
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(mockStorageValue);

    // 3. Dynamically import the store module AFTER setting up the mock.
    // This triggers the module's top-level code which reads from localStorage.
    const { store } = await import("./store");

    // 4. Assert that the store's initial state matches our mock data
    const currentState = store.getState();
    expect(currentState.settings.apiKey).toBe("key-from-storage-123");
    expect(currentState.settings.modelName).toBe("model-from-storage");
  });

  it("should initialize with default state if localStorage is empty", async () => {
    // Purpose: This test ensures that if no state is found in localStorage,
    // the store initializes safely with the default state defined in the reducers.

    // 1. Mock localStorage.getItem to return null, simulating an empty storage
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);

    // 2. Dynamically import the store module
    const { store } = await import("./store");

    // 3. Assert that the store has the default initial state
    const currentState = store.getState();
    expect(currentState.settings).toEqual(initialState);
    expect(currentState.settings.apiKey).toBe(""); // Explicitly check the default
  });

  it("should initialize with default state if localStorage contains corrupt data", async () => {
    // Purpose: This test ensures that if the data in localStorage is malformed,
    // the application doesn't crash and falls back gracefully to the default state.

    // 1. Mock localStorage to return invalid JSON and spy on console.log (changed from console.error)
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("this-is-not-json");
    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {
        // suppress console log
      });

    // 2. Dynamically import the store module
    const { store } = await import("./store");

    // 3. Assert that an error was logged and the store has the default state
    expect(consoleLogSpy).toHaveBeenCalled();
    const currentState = store.getState();
    expect(currentState.settings).toEqual(initialState);
  });
});

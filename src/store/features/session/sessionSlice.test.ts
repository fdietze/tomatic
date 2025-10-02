import { describe, test, expect } from "vitest";
import { sessionSlice, removeSystemPrompt } from "./sessionSlice";
import type { SessionState } from "./sessionSlice";

describe("sessionSlice", () => {
  test("should remove system prompt from messages when removeSystemPrompt is dispatched", () => {
    // Purpose: This test verifies that the removeSystemPrompt action correctly
    // removes the system message from the messages array and sets selectedPromptName to null
    // req:system-prompt-interactive-update
    const initialState: SessionState = {
      messages: [
        {
          id: "system-1",
          role: "system",
          content: "You are a helpful assistant.",
          raw_content: "You are a helpful assistant.",
          prompt_name: "assistant",
        },
        {
          id: "user-1",
          role: "user",
          content: "Hello",
          raw_content: "Hello",
        },
      ],
      currentSessionId: "test-session",
      prevSessionId: null,
      nextSessionId: null,
      hasSessions: true,
      loading: "idle",
      submitting: false,
      error: null,
      selectedPromptName: "assistant",
    };

    const newState = sessionSlice.reducer(initialState, removeSystemPrompt());

    expect(newState.selectedPromptName).toBeNull();
    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0]?.role).toBe("user");
    expect(newState.messages[0]?.content).toBe("Hello");
  });

  test("should handle removeSystemPrompt when no system message exists", () => {
    // Purpose: This test verifies that removeSystemPrompt handles gracefully
    // when there is no system message to remove
    const initialState: SessionState = {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Hello",
          raw_content: "Hello",
        },
      ],
      currentSessionId: "test-session",
      prevSessionId: null,
      nextSessionId: null,
      hasSessions: true,
      loading: "idle",
      submitting: false,
      error: null,
      selectedPromptName: "assistant",
    };

    const newState = sessionSlice.reducer(initialState, removeSystemPrompt());

    expect(newState.selectedPromptName).toBeNull();
    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0]?.role).toBe("user");
  });
});
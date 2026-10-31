import { describe, test, expect } from "vitest";
import rootReducer from "@/store/rootReducer";
import type { RootState } from "@/store/store";
import type { Message } from "@/types/chat";
import { selectChatSystemPromptName } from "./selectChatSystemPromptName";

const baseState = (): RootState => rootReducer(undefined, { type: "@@init" }) as RootState;

const withChat = (currentSessionId: string | null, messages: Message[], defaultPromptName: string | null): RootState => {
  const state = baseState();
  return {
    ...state,
    session: { ...state.session, currentSessionId, messages },
    settings: { ...state.settings, selectedPromptName: defaultPromptName },
  };
};

const systemMessage = (prompt_name: string): Message => ({
  id: "s", role: "system", content: "resolved", raw_content: "raw", prompt_name,
});
const userMessage: Message = { id: "u", role: "user", content: "hi", raw_content: "hi" };

describe("selectChatSystemPromptName (req:system-prompt-single-source)", () => {
  test("a new chat uses the default prompt for new chats", () => {
    // Purpose: a chat that is not stored yet has no history of its own, so the default applies.
    expect(selectChatSystemPromptName(withChat(null, [], "Chef"))).toBe("Chef");
  });

  test("a stored chat uses the prompt of its system message, not the default", () => {
    // Purpose: the stored conversation is the truth for its own prompt, whatever the default is.
    expect(selectChatSystemPromptName(withChat("s1", [systemMessage("Pirate"), userMessage], "Chef"))).toBe("Pirate");
  });

  test("a stored chat without a system message has no prompt, even if a default is set", () => {
    // Purpose: the default for new chats must never leak into an existing chat.
    expect(selectChatSystemPromptName(withChat("s1", [userMessage], "Chef"))).toBeNull();
  });
});

import { describe, test, expect } from "vitest";
import type { Message } from "@/types/chat";
import { messagesBeforeReply, requestMessages, resolveUserMessages } from "./conversationTurn";

const message = (id: string, role: Message["role"], content: string): Message => ({ id, role, content, raw_content: content });

describe("Feature: conversation of a chat turn", () => {
  const system = message("s", "system", "be brief");
  const history = [system, message("u1", "user", "q1"), message("a1", "assistant", "r1"), message("u2", "user", "q2"), message("a2", "assistant", "r2")];
  const edited = message("u-new", "user", "edited");

  test("send appends the user message to the whole conversation", () => {
    // Purpose: a new message continues the existing conversation.
    expect(messagesBeforeReply(history, { kind: "send", userMessage: edited })).toEqual([...history, edited]);
  });

  test("edit forks at the edited user message (req:message-edit-fork)", () => {
    // Purpose: everything from the edited message on is replaced by the edited message.
    expect(messagesBeforeReply(history, { kind: "edit", index: 3, userMessage: edited })).toEqual([...history.slice(0, 3), edited]);
  });

  test("regenerate keeps everything before the regenerated reply (req:regenerate-context)", () => {
    // Purpose: the regenerated reply and all later messages are dropped.
    expect(messagesBeforeReply(history, { kind: "regenerate", index: 2 })).toEqual(history.slice(0, 2));
  });

  test("an index that does not address a message of the expected role is rejected", () => {
    // Purpose: a stale or invalid command fails before anything is committed.
    expect(() => messagesBeforeReply(history, { kind: "edit", index: 2, userMessage: edited })).toThrow("Expected a message with role 'user' at position 2.");
    expect(() => messagesBeforeReply(history, { kind: "regenerate", index: 9 })).toThrow("Expected a message with role 'assistant' at position 9.");
  });

  test("the request uses the freshly resolved system prompt instead of the stored one", () => {
    // Purpose: system prompt edits apply to existing sessions; without a selected prompt none is sent.
    const fresh = message("s-fresh", "system", "be verbose");
    expect(requestMessages(history, fresh)).toEqual([fresh, ...history.slice(1)]);
    expect(requestMessages(history, null)).toEqual(history.slice(1));
  });

  test("user messages are re-resolved from their raw text", () => {
    // Purpose: regeneration picks up changed snippet content; other roles are left alone.
    const raw: Message = { id: "u", role: "user", content: "old A", raw_content: "@a" };
    expect(resolveUserMessages([raw, history[2]!], (text) => text.replace("@a", "new A"))).toEqual([
      { ...raw, content: "new A" },
      history[2],
    ]);
  });
});

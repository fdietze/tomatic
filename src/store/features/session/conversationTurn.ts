import { Message } from "@/types/chat";

/**
 * One request for an assistant reply, as issued by the chat UI.
 * Indices address `session.messages` at the time the command was dispatched.
 */
export type TurnCommand =
  | { kind: "send"; prompt: string }
  | { kind: "edit"; index: number; prompt: string }
  | { kind: "regenerate"; index: number };

/**
 * A turn whose user text is final (snippet references already resolved).
 * Functional Core: everything below is pure, sessionSaga's submit flow is the imperative shell.
 */
export type PreparedTurn =
  | { kind: "send"; userMessage: Message }
  | { kind: "edit"; index: number; userMessage: Message }
  | { kind: "regenerate"; index: number };

// req:message-edit-fork, req:regenerate-context
/**
 * The session messages that precede the assistant reply of this turn.
 * - send: the whole conversation plus the new user message
 * - edit: forks at the edited user message, which is replaced
 * - regenerate: everything before the regenerated assistant message
 * Throws if the index does not address a message of the expected role (stale or invalid command).
 */
export function messagesBeforeReply(messages: readonly Message[], turn: PreparedTurn): Message[] {
  switch (turn.kind) {
    case "send":
      return [...messages, turn.userMessage];
    case "edit":
      assertRoleAt(messages, turn.index, "user");
      return [...messages.slice(0, turn.index), turn.userMessage];
    case "regenerate":
      assertRoleAt(messages, turn.index, "assistant");
      return messages.slice(0, turn.index);
    default: {
      const exhaustive: never = turn;
      return exhaustive;
    }
  }
}

/**
 * The messages sent to the model: the freshly resolved system prompt (if one is selected)
 * replaces any stored system message, so prompt edits apply to existing sessions.
 */
export function requestMessages(history: readonly Message[], systemMessage: Message | null): Message[] {
  const conversation = history.filter((message) => message.role !== "system");
  return systemMessage ? [systemMessage, ...conversation] : conversation;
}

/** Re-resolves every user message from its raw text, e.g. to pick up changed snippet content on regeneration. */
export function resolveUserMessages(history: readonly Message[], resolve: (text: string) => string): Message[] {
  return history.map((message) =>
    message.role === "user" ? { ...message, content: resolve(message.raw_content || message.content) } : message,
  );
}

function assertRoleAt(messages: readonly Message[], index: number, role: Message["role"]): void {
  if (messages[index]?.role !== role) {
    throw new Error(`Expected a message with role '${role}' at position ${index}.`);
  }
}

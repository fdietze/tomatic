import { RootState } from "@/store/store";

/**
 * The name of the system prompt selected for the chat on screen.
 * req:system-prompt-single-source: derived, never stored separately, so it cannot drift:
 * - a new chat (not stored yet) uses the default for new chats, `settings.selectedPromptName`
 * - a stored chat uses the `prompt_name` of its system message
 */
export function selectChatSystemPromptName(state: RootState): string | null {
  if (state.session.currentSessionId === null) {
    return state.settings.selectedPromptName;
  }
  const systemMessage = state.session.messages.find((message) => message.role === "system");
  return systemMessage?.prompt_name ?? null;
}

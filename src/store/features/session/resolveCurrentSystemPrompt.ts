import { select } from "redux-saga/effects";
import { SagaIterator } from "redux-saga";
import { Message } from "@/types/chat";
import { Snippet, SystemPrompt } from "@/types/storage";
import { RootState } from "@/store/store";
import { resolveSnippetReferences } from "@/utils/snippetUtils";
import { selectChatSystemPromptName } from "./selectChatSystemPromptName";

/** The chat's selected system prompt as a message, with snippet references resolved against the current snippets. */
export function* resolveCurrentSystemPrompt(): SagaIterator<Message | null> {
  const state: RootState = yield select((s: RootState) => s);
  const promptName = selectChatSystemPromptName(state);
  if (!promptName) {
    return null;
  }
  const promptEntity = state.prompts.prompts[promptName];
  if (!promptEntity) {
    return null;
  }
  return systemMessageFor(promptEntity.data, state.snippets.snippets);
}

/** A system message for `prompt`; throws if a snippet reference cannot be resolved. */
function systemMessageFor(prompt: SystemPrompt, snippets: Snippet[]): Message {
  return {
    id: `system-${prompt.name}`,
    role: "system",
    content: resolveSnippetReferences(prompt.prompt, snippets), // For API calls
    raw_content: prompt.prompt, // For UI display
    prompt_name: prompt.name,
  };
}

import { call, select } from "redux-saga/effects";
import { SagaIterator } from "redux-saga";
import { Message } from "@/types/chat";
import { RootState } from "@/store/store";
import { resolveSnippetReferences } from "@/utils/snippetUtils";

/** The selected system prompt as a message, with snippet references resolved against the current snippets. */
export function* resolveCurrentSystemPrompt(): SagaIterator<Message | null> {
  const { session, prompts, snippets }: RootState = yield select(
    (state: RootState) => state,
  );

  const selectedPromptName = session.selectedPromptName;
  if (!selectedPromptName) {
    return null;
  }

  const promptEntity = prompts.prompts[selectedPromptName];
  if (!promptEntity) {
    return null;
  }

  const systemPrompt = promptEntity.data;
  const resolvedPrompt: string = yield call(resolveSnippetReferences, systemPrompt.prompt, snippets.snippets);

  return {
    id: `system-${selectedPromptName}`,
    role: "system" as const,
    content: resolvedPrompt, // For API calls
    raw_content: systemPrompt.prompt, // For UI display
    prompt_name: selectedPromptName,
  };
}

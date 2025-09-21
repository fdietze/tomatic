import { call, put, takeLatest, all, select } from "redux-saga/effects";
import { PayloadAction } from "@reduxjs/toolkit";
import { Snippet } from "@/types/storage";
import * as db from "@/services/persistence";
import {
  loadSnippets,
  loadSnippetsSuccess,
  loadSnippetsFailure,
  addSnippet,
  addSnippetSuccess,
  updateSnippet,
  updateSnippetSuccess,
  deleteSnippet,
  deleteSnippetSuccess,
  setRegenerationStatus,
  updateSnippetContent,
} from "./snippetsSlice";
import { RootState } from "../../store";
import {
  buildReverseDependencyGraph,
  findTransitiveDependents,
  resolveSnippets,
  topologicalSort,
} from "@/utils/snippetUtils";
import { requestMessageContent } from "@/api/openrouter";

function* loadSnippetsSaga() {
  try {
    const snippets: Snippet[] = yield call(db.loadAllSnippets);
    yield put(loadSnippetsSuccess(snippets));
  } catch {
    yield put(loadSnippetsFailure("Failed to load snippets."));
  }
}

function* addSnippetSaga(action: PayloadAction<Snippet>) {
  try {
    yield call(db.saveSnippet, action.payload);
    yield put(addSnippetSuccess(action.payload));
  } catch (error) {
    console.error("Failed to add snippet", error);
  }
}

function* updateSnippetSaga(
  action: PayloadAction<{ oldName: string; snippet: Snippet }>,
) {
  try {
    const { oldName, snippet } = action.payload;
    if (oldName !== snippet.name) {
      yield call(db.deleteSnippet, oldName);
    }
    yield call(db.saveSnippet, snippet);
    yield put(updateSnippetSuccess({ oldName, snippet }));
  } catch (error) {
    console.error("Failed to update snippet", error);
  }
}

function* deleteSnippetSaga(action: PayloadAction<string>) {
  try {
    yield call(db.deleteSnippet, action.payload);
    yield put(deleteSnippetSuccess(action.payload));
  } catch (error) {
    console.error("Failed to delete snippet", error);
  }
}

function* regenerateSnippetSaga(snippetName: string) {
  try {
    yield put(
      setRegenerationStatus({ name: snippetName, status: "in_progress" }),
    );
    window.dispatchEvent(
      new CustomEvent("app:snippet:regeneration:start", {
        detail: { name: snippetName },
      }),
    );

    const {
      snippets,
      settings,
    }: {
      snippets: Snippet[];
      settings: RootState["settings"];
    } = yield select((state: RootState) => ({
      snippets: state.snippets.snippets,
      settings: state.settings,
    }));

    const snippetToRegenerate = snippets.find((s) => s.name === snippetName);

    if (
      !snippetToRegenerate ||
      !snippetToRegenerate.isGenerated ||
      !snippetToRegenerate.prompt ||
      !snippetToRegenerate.model
    ) {
      throw new Error("Invalid snippet for regeneration");
    }

    const resolvedPrompt = resolveSnippets(
      snippetToRegenerate.prompt,
      snippets,
    );

    const assistantResponse: string = yield call(() =>
      requestMessageContent(
        [{ id: crypto.randomUUID(), role: "user", content: resolvedPrompt }],
        snippetToRegenerate.model!,
        settings.apiKey,
      ),
    );

    yield put(
      updateSnippetContent({ name: snippetName, content: assistantResponse }),
    );
    yield put(setRegenerationStatus({ name: snippetName, status: "success" }));
    window.dispatchEvent(
      new CustomEvent("app:snippet:regeneration:complete", {
        detail: { name: snippetName },
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    window.dispatchEvent(
      new CustomEvent("app:snippet:regeneration:error", {
        detail: { name: snippetName, error: errorMessage },
      }),
    );
    yield put(setRegenerationStatus({ name: snippetName, status: "error" }));
    console.error(`Failed to regenerate snippet ${snippetName}`, error);
  }
}

function* regenerationOrchestrationSaga(
  action: PayloadAction<{ oldName: string; snippet: Snippet }>,
) {
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );
  const reverseGraph = buildReverseDependencyGraph(allSnippets);
  const dependentNames = findTransitiveDependents(
    action.payload.snippet.name,
    reverseGraph,
  );

  if (dependentNames.size === 0) {
    return;
  }

  const dependentSnippets = allSnippets.filter((s) =>
    dependentNames.has(s.name),
  );
  const { sorted: sortedDependents, cyclic } =
    topologicalSort(dependentSnippets);

  if (cyclic.length > 0) {
    // TODO: Dispatch an error to the UI to inform the user about the cycle
    console.error("Cyclic dependency detected in snippets:", cyclic);
  }

  try {
    // Use a simple for...of loop for sequential execution with `call`
    for (const dependentSnippet of sortedDependents) {
      if (dependentSnippet.isGenerated) {
        yield call(regenerateSnippetSaga, dependentSnippet.name);
      }
    }
  } finally {
    window.dispatchEvent(
      new CustomEvent("app:snippet:regeneration:batch:complete"),
    );
  }
}

export function* snippetsSaga() {
  yield all([
    takeLatest(loadSnippets.type, loadSnippetsSaga),
    takeLatest(addSnippet.type, addSnippetSaga),
    takeLatest(updateSnippet.type, updateSnippetSaga),
    takeLatest(deleteSnippet.type, deleteSnippetSaga),
    takeLatest(updateSnippetSuccess.type, regenerationOrchestrationSaga),
  ]);
}

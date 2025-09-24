import { call, put, takeLatest, all, select, takeEvery } from "redux-saga/effects";
import { PayloadAction } from "@reduxjs/toolkit";
import { Snippet } from "@/types/storage";
import * as db from "@/services/persistence";
import {
  loadSnippets,
  loadSnippetsSuccess,
  loadSnippetsFailure,
  addSnippet,
  addSnippetSuccess,
  addSnippetFailure,
  updateSnippet,
  updateSnippetSuccess,
  updateSnippetFailure,
  deleteSnippet,
  deleteSnippetSuccess,
  regenerateSnippet,
  regenerateSnippetSuccess,
  regenerateSnippetFailure,
  setSnippetDirtyState,
  batchRegenerateRequest,
  awaitableRegenerateRequest,
} from "./snippetsSlice";
import { RootState } from "../../store";
import {
  buildReverseDependencyGraph,
  findTransitiveDependents,
  groupSnippetsIntoBatches,
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
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    yield put(addSnippetFailure({ name: action.payload.name, error: message }));
    console.error("Failed to add snippet", error);
  }
}

function* updateSnippetSaga(
  action: PayloadAction<Snippet>,
) {
  try {
    const updatedSnippet = action.payload;
    const oldSnippet: Snippet | undefined = yield select(
      (state: RootState) => state.snippets.snippets.find(s => s.id === updatedSnippet.id)
    );

    if (!oldSnippet) {
      throw new Error(`Snippet with id ${updatedSnippet.id} not found in state.`);
    }
    
    yield call(db.saveSnippet, updatedSnippet);
    yield put(updateSnippetSuccess({ oldName: oldSnippet.name, snippet: updatedSnippet }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    yield put(updateSnippetFailure({ id: action.payload.id, error: message }));
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

function* handleRegenerateSnippetSaga(
  action: PayloadAction<Snippet>,
) {
  const snippetToRegenerate = action.payload;
  const snippetName = snippetToRegenerate.name;
  try {
    const {
      settings,
    }: {
      settings: RootState["settings"];
    } = yield select((state: RootState) => ({
      settings: state.settings,
    }));

    if (
      !snippetToRegenerate ||
      !snippetToRegenerate.isGenerated ||
      typeof snippetToRegenerate.prompt !== "string" ||
      !snippetToRegenerate.model
    ) {
      const error = "Invalid snippet for regeneration.";
      yield put(
        regenerateSnippetFailure({
          name: snippetName,
          error,
        }),
      );
      return;
    }
    
    const allSnippets: Snippet[] = yield select(
      (state: RootState) => state.snippets.snippets,
    );
    const resolvedPrompt = resolveSnippets(
      snippetToRegenerate.prompt,
      allSnippets,
    );

    // If the prompt is empty, we don't need to do anything else.
    if (resolvedPrompt.trim() === "") {
      yield put(regenerateSnippetSuccess({ name: snippetName, content: "" }));
      window.dispatchEvent(
        new CustomEvent("app:snippet:regeneration:complete", {
          detail: { name: snippetName },
        }),
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent("app:snippet:regeneration:start", {
        detail: { name: snippetName },
      }),
    );

    const assistantResponse: string = yield call(() =>
      requestMessageContent(
        [{ id: crypto.randomUUID(), role: "user", content: resolvedPrompt }],
        snippetToRegenerate.model!,
        settings.apiKey,
      ),
    );

    yield put(
      regenerateSnippetSuccess({ name: snippetName, content: assistantResponse }),
    );
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
    yield put(regenerateSnippetFailure({ name: snippetName, error: errorMessage }));
    console.error(`Failed to regenerate snippet ${snippetName}`, error);
  }
}

function* markDependentsDirtySaga(
  action: PayloadAction<{ oldName: string; snippet: Snippet } | Snippet>,
) {
  console.log("[DEBUG] markDependentsDirtySaga: triggered", action.payload);
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );
  const reverseGraph = buildReverseDependencyGraph(allSnippets);
  const changedSnippetName =
    "oldName" in action.payload
      ? action.payload.oldName
      : action.payload.name;

  const dependentNames = findTransitiveDependents(
    changedSnippetName,
    reverseGraph,
  );
  console.log(`[DEBUG] markDependentsDirtySaga: found dependents for ${changedSnippetName}:`, Array.from(dependentNames));

  if (dependentNames.size === 0) {
    return;
  }

  const dependentsToUpdate: Snippet[] = [];
  for (const name of dependentNames) {
    const dependentSnippet = allSnippets.find((s) => s.name === name);
    if (dependentSnippet && dependentSnippet.isGenerated) {
      dependentsToUpdate.push(dependentSnippet);
      yield put(setSnippetDirtyState({ name, isDirty: true }));
      yield call([db, db.updateSnippetProperty], name, { isDirty: true });
    }
  }

  if (dependentsToUpdate.length > 0) {
    yield put(batchRegenerateRequest({ snippets: dependentsToUpdate }));
  }
}

function* resumeDirtySnippetGenerationSaga() {
  console.log("[DEBUG] resumeDirtySnippetGenerationSaga: triggered");
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );
  const dirtySnippets = allSnippets.filter((s) => s.isDirty);
  if (dirtySnippets.length > 0) {
    console.log("[DEBUG] resumeDirtySnippetGenerationSaga: found dirty snippets", dirtySnippets.map(s => s.name));
    yield put(batchRegenerateRequest({ snippets: dirtySnippets }));
  }
}

function* batchRegenerationOrchestratorSaga(
  action: PayloadAction<{ snippets: Snippet[] }>,
) {
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: triggered with snippets", action.payload.snippets.map(s => s.name));
  const { snippets } = action.payload;
  /*const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );*/

  const { sorted, cyclic } = topologicalSort(snippets);

  if (cyclic.length > 0) {
    console.error("Cyclic dependency detected in snippets:", cyclic);
    return;
  }

  const batches = groupSnippetsIntoBatches(sorted);
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: created batches", batches.map(b => b.map(s => s.name)));

  for (const batch of batches) {
    try {
      yield all(
        batch.map((snippet: Snippet) =>
          call(handleRegenerateSnippetSaga, {
            payload: snippet,
            type: "handleRegenerateSnippetSaga",
          }),
        ),
      );
    } catch (error) {
      console.error("Batch regeneration failed.", error);
      break;
    }
  }
  window.dispatchEvent(new CustomEvent("app:snippet:regeneration:batch:complete"));
}

function* handleAwaitableRegeneration(
  action: PayloadAction<{ name: string }>,
) {
  const snippetName = action.payload.name;
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );
  const snippet = allSnippets.find((s) => s.name === snippetName);

  if (snippet) {
    yield call(handleRegenerateSnippetSaga, {
      payload: snippet,
      type: "handleRegenerateSnippetSaga",
    });
  }
}

export function* snippetsSaga() {
  yield all([
    takeLatest(loadSnippets.type, loadSnippetsSaga),
    takeLatest(addSnippet.type, addSnippetSaga),
    takeLatest(updateSnippet.type, updateSnippetSaga),
    takeLatest(deleteSnippet.type, deleteSnippetSaga),
    takeLatest(
      [updateSnippetSuccess.type, addSnippetSuccess.type],
      markDependentsDirtySaga,
    ),
    takeLatest(loadSnippetsSuccess.type, resumeDirtySnippetGenerationSaga),
    takeEvery(batchRegenerateRequest.type, batchRegenerationOrchestratorSaga),
    takeEvery(regenerateSnippet.type, handleRegenerateSnippetSaga),
    takeEvery(awaitableRegenerateRequest.type, handleAwaitableRegeneration),
  ]);
}

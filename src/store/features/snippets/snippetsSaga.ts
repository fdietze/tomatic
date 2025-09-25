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
  console.log("[DEBUG] loadSnippetsSaga: starting to load snippets");
  try {
    const snippets: Snippet[] = yield call(db.loadAllSnippets);
    console.log("[DEBUG] loadSnippetsSaga: loaded snippets from DB:", snippets.map(s => ({name: s.name, content: s.content})));
    yield put(loadSnippetsSuccess(snippets));
    console.log("[DEBUG] loadSnippetsSaga: dispatched loadSnippetsSuccess");
  } catch (error) {
    console.log("[DEBUG] loadSnippetsSaga: failed to load snippets:", error);
    yield put(loadSnippetsFailure("Failed to load snippets."));
  }
}

function* addSnippetSaga(action: PayloadAction<Snippet>) {
  console.log("[DEBUG] addSnippetSaga: triggered", action.payload);
  try {
    const newSnippet = action.payload;
    yield call(db.saveSnippet, newSnippet);
    yield put(addSnippetSuccess(newSnippet));
    if (newSnippet.isGenerated) {
      yield put(regenerateSnippet(newSnippet));
    }
    console.log("[DEBUG] addSnippetSaga: success", newSnippet);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    yield put(addSnippetFailure({ name: action.payload.name, error: message }));
    console.error("Failed to add snippet", error);
    console.log("[DEBUG] addSnippetSaga: failure", error);
  }
}

function* updateSnippetSaga(
  action: PayloadAction<Snippet>,
) {
  console.log("[DEBUG] updateSnippetSaga: triggered", action.payload);
  try {
    const updatedSnippet = action.payload;
    const oldSnippet: Snippet | undefined = yield select(
      (state: RootState) => state.snippets.snippets.find(s => s.id === updatedSnippet.id)
    );

    if (!oldSnippet) {
      throw new Error(`Snippet with id ${updatedSnippet.id} not found in state.`);
    }
    
    console.log("[DEBUG] updateSnippetSaga: calling db.saveSnippet");
    yield call(db.saveSnippet, updatedSnippet);
    console.log("[DEBUG] updateSnippetSaga: db.saveSnippet completed, dispatching success");
    yield put(updateSnippetSuccess({ oldName: oldSnippet.name, snippet: updatedSnippet }));
    console.log("[DEBUG] updateSnippetSaga: success dispatched", updatedSnippet);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred.";
    yield put(updateSnippetFailure({ id: action.payload.id, error: message }));
    console.error("Failed to update snippet", error);
    console.log("[DEBUG] updateSnippetSaga: failure", error);
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
  const snippetId = snippetToRegenerate.id;
  console.log(`[DEBUG] handleRegenerateSnippetSaga: triggered for ${snippetToRegenerate.name}`);
  
  // Dispatch event for test waiting
  window.dispatchEvent(
    new CustomEvent("app:snippet:regeneration:start", {
      detail: { id: snippetId, name: snippetToRegenerate.name },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("snippet_regeneration_started", {
      detail: { id: snippetId, name: snippetToRegenerate.name },
    }),
  );
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
          id: snippetId,
          error,
        }),
      );
      return;
    }
    
    const allSnippets: Snippet[] = yield select(
      (state: RootState) => state.snippets.snippets,
    );
    console.log(`[DEBUG] handleRegenerateSnippetSaga: snippet model for ${snippetToRegenerate.name}:`, snippetToRegenerate.model);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: snippet prompt for ${snippetToRegenerate.name}:`, snippetToRegenerate.prompt);
    const resolvedPrompt = resolveSnippets(
      snippetToRegenerate.prompt,
      allSnippets,
    );
    console.log(`[DEBUG] handleRegenerateSnippetSaga: resolved prompt for ${snippetToRegenerate.name}:`, resolvedPrompt);

    // If the prompt is empty, we don't need to do anything else.
    if (resolvedPrompt.trim() === "") {
      yield put(regenerateSnippetSuccess({ id: snippetId, content: "" }));
      window.dispatchEvent(
        new CustomEvent("app:snippet:regeneration:complete", {
          detail: { id: snippetId },
        }),
      );
      return;
    }

    yield put({ type: "app/setBatchRegenerating", payload: true });

    console.log(`[DEBUG] handleRegenerateSnippetSaga: about to call API for ${snippetToRegenerate.name} with model:`, snippetToRegenerate.model);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: API request content:`, resolvedPrompt);
    const assistantResponse: string = yield call(() =>
      requestMessageContent(
        [{ id: crypto.randomUUID(), role: "user", content: resolvedPrompt }],
        snippetToRegenerate.model!,
        settings.apiKey,
      ),
    );
    console.log(`[DEBUG] handleRegenerateSnippetSaga: got response for ${snippetToRegenerate.name}:`, assistantResponse);

    yield put(
      regenerateSnippetSuccess({ id: snippetId, content: assistantResponse }),
    );
    window.dispatchEvent(
      new CustomEvent(`app:snippet:regeneration:complete:${snippetId}`),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield put(regenerateSnippetFailure({ id: snippetId, error: errorMessage }));
    console.error(`Failed to regenerate snippet ${snippetToRegenerate.name}`, error);
  } finally {
    yield put({ type: "app/setBatchRegenerating", payload: false });
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
    console.log(
      "[DEBUG] resumeDirtySnippetGenerationSaga: found dirty snippets",
      dirtySnippets.map((s) => s.name),
    );
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
    const regenerationPromises = batch.map((snippet: Snippet) => {
      const promise = new Promise<void>((resolve) => {
        const eventName = `app:snippet:regeneration:complete:${snippet.id}`;
        const handleCompletion = () => {
          window.removeEventListener(eventName, handleCompletion);
          resolve();
        };
        window.addEventListener(eventName, handleCompletion);
      });
      return { promise, snippet };
    });

    yield all(
      regenerationPromises.map(({ snippet }) => put(regenerateSnippet(snippet))),
    );

    yield all(regenerationPromises.map(({ promise }) => call(() => promise)));
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

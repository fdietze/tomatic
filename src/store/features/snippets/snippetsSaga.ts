import { call, put, takeLatest, all, select, takeEvery, take } from "redux-saga/effects";
import { PayloadAction } from "@reduxjs/toolkit";
import { Snippet } from "@/types/storage";
import * as db from "@/services/persistence";
import { createAppError, toAppError, getErrorMessage, AppError } from "@/types/errors";
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
  importSnippets,
} from "./snippetsSlice";
import { RegenerateSnippetSuccessPayload } from "@/types/payloads";
import { RootState } from "../../store";
import {
  buildReverseDependencyGraph,
  findTransitiveDependents,
  groupSnippetsIntoBatches,
  resolveSnippetsWithTemplates,
  getTopologicalSortForExecution,
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
    yield put(loadSnippetsFailure(createAppError.persistence("loadSnippets", "Failed to load snippets.")));
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
    const appError = toAppError(error);
    yield put(addSnippetFailure({ name: action.payload.name, error: appError }));
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
    const appError = toAppError(error);
    yield put(updateSnippetFailure({ id: action.payload.id, error: appError }));
    console.log("[DEBUG] updateSnippetSaga: failure", error);
  }
}

function* deleteSnippetSaga(action: PayloadAction<string>) {
  try {
    yield call(db.deleteSnippet, action.payload);
    yield put(deleteSnippetSuccess(action.payload));
  } catch (error) {
    console.log("[DEBUG] deleteSnippetSaga: failure", error);
  }
}

// req:snippet-wait-individual, req:snippet-error-propagation
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
      const error = createAppError.validation('snippet', "Invalid snippet for regeneration.");
      yield put(
        regenerateSnippetFailure({
          id: snippetId,
          name: snippetToRegenerate?.name || 'unknown',
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
    const resolvedPrompt: string = yield call(
      resolveSnippetsWithTemplates,
      snippetToRegenerate.prompt,
      allSnippets,
    );
    console.log(`[DEBUG] handleRegenerateSnippetSaga: resolved prompt for ${snippetToRegenerate.name}:`, resolvedPrompt);

    // req:empty-prompt-handling: If the prompt is empty, we don't need to do anything else.
    if (resolvedPrompt.trim() === "") {
      console.log(`[DEBUG] handleRegenerateSnippetSaga: resolved prompt is empty for ${snippetToRegenerate.name}, skipping generation`);
      yield put(regenerateSnippetSuccess({ id: snippetId, name: snippetToRegenerate.name, content: "" }));
      console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching app:snippet:regeneration:complete:${snippetId} event for empty prompt`);
      window.dispatchEvent(
        new CustomEvent(`app:snippet:regeneration:complete:${snippetId}`),
      );
      console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching app:snippet:regeneration:complete event for empty prompt`);
      window.dispatchEvent(
        new CustomEvent("app:snippet:regeneration:complete", {
          detail: { id: snippetId, name: snippetToRegenerate.name },
        }),
      );
      return;
    }

    yield put({ type: "app/setBatchRegenerating", payload: true });

    console.log(`[DEBUG] handleRegenerateSnippetSaga: about to call API for ${snippetToRegenerate.name} with model:`, snippetToRegenerate.model);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: API request content:`, resolvedPrompt);
    const assistantResponse: string = yield call(() =>
      requestMessageContent(
        [{ id: crypto.randomUUID(), role: "user", content: resolvedPrompt, raw_content: resolvedPrompt }],
        snippetToRegenerate.model!,
        settings.apiKey,
      ),
    );
    console.log(`[DEBUG] handleRegenerateSnippetSaga: got response for ${snippetToRegenerate.name}:`, assistantResponse);

    yield put(
      regenerateSnippetSuccess({ id: snippetId, name: snippetToRegenerate.name, content: assistantResponse }),
    );
  // req:snippet-wait-by-id: Dispatch events for individual snippet waiting by ID
  console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching app:snippet:regeneration:complete:${snippetId} event`);
  window.dispatchEvent(
    new CustomEvent(`app:snippet:regeneration:complete:${snippetId}`),
  );
  console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching app:snippet:regeneration:complete event`);
  window.dispatchEvent(
    new CustomEvent("app:snippet:regeneration:complete", {
      detail: { id: snippetId, name: snippetToRegenerate.name },
    }),
  );
  } catch (error) {
    console.log(`[DEBUG] handleRegenerateSnippetSaga: caught error for ${snippetToRegenerate.name}:`, error);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: error type:`, typeof error);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: error has type property:`, error && typeof error === 'object' && 'type' in error);
    
    // If it's already an AppError, use its message directly
    let errorMessage: string;
    if (error && typeof error === 'object' && 'type' in error) {
      errorMessage = getErrorMessage(error as AppError);
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    
    console.log(`[DEBUG] handleRegenerateSnippetSaga: converted error message:`, errorMessage);
    const appError = createAppError.snippetRegeneration(snippetToRegenerate.name, errorMessage);
    console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching regenerateSnippetFailure with error:`, getErrorMessage(appError));
    yield put(regenerateSnippetFailure({ id: snippetId, name: snippetToRegenerate.name, error: appError }));
    
    // Dispatch failure event for batch orchestrator
    console.log(`[DEBUG] handleRegenerateSnippetSaga: dispatching app:snippet:regeneration:failure:${snippetId} event`);
    window.dispatchEvent(
      new CustomEvent(`app:snippet:regeneration:failure:${snippetId}`)
    );
  } finally {
    yield put({ type: "app/setBatchRegenerating", payload: false });
  }
}

// req:transitive-regeneration: Mark dependent snippets as dirty for cascading regeneration
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
    // req:cycle-detection: Check for cycles before starting regeneration
    const { cyclic } = getTopologicalSortForExecution(allSnippets);
    if (cyclic.length > 0) {
      console.log("[DEBUG] markDependentsDirtySaga: Cycle detected in snippet dependencies, count:", cyclic.length);
      console.log("[DEBUG] markDependentsDirtySaga: Cyclic snippets:", cyclic);
      console.log("[DEBUG] markDependentsDirtySaga: All snippets for context:", allSnippets.map(s => ({ name: s.name, content: s.content, prompt: s.prompt })));
      // Don't start regeneration if there's a cycle
      return;
    }
    
    yield put(batchRegenerateRequest({ snippets: dependentsToUpdate }));
  }
}

function* resumeDirtySnippetGenerationSaga() {
  console.log("[DEBUG] resumeDirtySnippetGenerationSaga: triggered");
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );
  const dirtySnippets = allSnippets.filter((s) => s.isDirty);
  console.log("[DEBUG] resumeDirtySnippetGenerationSaga: all snippets:", allSnippets.map(s => ({ name: s.name, isDirty: s.isDirty, model: s.model })));
  if (dirtySnippets.length > 0) {
    console.log(
      "[DEBUG] resumeDirtySnippetGenerationSaga: found dirty snippets",
      dirtySnippets.map((s) => s.name),
    );
    yield put(batchRegenerateRequest({ snippets: dirtySnippets }));
  } else {
    console.log("[DEBUG] resumeDirtySnippetGenerationSaga: no dirty snippets found");
  }
}

// req:snippet-dirty-indexeddb: Persist snippet content after successful regeneration
function* persistSnippetAfterRegenerationSaga(
  action: PayloadAction<RegenerateSnippetSuccessPayload>,
) {
  console.log("[DEBUG] persistSnippetAfterRegenerationSaga: triggered for snippet:", action.payload.name);
  try {
    // Get the updated snippet from Redux state
    const allSnippets: Snippet[] = yield select(
      (state: RootState) => state.snippets.snippets,
    );
    const updatedSnippet = allSnippets.find(s => s.id === action.payload.id);
    
    if (updatedSnippet) {
      console.log("[DEBUG] persistSnippetAfterRegenerationSaga: saving snippet to IndexedDB:", {
        id: updatedSnippet.id,
        name: updatedSnippet.name,
        content: updatedSnippet.content,
        isDirty: updatedSnippet.isDirty
      });
      yield call(db.saveSnippet, updatedSnippet);
      console.log("[DEBUG] persistSnippetAfterRegenerationSaga: successfully saved snippet to IndexedDB");
    } else {
      console.log("[DEBUG] persistSnippetAfterRegenerationSaga: snippet not found in Redux state:", action.payload.id);
    }
  } catch (error) {
    console.log("[DEBUG] persistSnippetAfterRegenerationSaga: failed to persist snippet:", error);
    // We don't want to fail the regeneration just because persistence failed
    // The content is still in Redux state and will work until page reload
  }
}

function* batchRegenerationOrchestratorSaga(
  action: PayloadAction<{ snippets: Snippet[] }>,
) {
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: triggered with dirty snippets", action.payload.snippets.map(s => s.name));
  const { snippets: dirtySnippets } = action.payload;

  // req:transitive-regeneration-topological-sort: Select all snippets from the state to build a complete dependency graph.
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );

  // Perform topological sort on the entire set of snippets to get the correct execution order.
  const { sorted: allSortedSnippets, cyclic } = getTopologicalSortForExecution(allSnippets);

  if (cyclic.length > 0) {
    console.log("[DEBUG] batchRegenerationOrchestratorSaga: Cyclic dependency detected in snippets:", cyclic);
    console.log("[DEBUG] batchRegenerationOrchestratorSaga: Stopping batch regeneration due to cycles");
    // Errors for cyclic snippets should already be set by the validation logic.
    // We just need to stop the regeneration process here.
    return;
  }

  // Filter the globally sorted list to get only the dirty snippets that need regeneration,
  // but now they are in the correct topological order.
  const dirtySnippetNames = new Set(dirtySnippets.map(s => s.name));
  const sortedDirtySnippets = allSortedSnippets.filter(s => dirtySnippetNames.has(s.name));
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: sorted dirty snippets for regeneration", sortedDirtySnippets.map(s => s.name));

  const batches = groupSnippetsIntoBatches(sortedDirtySnippets);
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: created batches", batches.map(b => b.map(s => s.name)));

  const failedSnippets = new Set<string>();

  for (const batch of batches) {
    // Check if any snippet in this batch depends on a failed snippet
    const shouldSkipBatch = batch.some(snippet => {
      // Extract dependencies from the snippet's prompt
      const dependencies = (snippet.prompt || '').match(/@(\w+)/g) || [];
      return dependencies.some(dep => {
        const depName = dep.substring(1); // Remove @ prefix
        return failedSnippets.has(depName);
      });
    });

    if (shouldSkipBatch) {
      // Fail all snippets in this batch with upstream dependency error
      console.log("[DEBUG] batchRegenerationOrchestratorSaga: skipping batch due to failed dependencies:", batch.map(s => s.name));
      for (const snippet of batch) {
        const dependencies = (snippet.prompt || '').match(/@(\w+)/g) || [];
        const failedDep = dependencies.find(dep => {
          const depName = dep.substring(1);
          return failedSnippets.has(depName);
        });
        
        if (failedDep) {
          const depName = failedDep.substring(1);
          const error = createAppError.snippetRegeneration(
            snippet.name,
            `Upstream dependency @${depName} failed to generate.`
          );
          yield put(regenerateSnippetFailure({ 
            id: snippet.id, 
            name: snippet.name, 
            error 
          }));
          failedSnippets.add(snippet.name);
        }
      }
      continue;
    }

    // Process the batch normally
    const regenerationPromises = batch.map((snippet: Snippet) => {
      const promise = new Promise<{ success: boolean; snippet: Snippet }>((resolve) => {
        const successEventName = `app:snippet:regeneration:complete:${snippet.id}`;
        const handleSuccess = () => {
          window.removeEventListener(successEventName, handleSuccess);
          window.removeEventListener(failureEventName, handleFailure);
          resolve({ success: true, snippet });
        };
        
        const failureEventName = `app:snippet:regeneration:failure:${snippet.id}`;
        const handleFailure = () => {
          window.removeEventListener(successEventName, handleSuccess);
          window.removeEventListener(failureEventName, handleFailure);
          resolve({ success: false, snippet });
        };
        
        window.addEventListener(successEventName, handleSuccess);
        window.addEventListener(failureEventName, handleFailure);
      });
      return { promise, snippet };
    });

    yield all(
      regenerationPromises.map(({ snippet }) => put(regenerateSnippet(snippet))),
    );

    const results: Array<{ success: boolean; snippet: Snippet }> = yield all(regenerationPromises.map(({ promise }) => call(() => promise)));
    
    // Check for failures in this batch
    for (const result of results) {
      if (!result.success) {
        failedSnippets.add(result.snippet.name);
        console.log("[DEBUG] batchRegenerationOrchestratorSaga: snippet failed:", result.snippet.name);
      }
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

// Result type for the worker saga
type RegenerateResult = 
  | { success: true; snippet: Snippet }
  | { success: false; error: string };

// New worker saga for the fork/join pattern
export function* regenerateSnippetWorker(snippet: Snippet): Generator<unknown, RegenerateResult, unknown> {
  try {
    console.log(`[DEBUG] regenerateSnippetWorker: starting regeneration for ${snippet.name}`);
    
    // Dispatch the regeneration request
    yield put(regenerateSnippet(snippet));
    
    // Wait for either success or failure
    console.log(`[DEBUG] regenerateSnippetWorker: waiting for completion of ${snippet.name}`);
    const result = yield take((action: unknown) => {
      const typedAction = action as { type: string; payload: { name: string; error?: string } };
      return (typedAction.type === regenerateSnippetSuccess.type && typedAction.payload.name === snippet.name) ||
             (typedAction.type === regenerateSnippetFailure.type && typedAction.payload.name === snippet.name);
    });
    
    const typedResult = result as { type: string; payload: { name: string; error?: AppError } };
    if (typedResult.type === regenerateSnippetFailure.type) {
      console.log(`[DEBUG] regenerateSnippetWorker: regeneration failed for ${snippet.name}:`, typedResult.payload.error);
      const errorMessage = typedResult.payload.error ? getErrorMessage(typedResult.payload.error) : 'Unknown error';
      console.log(`[DEBUG] regenerateSnippetWorker: converted error to string:`, errorMessage);
      return { success: false, error: errorMessage };
    }
    
    // Get the updated snippet from the store
    const updatedSnippets = (yield select(
      (state: RootState) => state.snippets.snippets
    )) as Snippet[];
    const updatedSnippet = updatedSnippets.find(s => s.id === snippet.id);
    
    if (!updatedSnippet) {
      console.log(`[DEBUG] regenerateSnippetWorker: snippet ${snippet.name} not found after regeneration`);
      return { success: false, error: `Snippet ${snippet.name} not found after regeneration` };
    }
    
    console.log(`[DEBUG] regenerateSnippetWorker: completed regeneration for ${snippet.name}`);
    return { success: true, snippet: updatedSnippet };
  } catch (error) {
    console.log(`[DEBUG] regenerateSnippetWorker: caught unexpected error for ${snippet.name}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: errorMessage };
  }
}

function* importSnippetsSaga(action: PayloadAction<Snippet[]>) {
  try {
    const snippetsToImport = action.payload;
    const existingSnippets: Snippet[] = yield select(
      (state: RootState) => state.snippets.snippets,
    );
    const existingSnippetsByName = new Map(
      existingSnippets.map((s) => [s.name, s]),
    );

    for (const snippetToImport of snippetsToImport) {
      const existingSnippet = existingSnippetsByName.get(snippetToImport.name);
      if (existingSnippet) {
        // Update existing snippet
        const updatedSnippet = {
          ...existingSnippet,
          content: snippetToImport.content,
          isGenerated: snippetToImport.isGenerated,
          prompt: snippetToImport.prompt,
          model: snippetToImport.model,
          updatedAt_ms: Date.now(),
        };
        yield call(db.saveSnippet, updatedSnippet);
      } else {
        // Add new snippet
        const newSnippet = {
          ...snippetToImport,
          id: crypto.randomUUID(),
          createdAt_ms: Date.now(),
          updatedAt_ms: Date.now(),
        };
        yield call(db.saveSnippet, newSnippet);
      }
    }

    yield put(loadSnippets());
  } catch (error) {
    console.log("[DEBUG] importSnippetsSaga: failure", error);
    yield put(loadSnippetsFailure(createAppError.persistence("importSnippets", "Failed to import snippets.")));
  }
}

export function* snippetsSaga() {
  yield all([
    takeLatest(loadSnippets.type, loadSnippetsSaga),
    takeLatest(addSnippet.type, addSnippetSaga),
    takeLatest(updateSnippet.type, updateSnippetSaga),
    takeLatest(deleteSnippet.type, deleteSnippetSaga),
    takeLatest(importSnippets.type, importSnippetsSaga),
    takeLatest(
      [updateSnippetSuccess.type, addSnippetSuccess.type],
      markDependentsDirtySaga,
    ),
    takeLatest(loadSnippetsSuccess.type, resumeDirtySnippetGenerationSaga),
    takeEvery(batchRegenerateRequest.type, batchRegenerationOrchestratorSaga),
    takeEvery(regenerateSnippet.type, handleRegenerateSnippetSaga),
    takeEvery(awaitableRegenerateRequest.type, handleAwaitableRegeneration),
    // req:snippet-dirty-indexeddb: Persist snippet content after successful regeneration
    takeEvery(regenerateSnippetSuccess.type, persistSnippetAfterRegenerationSaga),
  ]);
}

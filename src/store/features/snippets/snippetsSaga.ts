import { call, put, takeLatest, all, select, takeEvery } from "redux-saga/effects";
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
  setRegenerationStatus,
  batchRegenerateRequest,
  importSnippets,
  updateAndRegenerateSnippetRequested,
  updateSnippetSuccessInternal,
} from "./snippetsSlice";
import { RegenerateSnippetSuccessPayload, UpdateAndRegenerateSnippetPayload } from "@/types/payloads";
import { RootState } from "../../store";
import {
  buildReverseDependencyGraph,
  findTransitiveDependents,
  groupSnippetsIntoWaves,
  resolveSnippetsWithTemplates,
  getTopologicalSortForExecution,
  getReferencedSnippetNames,
} from "@/utils/snippetUtils";
import { requestMessageContent } from "@/api/openrouter";
import { RegenerationResult } from "@/types/payloads";
import { evaluateTemplate } from "@/utils/templateUtils";

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
  if (dirtySnippets.length > 0) {
    console.log(
      "[DEBUG] resumeDirtySnippetGenerationSaga: found dirty snippets",
      dirtySnippets.map((s) => s.name),
    );
    yield put(batchRegenerateRequest({ snippets: dirtySnippets }));
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

/**
 * Wave-based batch regeneration orchestrator.
 * Processes snippets in topological waves, ensuring each wave completes before the next begins.
 * This eliminates the race condition where dependent snippets use stale data.
 */
function* batchRegenerationOrchestratorSaga(
  action: PayloadAction<{ snippets: Snippet[] }>,
) {
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: triggered with dirty snippets", action.payload.snippets.map(s => s.name));
  const { snippets: dirtySnippets } = action.payload;

  // Get all snippets to build the resolver context
  const allSnippets: Snippet[] = yield select(
    (state: RootState) => state.snippets.snippets,
  );

  // Check for cycles before starting
  const { cyclic } = getTopologicalSortForExecution(allSnippets);
  if (cyclic.length > 0) {
    console.log("[DEBUG] batchRegenerationOrchestratorSaga: Cyclic dependency detected, stopping regeneration");
    return;
  }

  // Group dirty snippets into waves based on dependency levels
  const waves = groupSnippetsIntoWaves(dirtySnippets);
  console.log("[DEBUG] batchRegenerationOrchestratorSaga: created", waves.length, "waves");

  // Initialize the resolver context with content from all non-dirty snippets
  const resolverContext = new Map<string, string>();
  const dirtySnippetNames = new Set(dirtySnippets.map(s => s.name));
  
  for (const snippet of allSnippets) {
    if (!dirtySnippetNames.has(snippet.name)) {
      resolverContext.set(snippet.name, snippet.content);
    }
  }

  // Process waves sequentially
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];
    if (!wave) continue;
    
    console.log(`[DEBUG] batchRegenerationOrchestratorSaga: processing wave ${waveIndex}/${waves.length}:`, wave.map(s => s.name));
    
    // Set status and dispatch start events for all snippets in this wave
    for (const snippet of wave) {
      // Set status to "in_progress" (for spinner display) without triggering the saga watcher
      yield put(setRegenerationStatus({ id: snippet.id, status: "in_progress" }));
      
      // Dispatch start events for E2E test compatibility
      window.dispatchEvent(
        new CustomEvent("app:snippet:regeneration:start", {
          detail: { id: snippet.id, name: snippet.name },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("snippet_regeneration_started", {
          detail: { id: snippet.id, name: snippet.name },
        }),
      );
    }
    
    // Regenerate all snippets in this wave in parallel
    const waveResults: Array<RegenerationResult | { error: string; snippet: Snippet }> = yield all(
      wave.map((snippet) =>
        call(function* () {
          try {
            const result: RegenerationResult = yield call(
              regenerateSnippetWorkerWithContext,
              snippet,
              resolverContext
            );
            return result;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { error: errorMessage, snippet };
          }
        })
      )
    );

    // Update resolver context and dispatch actions for this wave
    for (let i = 0; i < waveResults.length; i++) {
      const result = waveResults[i];
      const snippet = wave[i];
      
      if (!snippet || !result) continue;

      if ('error' in result) {
        // Handle error
        console.log(`[DEBUG] batchRegenerationOrchestratorSaga: snippet ${snippet.name} failed:`, result.error);
        const appError = createAppError.snippetRegeneration(snippet.name, result.error);
        yield put(regenerateSnippetFailure({
          id: snippet.id,
          name: snippet.name,
          error: appError
        }));
        
        // Dispatch failure event for E2E test compatibility
        window.dispatchEvent(
          new CustomEvent(`app:snippet:regeneration:failure:${snippet.id}`)
        );
      } else {
        // Success - update context and dispatch success
        resolverContext.set(snippet.name, result.content);
        yield put(regenerateSnippetSuccess(result));
        
        // Dispatch completion events for E2E test compatibility
        window.dispatchEvent(
          new CustomEvent(`app:snippet:regeneration:complete:${snippet.id}`)
        );
        window.dispatchEvent(
          new CustomEvent("app:snippet:regeneration:complete", {
            detail: { id: snippet.id, name: snippet.name },
          }),
        );
      }
    }
  }

  console.log("[DEBUG] batchRegenerationOrchestratorSaga: all waves completed");
  window.dispatchEvent(new CustomEvent("app:snippet:regeneration:batch:complete"));
}


/**
 * New worker saga that regenerates a single snippet using a provided resolver context.
 * This is the core execution unit for wave-based parallel regeneration.
 *
 * @param snippet The snippet to regenerate
 * @param resolverContext A map of snippet names to their resolved content
 * @returns A RegenerationResult containing the new content or an error
 */
export function* regenerateSnippetWorkerWithContext(
  snippet: Snippet,
  resolverContext: ReadonlyMap<string, string>
): Generator<unknown, RegenerationResult, unknown> {
  console.log(`[DEBUG] regenerateSnippetWorkerWithContext: starting regeneration for ${snippet.name}`);
  
  try {
    // Get settings for API call
    const settings = (yield select(
      (state: RootState) => state.settings
    )) as RootState["settings"];

    // Validation
    if (
      !snippet.isGenerated ||
      typeof snippet.prompt !== "string" ||
      !snippet.model
    ) {
      throw new Error("Invalid snippet for regeneration.");
    }

    // Pre-flight validation: Check if all dependencies exist in the resolver context
    const dependencies = getReferencedSnippetNames(snippet.prompt);
    for (const dep of dependencies) {
      if (!resolverContext.has(dep)) {
        throw new Error(`Upstream dependency @${dep} failed to generate.`);
      }
    }
    
    // Resolve the prompt using the resolver context
    const preprocessedPrompt = snippet.prompt.replace(/@([a-zA-Z0-9_]+)/g, '${$1}');
    
    // Convert ReadonlyMap to plain object for evaluateTemplate
    const contextObj: Record<string, string> = {};
    resolverContext.forEach((value, key) => {
      contextObj[key] = value;
    });
    
    const resolvedPrompt = (yield call(
      evaluateTemplate,
      preprocessedPrompt,
      contextObj
    )) as string;
    
    console.log(`[DEBUG] regenerateSnippetWorkerWithContext: resolved prompt for ${snippet.name}:`, resolvedPrompt);

    // Handle empty prompt
    if (resolvedPrompt.trim() === "") {
      console.log(`[DEBUG] regenerateSnippetWorkerWithContext: resolved prompt is empty for ${snippet.name}`);
      return { id: snippet.id, name: snippet.name, content: "" };
    }

    // Call the API
    console.log(`[DEBUG] regenerateSnippetWorkerWithContext: calling API for ${snippet.name}`);
    const assistantResponse = (yield call(() =>
      requestMessageContent(
        [{
          id: crypto.randomUUID(),
          role: "user",
          content: resolvedPrompt,
          raw_content: resolvedPrompt
        }],
        snippet.model!,
        settings.apiKey,
      ),
    )) as string;
    
    console.log(`[DEBUG] regenerateSnippetWorkerWithContext: got response for ${snippet.name}:`, assistantResponse);

    return {
      id: snippet.id,
      name: snippet.name,
      content: assistantResponse
    };
  } catch (error) {
    console.log(`[DEBUG] regenerateSnippetWorkerWithContext: error for ${snippet.name}:`, error);
    
    let errorMessage: string;
    if (error && typeof error === 'object' && 'type' in error) {
      errorMessage = getErrorMessage(error as AppError);
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    
    throw new Error(errorMessage);
  }
}


/**
 * Master orchestrator saga for updating and regenerating a snippet with its dependents.
 * This saga ensures the correct sequential flow:
 * 1. Save the snippet to DB and update Redux state
 * 2. If the prompt changed, regenerate the snippet itself and WAIT for completion
 * 3. Only after the snippet is regenerated, find and regenerate its dependents
 *
 * This eliminates the race condition where dependents start regenerating before
 * the parent snippet has finished, causing them to use stale data.
 */
function* updateAndRegenerateSaga(
  action: PayloadAction<UpdateAndRegenerateSnippetPayload>
) {
  const { snippet: updatedSnippet } = action.payload;
  
  try {
    // Step 1: Get the old snippet for comparison
    const oldSnippet: Snippet | undefined = yield select(
      (state: RootState) => state.snippets.snippets.find(s => s.id === updatedSnippet.id)
    );
    
    if (!oldSnippet) {
      throw new Error(`Snippet with id ${updatedSnippet.id} not found in state.`);
    }
    
    const promptChanged = oldSnippet.prompt !== updatedSnippet.prompt;
    
    // Step 2: Save to DB and update Redux state
    // CRITICAL: Use internal action to update state WITHOUT triggering markDependentsDirtySaga
    // The orchestrator will handle dependents itself after waiting for regeneration
    yield call(db.saveSnippet, updatedSnippet);
    yield put(updateSnippetSuccessInternal({ oldName: oldSnippet.name, snippet: updatedSnippet }));
    
    // Step 3: If it's a generated snippet with a changed prompt, regenerate it NOW
    if (updatedSnippet.isGenerated && promptChanged) {
      // CRITICAL: Use 'call' to WAIT for the regeneration to complete
      // This ensures the snippet's content is fresh before we proceed
      yield call(handleRegenerateSnippetSaga, { payload: updatedSnippet, type: regenerateSnippet.type });
    }
    
    // Step 4: NOW find and regenerate dependents (they will use fresh state)
    const allSnippets: Snippet[] = yield select(
      (state: RootState) => state.snippets.snippets,
    );
    const reverseGraph = buildReverseDependencyGraph(allSnippets);
    const changedSnippetName = oldSnippet.name; // Use old name in case name changed
    const dependentNames = findTransitiveDependents(changedSnippetName, reverseGraph);
    
    if (dependentNames.size === 0) {
      return;
    }
    
    // Step 5: Mark dependents as dirty and trigger batch regeneration
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
      // Check for cycles
      const { cyclic } = getTopologicalSortForExecution(allSnippets);
      if (cyclic.length > 0) {
        console.log("[DEBUG] updateAndRegenerateSaga: Cycle detected, stopping");
        return;
      }
      
      yield put(batchRegenerateRequest({ snippets: dependentsToUpdate }));
    }
  } catch (error) {
    const appError = toAppError(error);
    console.log("[DEBUG] updateAndRegenerateSaga: error", error);
    yield put(updateSnippetFailure({ id: updatedSnippet.id, error: appError }));
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
    takeLatest(updateAndRegenerateSnippetRequested.type, updateAndRegenerateSaga),
    takeLatest(
      [updateSnippetSuccess.type, addSnippetSuccess.type],
      markDependentsDirtySaga,
    ),
    takeLatest(loadSnippetsSuccess.type, resumeDirtySnippetGenerationSaga),
    takeEvery(batchRegenerateRequest.type, batchRegenerationOrchestratorSaga),
    takeEvery(regenerateSnippet.type, handleRegenerateSnippetSaga),
    // req:snippet-dirty-indexeddb: Persist snippet content after successful regeneration
    takeEvery(regenerateSnippetSuccess.type, persistSnippetAfterRegenerationSaga),
  ]);
}

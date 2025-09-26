import { call, put, takeLatest, select, take, all } from "redux-saga/effects";
import { SagaIterator } from "redux-saga";
import { initialize, initializationComplete, initializationFailed } from "./appSlice";
import { getMostRecentSessionId } from "@/services/db/chat-sessions";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { migrationPromise } from "@/services/persistence";
import { dispatchEvent } from "@/utils/events";
import { selectModels, fetchModels, fetchModelsSuccess, fetchModelsFailure } from "../models/modelsSlice";
import { loadPrompts, loadPromptsSuccess, loadPromptsFailure } from "../prompts/promptsSlice";
import { loadSnippets, loadSnippetsSuccess, loadSnippetsFailure } from "../snippets/snippetsSlice";

function* handleInitialize(): SagaIterator {
  try {
    console.log('[DEBUG] handleInitialize: starting app initialization');
    
    // First, handle DB migration.
    const migrated: boolean = yield call(() => migrationPromise);
    console.log('[DEBUG] handleInitialize: migration completed:', migrated);
    if (migrated) {
      const mostRecentSessionId: string | null = yield call(
        getMostRecentSessionId,
      );
      if (mostRecentSessionId) {
        const navigationService = yield call(getNavigationService);
        yield call(
          [navigationService, navigationService.navigate],
          ROUTES.chat.session(mostRecentSessionId),
          { replace: true },
        );
      }
    }

    // Load all essential app data in parallel and WAIT for completion
    console.log('[DEBUG] handleInitialize: starting to load essential data (prompts, snippets)');
    yield all([
      put(loadPrompts()),
      put(loadSnippets()),
    ]);

    // Wait for both prompts and snippets to load (success or failure)
    console.log('[DEBUG] handleInitialize: waiting for prompts and snippets to complete');
    const [promptsResult, snippetsResult] = yield all([
      take([loadPromptsSuccess.type, loadPromptsFailure.type]),
      take([loadSnippetsSuccess.type, loadSnippetsFailure.type]),
    ]);

    console.log('[DEBUG] handleInitialize: essential data loading completed');
    console.log('[DEBUG] handleInitialize: prompts result:', promptsResult.type);
    console.log('[DEBUG] handleInitialize: snippets result:', snippetsResult.type);

    // Check if any critical loading failed
    if (promptsResult.type === loadPromptsFailure.type) {
      console.log('[DEBUG] handleInitialize: prompts loading failed');
      yield put(initializationFailed("Failed to load system prompts"));
      return;
    }

    if (snippetsResult.type === loadSnippetsFailure.type) {
      console.log('[DEBUG] handleInitialize: snippets loading failed');
      yield put(initializationFailed("Failed to load snippets"));
      return;
    }

    // Load models (non-critical, can fail without blocking app)
    console.log('[DEBUG] handleInitialize: loading models');
    const { models: cachedModels } = yield select(selectModels);
    if (cachedModels.length === 0) {
      yield put(fetchModels());
      const result = yield take([fetchModelsSuccess.type, fetchModelsFailure.type]);
      
      if (result.type === fetchModelsSuccess.type) {
          console.log('[DEBUG] handleInitialize: models loaded successfully');
          dispatchEvent('app:models_loaded', { success: true, count: result.payload.length });
      } else {
          console.log('[DEBUG] handleInitialize: models loading failed, but continuing');
          dispatchEvent('app:models_loaded', { success: false, count: 0 });
      }
    } else {
      console.log('[DEBUG] handleInitialize: using cached models');
      dispatchEvent('app:models_loaded', { success: true, count: cachedModels.length });
    }

    console.log('[DEBUG] handleInitialize: all initialization complete, dispatching initializationComplete');
    yield put(initializationComplete());
    console.log('[DEBUG] handleInitialize: dispatching app_initialized event');
    dispatchEvent("app_initialized");
  } catch (error) {
    console.log('[DEBUG] handleInitialize: initialization failed with error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield put(initializationFailed(`Initialization failed: ${errorMessage}`));
  }
}


export function* appSaga() {
  yield takeLatest(initialize.type, handleInitialize);
}

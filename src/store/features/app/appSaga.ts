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
    // First, handle DB migration.
    const migrated: boolean = yield call(() => migrationPromise);
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
    yield all([
      put(loadPrompts()),
      put(loadSnippets()),
    ]);

    // Wait for both prompts and snippets to load (success or failure)
    const [promptsResult, snippetsResult] = yield all([
      take([loadPromptsSuccess.type, loadPromptsFailure.type]),
      take([loadSnippetsSuccess.type, loadSnippetsFailure.type]),
    ]);

    // Check if any critical loading failed
    if (promptsResult.type === loadPromptsFailure.type) {
      yield put(initializationFailed("Failed to load system prompts"));
      return;
    }

    if (snippetsResult.type === loadSnippetsFailure.type) {
      yield put(initializationFailed("Failed to load snippets"));
      return;
    }

    // Load models (non-critical, can fail without blocking app)
    const { models: cachedModels } = yield select(selectModels);
    if (cachedModels.length === 0) {
      yield put(fetchModels());
      const result = yield take([fetchModelsSuccess.type, fetchModelsFailure.type]);
      
      if (result.type === fetchModelsSuccess.type) {
          dispatchEvent('app:models_loaded', { success: true, count: result.payload.length });
      } else {
          dispatchEvent('app:models_loaded', { success: false, count: 0 });
      }
    } else {
      dispatchEvent('app:models_loaded', { success: true, count: cachedModels.length });
    }

    yield put(initializationComplete());
    dispatchEvent("app_initialized");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield put(initializationFailed(`Initialization failed: ${errorMessage}`));
  }
}


export function* appSaga() {
  yield takeLatest(initialize.type, handleInitialize);
}

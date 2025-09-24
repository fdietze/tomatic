import { call, put, takeLatest, select, take } from "redux-saga/effects";
import { SagaIterator } from "redux-saga";
import { initialize, initializationComplete } from "./appSlice";
import { getMostRecentSessionId } from "@/services/db/chat-sessions";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { migrationPromise } from "@/services/persistence";
import { dispatchEvent } from "@/utils/events";
import { selectModels, fetchModels, fetchModelsSuccess, fetchModelsFailure } from "../models/modelsSlice";

function* handleInitialize(): SagaIterator {
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

  // Then, handle loading the models.
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
}

function* batchRegenerationStartSaga() {
  yield put({ type: "app/setBatchRegenerating", payload: true });
}

function* batchRegenerationCompleteSaga() {
  yield put({ type: "app/setBatchRegenerating", payload: false });
}

export function* appSaga() {
  yield takeLatest(initialize.type, handleInitialize);
}

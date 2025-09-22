import { call, put, takeLatest } from "redux-saga/effects";
import { SagaIterator } from "redux-saga";
import { initialize, initializationComplete } from "./appSlice";
import { getMostRecentSessionId } from "@/services/db/chat-sessions";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { migrationPromise } from "@/services/persistence";

function* handleInitialize(): SagaIterator {
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
  yield put(initializationComplete());
}

export function* appSaga() {
  yield takeLatest(initialize.type, handleInitialize);
}

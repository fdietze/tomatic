import { call, put, takeLatest } from "redux-saga/effects";
import { listAvailableModels } from "@/api/openrouter";
import { DisplayModelInfo } from "@/types/storage";
import {
  fetchModels,
  fetchModelsSuccess,
  fetchModelsFailure,
} from "./modelsSlice";
import { createAppError } from "@/types/errors";

function* fetchModelsSaga() {
  try {
    const models: DisplayModelInfo[] = yield call(listAvailableModels);
    yield put(fetchModelsSuccess(models));
  } catch {
    yield put(fetchModelsFailure(createAppError.api("Failed to fetch models.")));
  }
}

export function* modelsSaga() {
  yield takeLatest(fetchModels.type, fetchModelsSaga);
}

import { call, put, takeLatest, select, debounce } from "redux-saga/effects";
import { PayloadAction } from "@reduxjs/toolkit";
import { retryFailedSnippets } from "../snippets/snippetsSlice";
import {
  loadSettings,
  loadSettingsSuccess,
  loadSettingsFailure,
  saveSettings as saveSettingsAction,
  saveSettingsSuccess,
  saveSettingsFailure,
  SettingsState,
  selectSettings,
  setApiKey,
  setModelName,
  toggleAutoScroll,
  setSelectedPromptName,
  setInitialChatPrompt,
} from "./settingsSlice";
import * as persistence from "@/services/persistence/settings";

function* loadSettingsSaga() {
  try {
    const settings: Partial<SettingsState> = yield call(
      persistence.loadSettings,
    );
    yield put(loadSettingsSuccess(settings));
  } catch {
    yield put(loadSettingsFailure());
  }
}

function* saveSettingsSaga() {
  try {
    const settings: SettingsState = yield select(selectSettings);
    yield call(persistence.saveSettings, settings);
    yield put(saveSettingsSuccess());
  } catch {
    yield put(saveSettingsFailure());
  }
}

function* watchApiKeyChangesSaga(action: PayloadAction<string>) {
  // req:api-key-update-retries
  if (action.payload) {
    yield put(retryFailedSnippets());
  }
}

export function* settingsSaga() {
  yield takeLatest(loadSettings.type, loadSettingsSaga);
  const actionsToSave = [
    setApiKey.type,
    setModelName.type,
    toggleAutoScroll.type,
    setSelectedPromptName.type,
    setInitialChatPrompt.type,
  ];
  yield debounce(500, actionsToSave, saveSettingsSaga);
  yield takeLatest(saveSettingsAction.type, saveSettingsSaga);
  yield takeLatest(setApiKey.type, watchApiKeyChangesSaga);
}

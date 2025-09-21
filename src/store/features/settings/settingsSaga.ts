import { call, put, takeLatest, select, debounce } from 'redux-saga/effects';
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
} from './settingsSlice';
import * as persistence from '@/services/persistence/settings';

function* loadSettingsSaga() {
  try {
    const settings: Partial<SettingsState> = yield call(persistence.loadSettings);
    yield put(loadSettingsSuccess(settings));
  } catch (_error) {
    yield put(loadSettingsFailure());
  }
}

function* saveSettingsSaga() {
  try {
    const settings: SettingsState = yield select(selectSettings);
    yield call(persistence.saveSettings, settings);
    yield put(saveSettingsSuccess());
  } catch (_error) {
    yield put(saveSettingsFailure());
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
    saveSettingsAction.type
  ];
  yield debounce(500, actionsToSave, saveSettingsSaga);
}

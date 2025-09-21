import { call, put, takeLatest, all } from 'redux-saga/effects';
import { PayloadAction } from '@reduxjs/toolkit';
import { SystemPrompt } from '@/types/storage';
import * as db from '@/services/db/system-prompts';
import {
  loadPrompts,
  loadPromptsSuccess,
  loadPromptsFailure,
  addPrompt,
  addPromptSuccess,
  updatePrompt,
  updatePromptSuccess,
  deletePrompt,
  deletePromptSuccess,
} from './promptsSlice';

function* loadPromptsSaga() {
  try {
    const prompts: SystemPrompt[] = yield call(db.loadAllSystemPrompts);
    yield put(loadPromptsSuccess(prompts));
  } catch (_error) {
    yield put(loadPromptsFailure('Failed to load prompts.'));
  }
}

function* addPromptSaga(action: PayloadAction<SystemPrompt>) {
  try {
    yield call(db.saveSystemPrompt, action.payload);
    yield put(addPromptSuccess(action.payload));
  } catch (error) {
    // In a real app, you'd dispatch a failure action
    console.error('Failed to add prompt', error);
  }
}

function* updatePromptSaga(action: PayloadAction<{ oldName: string; prompt: SystemPrompt }>) {
  try {
    const { oldName, prompt } = action.payload;
    if (oldName !== prompt.name) {
      yield call(db.deleteSystemPrompt, oldName);
    }
    yield call(db.saveSystemPrompt, prompt);
    yield put(updatePromptSuccess(prompt));
  } catch (error) {
    console.error('Failed to update prompt', error);
  }
}

function* deletePromptSaga(action: PayloadAction<string>) {
  try {
    yield call(db.deleteSystemPrompt, action.payload);
    yield put(deletePromptSuccess(action.payload));
  } catch (error) {
    console.error('Failed to delete prompt', error);
  }
}

export function* promptsSaga() {
  yield all([
    takeLatest(loadPrompts.type, loadPromptsSaga),
    takeLatest(addPrompt.type, addPromptSaga),
    takeLatest(updatePrompt.type, updatePromptSaga),
    takeLatest(deletePrompt.type, deletePromptSaga),
  ]);
}

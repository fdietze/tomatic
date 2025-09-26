import { call, put, takeLatest, all } from "redux-saga/effects";
import { PayloadAction } from "@reduxjs/toolkit";
import { SystemPrompt } from "@/types/storage";
import * as db from "@/services/persistence";
import { createAppError, toAppError } from "@/types/errors";
import {
  loadPrompts,
  loadPromptsSuccess,
  loadPromptsFailure,
  addPromptRequest,
  addPromptSuccess,
  addPromptFailure,
  updatePromptRequest,
  updatePromptSuccess,
  updatePromptFailure,
  deletePromptRequest,
  deletePromptSuccess,
  deletePromptFailure,
} from "./promptsSlice";

function* loadPromptsSaga() {
  try {
    console.log('[DEBUG] loadPromptsSaga: starting to load system prompts');
    const prompts: SystemPrompt[] = yield call(db.loadAllSystemPrompts);
    console.log('[DEBUG] loadPromptsSaga: loaded prompts from DB:', prompts.map(p => ({ name: p.name, prompt: p.prompt })));
    yield put(loadPromptsSuccess(prompts));
    console.log('[DEBUG] loadPromptsSaga: dispatched loadPromptsSuccess');
  } catch (error) {
    console.log('[DEBUG] loadPromptsSaga: failed to load prompts:', error);
    yield put(loadPromptsFailure(createAppError.persistence("loadPrompts", "Failed to load prompts.")));
  }
}

function* addPromptSaga(action: PayloadAction<SystemPrompt>) {
  try {
    yield call(db.saveSystemPrompt, action.payload);
    yield put(addPromptSuccess(action.payload));
  } catch (e) {
    const error = toAppError(e);
    yield put(addPromptFailure({ name: action.payload.name, error }));
  }
}

function* updatePromptSaga(
  action: PayloadAction<{ oldName: string; prompt: SystemPrompt }>,
) {
  const { oldName, prompt } = action.payload;
  try {
    // If the name is changing, we need to delete the old one first.
    if (oldName !== prompt.name) {
      yield call(db.deleteSystemPrompt, oldName);
    }
    yield call(db.saveSystemPrompt, prompt);
    yield put(updatePromptSuccess({ oldName, prompt: prompt }));
  } catch (e) {
    const error = toAppError(e);
    // We pass the oldName so the reducer can find which prompt failed.
    yield put(updatePromptFailure({ name: oldName, error }));
  }
}

function* deletePromptSaga(action: PayloadAction<string>) {
  const name = action.payload;
  try {
    yield call(db.deleteSystemPrompt, name);
    yield put(deletePromptSuccess(name));
  } catch (e) {
    const error = toAppError(e);
    yield put(deletePromptFailure({ name, error }));
  }
}

export function* promptsSaga() {
  yield all([
    takeLatest(loadPrompts.type, loadPromptsSaga),
    takeLatest(addPromptRequest.type, addPromptSaga),
    takeLatest(updatePromptRequest.type, updatePromptSaga),
    takeLatest(deletePromptRequest.type, deletePromptSaga),
  ]);
}

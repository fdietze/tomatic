import { call, put, takeLatest, all, select, fork } from 'redux-saga/effects';
import { PayloadAction } from '@reduxjs/toolkit';
import { Snippet } from '@/types/storage';
import * as db from '@/services/db/snippets';
import {
  loadSnippets,
  loadSnippetsSuccess,
  loadSnippetsFailure,
  addSnippet,
  addSnippetSuccess,
  updateSnippet,
  updateSnippetSuccess,
  deleteSnippet,
  deleteSnippetSuccess,
  setRegenerationStatus,
  updateSnippetContent,
} from './snippetsSlice';
import { RootState } from '../../store';
import { buildReverseDependencyGraph, findTransitiveDependents } from '@/utils/snippetUtils';
import { streamChatResponse } from '@/services/chatService';

function* loadSnippetsSaga() {
  try {
    const snippets: Snippet[] = yield call(db.loadAllSnippets);
    yield put(loadSnippetsSuccess(snippets));
  } catch (_error) {
    yield put(loadSnippetsFailure('Failed to load snippets.'));
  }
}

function* addSnippetSaga(action: PayloadAction<Snippet>) {
  try {
    yield call(db.saveSnippet, action.payload);
    yield put(addSnippetSuccess(action.payload));
  } catch (error) {
    console.error('Failed to add snippet', error);
  }
}

function* updateSnippetSaga(action: PayloadAction<{ oldName: string; snippet: Snippet }>) {
  try {
    const { oldName, snippet } = action.payload;
    if (oldName !== snippet.name) {
      yield call(db.deleteSnippet, oldName);
    }
    yield call(db.saveSnippet, snippet);
    yield put(updateSnippetSuccess({ oldName, snippet }));
  } catch (error) {
    console.error('Failed to update snippet', error);
  }
}

function* deleteSnippetSaga(action: PayloadAction<string>) {
  try {
    yield call(db.deleteSnippet, action.payload);
    yield put(deleteSnippetSuccess(action.payload));
  } catch (error) {
    console.error('Failed to delete snippet', error);
  }
}

function* regenerateSnippetSaga(snippetName: string) {
    try {
        yield put(setRegenerationStatus({ name: snippetName, status: 'in_progress' }));

        const { snippets, settings, prompts }: { snippets: Snippet[], settings: RootState['settings'], prompts: RootState['prompts'] } = yield select((state: RootState) => ({
            snippets: state.snippets.snippets,
            settings: state.settings,
            prompts: state.prompts,
        }));

        const snippetToRegenerate = snippets.find(s => s.name === snippetName);

        if (!snippetToRegenerate || !snippetToRegenerate.isGenerated || !snippetToRegenerate.prompt || !snippetToRegenerate.model) {
            throw new Error('Invalid snippet for regeneration');
        }

        const { assistantResponse }: { assistantResponse: string } = yield call(streamChatResponse, {
            messages: [],
            prompt: snippetToRegenerate.prompt,
            modelName: snippetToRegenerate.model,
            apiKey: settings.apiKey,
            snippets: snippets,
            systemPrompts: prompts.prompts,
            selectedPromptName: null,
            isRegeneration: true,
        });

        yield put(updateSnippetContent({ name: snippetName, content: assistantResponse }));
        yield put(setRegenerationStatus({ name: snippetName, status: 'success' }));

    } catch (error) {
        yield put(setRegenerationStatus({ name: snippetName, status: 'error' }));
        console.error(`Failed to regenerate snippet ${snippetName}`, error);
    }
}

function* regenerationOrchestrationSaga(action: PayloadAction<{ oldName: string; snippet: Snippet }>) {
    const { snippets }: { snippets: Snippet[] } = yield select((state: RootState) => state.snippets);
    const reverseGraph = buildReverseDependencyGraph(snippets);
    const dependents = findTransitiveDependents(action.payload.snippet.name, reverseGraph);

    for (const dependentName of dependents) {
        const dependentSnippet = snippets.find(s => s.name === dependentName);
        if (dependentSnippet && dependentSnippet.isGenerated) {
            yield fork(regenerateSnippetSaga, dependentName);
        }
    }
}

export function* snippetsSaga() {
  yield all([
    takeLatest(loadSnippets.type, loadSnippetsSaga),
    takeLatest(addSnippet.type, addSnippetSaga),
    takeLatest(updateSnippet.type, updateSnippetSaga),
    takeLatest(deleteSnippet.type, deleteSnippetSaga),
    takeLatest(updateSnippetSuccess.type, regenerationOrchestrationSaga),
  ]);
}

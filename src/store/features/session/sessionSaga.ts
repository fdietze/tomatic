import { call, put, takeLatest, all, select, take } from 'redux-saga/effects';
import { PayloadAction } from '@reduxjs/toolkit';
import { Message, ChatSession } from '@/types/chat';
import * as db from '@/services/db/chat-sessions';
import {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  submitUserMessage,
  submitUserMessageSuccess,
  submitUserMessageFailure,
} from './sessionSlice';
import { RootState } from '../../store';
import { streamChatResponse } from '@/services/chatService';
import { getReferencedSnippetNames } from '@/utils/snippetUtils';
import { v4 as uuidv4 } from 'uuid';

function* loadSessionSaga(action: PayloadAction<string>) {
  try {
    const session: ChatSession | null = yield call(db.loadSession, action.payload);
    if (session) {
        const { prevId, nextId } = yield call(db.findNeighbourSessionIds, session);
        yield put(loadSessionSuccess({ messages: session.messages, sessionId: session.session_id, prevId, nextId }));
    } else {
        yield put(loadSessionFailure('Session not found.'));
    }
  } catch (_error) {
    yield put(loadSessionFailure('Failed to load session.'));
  }
}

function* submitUserMessageSaga(action: PayloadAction<string>) {
    try {
        const prompt = action.payload;
        const { settings, snippets: allSnippets, prompts, session } = yield select((state: RootState) => state);

        const referencedSnippets = getReferencedSnippetNames(prompt);
        const snippetsToWaitFor: string[] = [];
        for (const name of referencedSnippets) {
            if (allSnippets.regenerationStatus[name] === 'in_progress') {
                snippetsToWaitFor.push(name);
            }
        }

        if (snippetsToWaitFor.length > 0) {
            yield all(snippetsToWaitFor.map(name => take(
                (action: PayloadAction<{ name: string; status: string }>) => (action.type === 'snippets/setRegenerationStatus' && action.payload.name === name && action.payload.status !== 'in_progress')
            )));
        }

        const { assistantResponse, finalMessages } = yield call(streamChatResponse, {
            messages: session.messages,
            prompt,
            modelName: settings.modelName,
            apiKey: settings.apiKey,
            snippets: allSnippets.snippets,
            systemPrompts: prompts.prompts,
            selectedPromptName: settings.selectedPromptName,
            isRegeneration: false,
        });

        const assistantMessage: Message = {
            id: uuidv4(),
            role: 'assistant',
            content: assistantResponse,
            model_name: settings.modelName,
        };

        const newMessages = [...finalMessages, assistantMessage];

        yield put(submitUserMessageSuccess(newMessages));

        const currentSessionId = session.currentSessionId || uuidv4();
        const sessionToSave: ChatSession = {
            session_id: currentSessionId,
            messages: newMessages,
            created_at_ms: Date.now(),
            updated_at_ms: Date.now(),
            name: 'New Chat'
        };
        yield call(db.saveSession, sessionToSave);


    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        yield put(submitUserMessageFailure(errorMessage));
    }
}


export function* sessionSaga() {
  yield all([
    takeLatest(loadSession.type, loadSessionSaga),
    takeLatest(submitUserMessage.type, submitUserMessageSaga),
  ]);
}

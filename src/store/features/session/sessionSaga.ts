import { all, call, put, select } from "redux-saga/effects";
// req:saga-supervision: watcher helpers that contain worker failures
import { takeLatest } from "@/store/supervisedEffects";
import { PayloadAction } from "@reduxjs/toolkit";
import { SagaIterator } from "redux-saga";

import { ChatSession } from "@/types/chat";
import { Snippet, SystemPrompt } from "@/types/storage";
import * as db from "@/services/db/chat-sessions";
import { RootState } from "../../store";

import {
  goToNextSession,
  goToPrevSession,
  loadSession,
  loadSessionFailure,
  loadSessionSuccess,
  startNewSession,
  sendMessageRequested,
  editMessageRequested,
  regenerateResponseRequested,
  setSystemPromptRequested,
  setSystemPrompt,
  selectSession,
  setHasSessions,
  loadInitialSessionSaga as loadInitialSessionSagaAction,
  SessionState,
  setSessionError,
} from "./sessionSlice";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { setSelectedPromptName } from "@/store/features/settings/settingsSlice";
import { toAppError, createAppError } from "@/types/errors";
import { resolveSnippetReferences } from "@/utils/snippetUtils";
import { submitTurnSaga, TurnCommandAction } from "./submitTurnSaga";

// --- Helper Functions ---

// Helper function to initialize a new session with the global selected prompt
function* initializeNewSessionWithGlobalPrompt(): SagaIterator {
  // req:system-prompt-preservation
  const { settings, prompts }: RootState = yield select(
    (state: RootState) => state,
  );
  const globalSelectedPromptName = settings.selectedPromptName;

  if (globalSelectedPromptName) {
    const promptEntity = prompts.prompts[globalSelectedPromptName];
    if (promptEntity) {
      // When creating a new session, we must also dispatch `setSystemPromptRequested`
      // to ensure the system message is created with content.
      yield put(setSystemPromptRequested(promptEntity.data));
    }
  }
}

// --- Worker Sagas ---

// Saga to handle system prompt setting with snippet resolution
function* setSystemPromptRequestedSaga(action: PayloadAction<SystemPrompt>): SagaIterator {
  try {
    const prompt = action.payload;
    const snippets: Snippet[] = yield select((state: RootState) => state.snippets.snippets);
    // Resolve before touching state: if a snippet is missing, the chat keeps its previous system prompt.
    const resolvedPrompt = resolveSnippetReferences(prompt.prompt, snippets);
    yield put(setSystemPrompt({ name: prompt.name, rawPrompt: prompt.prompt, resolvedPrompt }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const appError = createAppError.unknown(`Failed to resolve system prompt: ${errorMessage}`);
    yield put(setSessionError(appError));
  }
}

function* goToPrevSessionSaga(): SagaIterator {
  const session: SessionState = yield select(selectSession);
  const navigationService = yield call(getNavigationService);
  if (session.prevSessionId) {
    yield call(
      [navigationService, navigationService.navigate],
      ROUTES.chat.session(session.prevSessionId),
    );
  } else if (!session.currentSessionId) {
    // If there's no current session, go to the most recent one.
    const mostRecentId: string | null = yield call(db.getMostRecentSessionId);
    if (mostRecentId) {
      yield call(
        [navigationService, navigationService.navigate],
        ROUTES.chat.session(mostRecentId),
      );
    }
  }
}

function* goToNextSessionSaga(): SagaIterator {
  const session: SessionState = yield select(selectSession);
  const navigationService = yield call(getNavigationService);
  if (session.nextSessionId) {
    yield call(
      [navigationService, navigationService.navigate],
      ROUTES.chat.session(session.nextSessionId),
    );
  }
}

function* loadSessionSaga(action: PayloadAction<string>) {
  if (action.payload === "new") {
    yield put(startNewSession());
    // Initialize new session with global selected prompt
    yield call(initializeNewSessionWithGlobalPrompt);
    return;
  }
  try {
    const session: ChatSession | null = yield call(
      db.loadSession,
      action.payload,
    );
    if (session) {
      // req:system-prompt-navigation-sync: Extract prompt_name from system message and update selected prompt
      const systemMessage = session.messages.find(m => m.role === "system");
      // The opened chat's prompt becomes the default for new chats.
      yield put(setSelectedPromptName(systemMessage?.prompt_name ?? null));
      const { prevId, nextId } = yield call(
        db.findNeighbourSessionIds,
        session,
      );
      yield put(
        loadSessionSuccess({
          messages: session.messages,
          sessionId: session.session_id,
          prevId,
          nextId,
        }),
      );
    } else {
      yield put(loadSessionFailure(createAppError.unknown("Session not found.")));
    }
  } catch (error) {
    yield put(loadSessionFailure(toAppError(error)));
  }
}

function* loadInitialSessionSaga(): SagaIterator {
  try {
    const hasSessions: boolean = yield call(db.hasSessions);
    yield put(setHasSessions(hasSessions));
  } catch (error) {
    // Handled degradation: hasSessions keeps its initial value, which only affects session navigation.
    console.log("[sessionSaga] Failed to check for stored sessions:", error);
  }
}

// --- Watcher Saga ---

export function* sessionSaga() {
  yield all([
    takeLatest(loadSession.type, loadSessionSaga),
    takeLatest(
      loadInitialSessionSagaAction.type,
      loadInitialSessionSaga,
    ),
    takeLatest(goToPrevSession.type, goToPrevSessionSaga),
    takeLatest(goToNextSession.type, goToNextSessionSaga),
    // A new command supersedes a running turn; the cancelled turn still stores what it received.
    takeLatest<TurnCommandAction>(
      [sendMessageRequested.type, editMessageRequested.type, regenerateResponseRequested.type],
      submitTurnSaga,
    ),
    takeLatest(setSystemPromptRequested.type, setSystemPromptRequestedSaga),
  ]);
}

import { call, put, select, takeLatest } from 'redux-saga/effects';
import { SagaIterator } from 'redux-saga';
import {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  startNewSession,
  setHasSessions,
  goToPrevSession,
  goToNextSession,
  selectScratchpad,
  type ScratchpadState,
} from './scratchpadSlice';
import {
  loadScratchpadSession,
  findNeighbourScratchpadIds,
  hasScratchpadSessions,
  getMostRecentScratchpadId,
} from '@/services/db/scratchpad-sessions';
import { createAppError } from '@/types/errors';
import { getNavigationService } from '@/services/NavigationProvider';
import { ROUTES } from '@/utils/routes';

export function* loadSessionWorker(action: ReturnType<typeof loadSession>) {
  const id = action.payload;
  try {
    const any = (yield call(hasScratchpadSessions)) as boolean;
    yield put(setHasSessions(any));
    if (id === 'new' || !id) {
      yield put(startNewSession());
      return;
    }
    const session = (yield call(loadScratchpadSession, id)) as Awaited<ReturnType<typeof loadScratchpadSession>>;
    if (!session) {
      yield put(startNewSession());
      return;
    }
    const nb = (yield call(findNeighbourScratchpadIds, session)) as { prevId: string | null; nextId: string | null };
    yield put(loadSessionSuccess({ session, prevId: nb.prevId, nextId: nb.nextId }));
  } catch (e) {
    yield put(loadSessionFailure(createAppError.unknown(String(e))));
  }
}

function* goToPrevWorker(): SagaIterator {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  // Retrieve navigation service at call time (populated by NavigationProvider on mount)
  const navigationService = getNavigationService();
  if (s.prevSessionId) {
    navigationService.navigate(ROUTES.scratchpad.session(s.prevSessionId));
    return;
  }
  if (!s.currentSessionId && s.hasSessions) {
    const id = (yield call(getMostRecentScratchpadId)) as string | null;
    if (id) {
      navigationService.navigate(ROUTES.scratchpad.session(id));
    }
  }
}

function* goToNextWorker(): SagaIterator {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  // Retrieve navigation service at call time (populated by NavigationProvider on mount)
  const navigationService = getNavigationService();
  if (s.nextSessionId) {
    navigationService.navigate(ROUTES.scratchpad.session(s.nextSessionId));
  }
}

export function* scratchpadSaga() {
  yield takeLatest(loadSession.type, loadSessionWorker);
  yield takeLatest(goToPrevSession.type, goToPrevWorker);
  yield takeLatest(goToNextSession.type, goToNextWorker);
}

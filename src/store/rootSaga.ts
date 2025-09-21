import { all, fork } from 'redux-saga/effects';
import { settingsSaga } from './features/settings/settingsSaga';
import { promptsSaga } from './features/prompts/promptsSaga';
import { modelsSaga } from './features/models/modelsSaga';
import { snippetsSaga } from './features/snippets/snippetsSaga';
import { sessionSaga } from './features/session/sessionSaga';

export default function* rootSaga() {
  yield all([
    fork(settingsSaga),
    fork(promptsSaga),
    fork(modelsSaga),
    fork(snippetsSaga),
    fork(sessionSaga),
  ]);
}

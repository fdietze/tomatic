import { all, fork } from "redux-saga/effects";
import { modelsSaga } from "./features/models/modelsSaga";
import { settingsSaga } from "./features/settings/settingsSaga";
import { sessionSaga } from "./features/session/sessionSaga";
import { promptsSaga } from "./features/prompts/promptsSaga";
import { snippetsSaga } from "./features/snippets/snippetsSaga";
import { appSaga } from "./features/app/appSaga";

export default function* rootSaga() {
  yield all([
    fork(modelsSaga),
    fork(settingsSaga),
    fork(sessionSaga),
    fork(promptsSaga),
    fork(snippetsSaga),
    fork(appSaga),
  ]);
}

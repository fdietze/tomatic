import { combineReducers } from "@reduxjs/toolkit";
import settingsReducer from "./features/settings/settingsSlice";
import sessionReducer from "./features/session/sessionSlice";
import modelsReducer from "./features/models/modelsSlice";
import promptsReducer from "./features/prompts/promptsSlice";
import snippetsReducer from "./features/snippets/snippetsSlice";
import appReducer from "./features/app/appSlice";

const rootReducer = combineReducers({
  settings: settingsReducer,
  session: sessionReducer,
  models: modelsReducer,
  prompts: promptsReducer,
  snippets: snippetsReducer,
  app: appReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;

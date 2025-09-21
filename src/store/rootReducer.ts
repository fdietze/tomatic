import { combineReducers } from '@reduxjs/toolkit';
import settingsReducer from './features/settings/settingsSlice';
import promptsReducer from './features/prompts/promptsSlice';
import modelsReducer from './features/models/modelsSlice';
import snippetsReducer from './features/snippets/snippetsSlice';
import sessionReducer from './features/session/sessionSlice';

const rootReducer = combineReducers({
  settings: settingsReducer,
  prompts: promptsReducer,
  models: modelsReducer,
  snippets: snippetsReducer,
  session: sessionReducer,
});

export default rootReducer;

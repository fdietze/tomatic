import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import rootReducer from "./rootReducer";
import rootSaga from "./rootSaga";

const sagaMiddleware = createSagaMiddleware();

let preloadedState;
try {
  const serializedState = localStorage.getItem("tomatic-storage");
  if (serializedState) {
    preloadedState = { settings: JSON.parse(serializedState).state };
  }
} catch (e) {
  console.error("Could not load state from local storage", e);
}

export const store = configureStore({
  reducer: rootReducer,
  preloadedState,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(sagaMiddleware),
});

sagaMiddleware.run(rootSaga);

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;

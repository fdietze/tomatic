import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import rootReducer from "./rootReducer";
import rootSaga from "./rootSaga";
import { localStorageSchema } from "@/services/persistence/schemas";

const sagaMiddleware = createSagaMiddleware();

let preloadedState;
try {
  const serializedState = localStorage.getItem("tomatic-storage");
  if (serializedState) {
    // Use Zod validation for type-safe localStorage parsing
    const parseResult = localStorageSchema.safeParse(JSON.parse(serializedState));
    if (parseResult.success) {
      // Preserve the original behavior - Redux handles partial state correctly
      preloadedState = { settings: parseResult.data.state };
    } else {
      console.log("Could not parse state from localStorage, using defaults:", parseResult.error.format());
      // Fallback to original unsafe parsing to maintain compatibility
      preloadedState = { settings: JSON.parse(serializedState).state };
    }
  }
} catch (e) {
  console.log("Could not load state from localStorage:", e);
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

import { describe, it, expect, vi, afterEach } from "vitest";
import createSagaMiddleware from "redux-saga";
import { configureStore } from "@reduxjs/toolkit";
import { takeEvery, takeLatest, debounce } from "./supervisedEffects";

type TestAction = { type: string };

function setupStoreRunning(watchers: () => Generator<unknown, void, unknown>) {
  const sagaMiddleware = createSagaMiddleware();
  const store = configureStore({
    reducer: (state: null = null) => state,
    middleware: (getDefault) => getDefault({ thunk: false }).concat(sagaMiddleware),
  });
  sagaMiddleware.run(watchers);
  return store;
}

describe("supervisedEffects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps all watchers alive when one worker throws", async () => {
    // Purpose: req:saga-supervision - an unhandled exception in one worker must not
    // terminate the saga tree; sibling watchers and the failing watcher keep working,
    // and the bug is reported via console.error.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handled: string[] = [];

    const store = setupStoreRunning(function* () {
      yield takeEvery("boom", function* boomWorker(_action: TestAction) {
        handled.push("boom");
        yield Promise.resolve();
        throw new Error("worker exploded");
      });
      yield takeLatest("ping", function* pingWorker(_action: TestAction) {
        handled.push("ping");
        yield Promise.resolve();
      });
    });

    store.dispatch({ type: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.dispatch({ type: "ping" });
    store.dispatch({ type: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handled).toEqual(["boom", "ping", "boom"]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain("boomWorker");
  });

  it("supervises debounced workers", async () => {
    // Purpose: req:saga-supervision - a throwing debounced worker is contained as well.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;

    const store = setupStoreRunning(function* () {
      yield debounce(1, "save", function* saveWorker(_action: TestAction) {
        calls += 1;
        yield Promise.resolve();
        throw new Error("save exploded");
      });
    });

    store.dispatch({ type: "save" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.dispatch({ type: "save" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toBe(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });
});

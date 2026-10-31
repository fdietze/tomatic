/**
 * Drop-in replacements for the redux-saga watcher helpers that contain worker failures.
 *
 * req:saga-supervision: in redux-saga, an exception escaping a forked worker propagates to its
 * parent and cancels every sibling, up to `rootSaga` (src/store/rootSaga.ts). One bug in one
 * worker would leave the whole app unresponsive until reload (Multiply by Zero). Wrapping every
 * worker isolates the failure to the one task that failed.
 *
 * Correctness by Construction: `.oxlintrc.json` forbids importing these helpers from
 * "redux-saga/effects", so every watcher in the app is supervised.
 */
import {
  call,
  debounce as rawDebounce,
  takeEvery as rawTakeEvery,
  takeLatest as rawTakeLatest,
} from "redux-saga/effects";
import type { ActionPattern, ForkEffect } from "redux-saga/effects";
import type { Action } from "@reduxjs/toolkit";

// As with redux-saga's own helpers, the pattern decides which actions reach a worker;
// the worker's declared action type is trusted, not checked against the pattern.
type Worker<A extends Action> = (action: A) => Iterator<unknown>;

export function takeEvery<A extends Action>(pattern: ActionPattern<A>, worker: Worker<A>): ForkEffect {
  return rawTakeEvery(pattern, supervise(worker));
}

export function takeLatest<A extends Action>(pattern: ActionPattern<A>, worker: Worker<A>): ForkEffect {
  return rawTakeLatest(pattern, supervise(worker));
}

export function debounce<A extends Action>(delay_ms: number, pattern: ActionPattern<A>, worker: Worker<A>): ForkEffect {
  return rawDebounce(delay_ms, pattern, supervise(worker));
}

function supervise<A extends Action>(worker: Worker<A>) {
  return function* supervised(action: A) {
    try {
      yield call(worker, action);
    } catch (error) {
      // An error reaching this point was not handled by the worker, so it is a bug.
      // console.error (not console.log) makes it fail the e2e suite (tests/fixtures.ts).
      console.error(`[saga] Unhandled error in ${worker.name || "anonymous worker"} for ${action.type}:`, error);
    }
  };
}

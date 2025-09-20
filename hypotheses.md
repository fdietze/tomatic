# Project Tomatic: Architectural Analysis & Refactoring Report (2025-09-18)

## 1. Executive Summary

A systematic debugging process has identified two failing unit tests that reveal a core architectural issue: the lack of a robust, event-driven mechanism for inter-actor state synchronization. The identified symptoms are a **race condition in a test for `sessionMachine`** and an **improper use of `always` transitions in `snippetsMachine`**.

The root cause is a deviation from idiomatic XState v5 patterns. The system relies on implicit state management rather than explicit, event-based communication. This leads to brittle orchestration logic and race conditions. This report outlines a plan to refactor towards a reactive, push-based architecture where actors subscribe to state changes, eliminating the need for polling (`getSnapshot()`) and making the system more robust and maintainable.

## 2. Identified Issues & Root Causes

### 2.1. Issue #1: Improper `always` Transition (`snippetsMachine.test.ts`)

*   **Symptom:** The test `spawns regeneration actors for all transitive dependents...` fails because it expects the machine to be in the `regenerating` state, but finds it in the `idle` state.
*   **Root Cause Analysis:** The `regenerating` state uses an `always` transition that checks `context.regeneratingSnippetNames.length === 0`. In a test environment, the mock child actors complete almost instantly. Their completion events trigger context updates, causing the `always` guard to immediately become true and transition the machine to `idle` before the test assertion can run.
*   **Architectural Flaw:** This is a classic anti-pattern. Orchestrating an unknown number of asynchronous child actors with a context-based `always` guard is inherently racy. The machine's state transitions should be driven by explicit completion events from the child actors, not by synchronously inspecting a context variable.

### 2.2. Issue #2: Test-Induced Race Condition (`sessionMachine.test.ts`)

*   **Symptom:** The test `should spawn a submission actor with the latest settings...` fails because it asserts that `submissionActor` is not null, but finds `null`.
*   **Root Cause Analysis:** The test correctly triggers the spawning of a `submissionActor`. However, the mock actor completes instantly, sends its result back to the `sessionMachine`, and is immediately cleaned up. The test's `vi.waitFor` asserts the state *after* this entire lifecycle is complete, leading to a false negative.
*   **Architectural Flaw:** While the immediate fix is to make the test check the intermediate state, this failure highlights a deeper issue. The test was originally written to guard against the `sessionMachine` using stale state from its dependencies (like `settingsMachine`). The previous solution involved polling with `getSnapshot()`, which is not idiomatic. The correct architecture should ensure the `sessionMachine` *always* has the latest state *pushed* to it, making such a test less complex.

## 3. Architectural Recommendations (Idiomatic XState v5)

### 3.1. Adopt a Reactive, Push-Based State Synchronization Model

The core of the refactoring is to move from a "pull" model (actors polling for state with `getSnapshot()`) to a "push" model (actors being notified of state changes).

*   **Problem:** Actors like `sessionMachine` need up-to-date state from `settingsMachine`, `promptsMachine`, etc., to perform their logic (e.g., making an API call with the correct model name). Polling for this state is inefficient and not in the spirit of the actor model.
*   **Recommendation (Event-Driven Synchronization):**
    1.  A top-level `rootMachine` will orchestrate all major actors.
    2.  When a dependency actor (e.g., `settingsMachine`) updates its state, it will send a notification event to the `rootMachine` (e.g., `{ type: 'SETTINGS_UPDATED', settings: ... }`).
    3.  The `rootMachine` will then forward this event to all other actors that need this information (e.g., `sessionMachine`, `snippetsMachine`).
    4.  Consumer actors (`sessionMachine`, `snippetsMachine`) will have handlers (`on: { SETTINGS_UPDATED: ... }`) to receive the new state and update their own context.
*   **Benefits:** This creates a fully reactive system. Actors are always in sync. There is no need for `getSnapshot()`, and the logic becomes clearer and less prone to race conditions.

### 3.2. Orchestrate Child Actors via Explicit Events

*   **Problem:** The `snippetsMachine` needs to wait for an unknown number of child actors to complete.
*   **Recommendation (Actor Lifecycle Management):**
    1.  The `snippetsMachine` will store the `ActorRef` of each spawned regeneration actor in its context (e.g., `context.regeneratingActors`).
    2.  The `always` transition will be removed.
    3.  The machine will transition out of the `regenerating` state only after it has received a completion/failure event from every actor it spawned. An action will remove the completed actor's `ActorRef` from the context, and a guarded transition will check if the `regeneratingActors` array is now empty.

## 4. Next Steps: Refactoring Plan

The next steps will be to implement this robust, event-driven architecture. This involves creating a new unit test to prove the `snippetsMachine` orchestration logic, refactoring the `snippetsMachine` itself, and then wiring up the inter-actor communication through the `rootMachine`. The flawed test in `sessionMachine` will also be fixed.

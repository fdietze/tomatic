# Hypotheses and Learnings (2025-09-17)

## 1. Confirmed Root Causes of 27 Test Failures

Through a systematic, three-iteration debugging protocol, the 27 test failures have been traced to four distinct, fundamental architectural flaws in the XState and React implementation. The application suffers from state synchronization issues, missing logic for complex asynchronous processes, incorrect UI updates, and flawed error handling.

### 1.1. Stale State in Actor Communication (Race Condition)

*   **Problem:** Actors are communicating by "pulling" state from other actors using `actor.getSnapshot()`. XState does not guarantee that a snapshot will be updated within the same synchronous execution block that an event is processed. An incoming event can therefore be handled using a stale copy of another actor's state.
*   **Symptom:** The `system-prompt-interaction.spec.ts` test fails because a regenerated API call is sent with the old model (`google/gemini-2.5-pro` instead of `openai/gpt-4o`). Debug logs confirmed that the `sessionMachine` received an event with the *correct* new settings, but when spawning the `chatSubmissionMachine`, it read stale data for `systemPrompts` and `snippets` from its actor references (`promptsActor.getSnapshot()`).
*   **Architectural Flaw:** This "pull" or "query" model for inter-actor state is the primary source of race conditions. A robust actor system must use a "push" model, where all necessary data for an action is passed *within* the event itself. This makes the action self-contained and eliminates the possibility of reading stale state from another machine's context.

### 1.2. Flawed Orchestration for Snippet Regeneration

*   **Problem:** The `snippetsMachine` correctly identifies dependent snippets and spawns `snippetRegenerationMachine` actors. However, its logic for processing the results is flawed. It waits for *all* actors to complete before transitioning to `idle` (`guard: ({ context }) => context.regenerationActors.length === 1`), preventing incremental UI updates. Even after the update, the UI fails to reflect the new snippet content.
*   **Symptom:** All tests related to automatic snippet regeneration fail. For example, `snippets-generated.spec.ts` shows that a dependent snippet's content is never updated in the UI, even though debug logs confirm the regeneration actor completed successfully with the new content and the machine's context was updated.
*   **Architectural Flaw:** The orchestration logic is incomplete and not reactive. It needs to process results as they arrive, immediately update its state, and correctly signal to the UI that a change has occurred. The current guard logic is a key part of the problem.

### 1.3. UI Component State Bug in Combobox

*   **Problem:** The `Combobox` component, used for model selection, fails to display model items when they are loaded asynchronously. Debug logs from the `modelsMachine` confirm that the list of models is fetched successfully. The bug is internal to the `Combobox` component's state management, which doesn't correctly react when its `items` prop changes from an empty array to a populated one after the API call finishes.
*   **Symptom:** Multiple tests across the suite that need to select a model fail with a timeout, waiting for a `model-combobox-item` that is never rendered in the DOM.
*   **Architectural Flaw:** A bug in the React component's effect/state handling prevents it from correctly reacting to asynchronous changes in its props.

### 1.4. Improper Error Handling

*   **Problem:** When an error is thrown during snippet resolution (e.g., snippet not found), the `chatSubmissionMachine` catches the `Error` object and places it directly into its context's `error` field. The UI then attempts to render this object.
*   **Symptom:** React logs the warning `Objects are not valid as a React child (found: [object Error])`, and tests like `snippets-system-prompts.spec.ts` fail because the expected error message is not displayed.
*   **Architectural Flaw:** Violation of React principles. State intended for rendering must be a primitive (like a string) or a valid React element. The error handling logic must serialize the error (e.g., by storing `error.message`) before putting it into the state.

## 2. Path Forward: A Type-Safe, Event-Driven Architecture

The initial refactoring attempt failed due to cascading type-safety issues. The debugging protocol has now confirmed that the architectural issues go beyond simple bugs and require a shift in the fundamental communication patterns between actors. The next phase will focus on designing and implementing a robust, event-driven, and fully type-safe XState architecture.

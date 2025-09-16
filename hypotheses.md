# Hypotheses and Learnings (2025-09-16)

## Update: `appMachine` Orchestration Failed, All Tests Failing

The attempt to fix the model-fetching logic by introducing a central `appMachine` has resulted in a catastrophic failure of the entire test suite. All 58 tests now fail, indicating a fundamental issue with the new architecture.

### Root Cause: Actor Lifecycle or Subscription Issue

*   **Problem:** The logs show that after the initial settings are loaded, the `appMachine` correctly transitions. However, it then receives a warning: `Event "xstate.snapshot.watchSettings" was sent to stopped actor "x:7 (x:7)". This actor has already reached its final state, and will not transition.` This indicates that the `appMachine` is trying to process a snapshot from the `settingsActor` *after* the `appMachine` itself has already terminated.
*   **Symptom:** The application hangs. Tests that interact with the UI, such as clicking buttons or filling inputs, time out because the application never reaches a stable, interactive state. Browser console logs show errors like `Cannot read properties of undefined (reading 'isInitializing')`, which confirms that the UI is attempting to render without a valid state snapshot from the actors, likely because the actors have stopped.
*   **Architectural Flaw:** The `fromObservable` actor used to watch the other service actors is not behaving as expected. The `appMachine` should be a long-running process that continually observes the other actors. Instead, it appears to be receiving one snapshot, processing it, reaching its own final `ready` state, and then stopping. When the `settingsActor` emits another snapshot change later, the `appMachine` is no longer alive to receive it, causing the warning. This is a critical misunderstanding of how to orchestrate persistent actors in XState v5.

### Path Forward: Re-architect Actor Orchestration

The current implementation is fundamentally flawed. We must redesign how the global actors are initialized and how they communicate.

1.  **Remove `appMachine`:** The current implementation is incorrect and should be removed.
2.  **Centralize Initialization in `GlobalStateProvider`:** Revert to the previous, more pragmatic plan. The `GlobalStateProvider` is the correct place to manage the startup logic.
3.  **Use `useEffect` with Subscriptions:** The provider will contain a `useEffect` hook that subscribes to the `settingsActor`. When the settings have loaded (i.e., `isInitializing` is false), it will check for an API key. If a key exists and models have not yet been loaded, it will dispatch the `FETCH` event to the `modelsActor`.
4.  **Correct the UI Loading State:** The `App.tsx` component will derive its loading state from a combination of `settingsActor.isInitializing` and `modelsActor.modelsLoading`. This ensures the UI waits for all critical data to be loaded before rendering the main content.

This revised approach abandons the complex and incorrectly implemented `appMachine` in favor of a simpler, more direct orchestration pattern within the React context provider, which should be more reliable and easier to debug.

---

<details>
<summary>Click to see previous analysis</summary>

## Update: Model Fetching Logic is Flawed, Causing Widespread Test Failures

Systematic debugging of the 22 failing tests has revealed a critical architectural flaw in how the application fetches the list of available AI models. This single issue is the root cause for the majority of failures in `snippets-*.spec.ts` tests.

### Root Cause: Page-Specific Model Fetching

*   **Problem:** The logic responsible for fetching the list of available models from the OpenRouter API is located exclusively within the `ChatInterfaceContents.tsx` component. This component is only rendered on the chat page (`/chat/...`).
*   **Symptom:** When a test navigates directly to the settings page (`/settings`), as many snippet-related tests do, the model fetching logic is never triggered. The global `modelsActor` remains in its initial state with an empty `cachedModels` array.
*   **Cascade Failure:** The `Combobox` component used for selecting a model within the snippet editor on the settings page receives an empty list of models. Consequently, when Playwright attempts to select a model (e.g., `mock-model/mock-model`), the corresponding DOM element does not exist, leading to a timeout and test failure. This single issue accounts for at least 8 test failures in `snippets-editor.spec.ts`, `snippets-error-handling.spec.ts`, and `snippets-generated.spec.ts`.
*   **Architectural Flaw:** This represents a violation of responsibility. Core application data, such as the list of available models, should be loaded globally as part of the application's initialization sequence, not tied to the lifecycle of a specific page component.

### Path Forward: Centralize Initialization Logic

The solution is to move the model-fetching logic to a central location that runs once when the application starts.

1.  **`GlobalStateProvider.tsx` or `App.tsx`:** The logic to check for an API key and fetch the models should be moved here. This will ensure that the `modelsActor` is populated with data as soon as the application loads, regardless of the initial route.
2.  **Component Responsibility:** The UI components (`ChatInterfaceContents.tsx`, `SnippetItem.tsx`) should only be responsible for *displaying* the model list and sending user events, not for triggering the initial data load.

This change will fix the cascading test failures and create a more robust startup sequence where essential data is loaded predictably. After this is fixed, the remaining test failures can be analyzed without the noise from these model-loading issues.

---

<details>
<summary>Click to see previous analysis</summary>

## Update: Snippet Resolution Refactor Successful

The architectural refactor to fix snippet resolution has been successfully implemented and verified. All 4 tests in `snippets-system-prompts.spec.ts` now pass, and the total number of failing tests in the suite has been reduced from 23 to 22.

### Root Cause & Solution Confirmation

*   **Problem:** The root cause was a violation of separation of concerns. The `sessionMachine` was prematurely creating a `system` message with raw, unresolved snippet content. This caused the `chatService`, which contains the correct resolution logic, to be bypassed when the first user message was sent.
*   **Solution:** The implementation followed the architectural plan precisely:
    1.  The `sessionMachine` was refactored to no longer be responsible for creating the initial system prompt. Its `START_NEW_SESSION` action now only clears the session history.
    2.  The UI layer (`ChatPage.tsx` and `ChatInterfaceContents.tsx`) was updated to derive the selected system prompt from the `settingsActor` and render it directly for new chats. This ensures immediate user feedback.
    3.  The `chatService.ts` was left unchanged, as its logic was already correct. By ensuring it receives an empty message list for new chats, its system prompt resolution logic is now correctly triggered.
*   **Result:** This new data flow is more robust and maintainable. The `sessionMachine` purely manages session state, the `chatService` is the single source of truth for API payload construction, and the UI handles its own presentational concerns.

### Path Forward: Address Remaining Failures

With the snippet resolution logic now stable, the next step is to apply the debugging protocol to the remaining 22 test failures. A preliminary analysis suggests these failures are concentrated in more complex, asynchronous scenarios, such as:

*   Automatic snippet regeneration chains.
*   Error handling for timeouts and failed API calls during regeneration.
*   Edge cases in the migration scripts.

These will be the focus of the next development cycle.

---

<details>
<summary>Click to see previous analysis</summary>

## Update: Confirmed Root Cause of Snippet Resolution Failure

Through systematic debugging, the root cause of the 23 test failures has been definitively traced to a state management issue between the `sessionMachine` and the `chatService`. The snippet resolution logic itself is correct, but it is being bypassed under specific conditions.

### Root Cause: Premature System Prompt Creation

*   **Problem:** When a new chat is started with a system prompt containing a snippet (e.g., `You are a @character.`), the `sessionMachine` immediately creates a `system` message with the *raw, unresolved* content and adds it to its state.
*   **Symptom:** When the user sends their first message, the `chatService` receives a message list that is no longer empty. Its logic block for resolving the system prompt (`if (messages.length === 0 && systemPrompt)`) is therefore skipped. The service proceeds to send the initial, unresolved system prompt along with the new user message to the API. This causes the API mocker in the tests to fail, as it expects the fully resolved prompt content (e.g., `"You are a helpful assistant."`).
*   **Architectural Flaw:** This represents a violation of separation of concerns. The `sessionMachine` should not be responsible for the business logic of resolving snippets; its role is to manage the raw state of the chat session. The `chatService` should be the single source of truth for preparing and resolving the final payload sent to the API.

### Path Forward: Refactor State Management

The solution is not to make the `sessionMachine` snippet-aware, but to refactor the data flow to respect the separation of concerns.

1.  **`sessionMachine`:** Should revert to only managing the list of raw user and assistant messages for a given session. It should not create the system prompt message itself.
2.  **`ChatPage.tsx` / UI Layer:** The UI should continue to derive the *selected* system prompt from the `settingsActor` and the chat history from the `sessionActor`.
3.  **`chatService.ts`:** Must be the single place where the final message list for the API is constructed. It will receive the raw chat history, the selected system prompt, and all snippets, and it will be responsible for resolving any snippets in the system prompt *and* the user prompt before making the API call.

This change will fix the immediate bug and create a more robust, maintainable architecture where data transformation logic is centralized in the appropriate service.

---

<details>
<summary>Click to see previous analysis</summary>

## Update: Corrected Snippet Logic, Awaiting Verification

Analysis of the test logs for `snippets-system-prompts.spec.ts` revealed a logic flaw in `src/services/chatService.ts`. The service was correctly resolving snippets and adding the system prompt to a local message array, but this updated array was not being passed to the final API call.

### Root Cause: Incorrect Message Array Usage

*   **Problem:** In `streamChatResponse`, when a new chat session was started, the system prompt was added to the `messagesToSubmit` array. However, in the non-regeneration branch of the logic, the final API call was implicitly still using a version of the message list that did not contain the system prompt.
*   **Symptom:** The `ChatCompletionMocker` received a request without the system prompt, causing a mismatch with the test's expected payload, which *did* include the resolved system prompt.
*   **Solution:** A new variable, `finalMessagesToSubmit`, was introduced to explicitly capture the fully processed list of messages (including the system prompt). This variable is now consistently used for the `requestMessageContent` API call, ensuring the correct payload is always sent.

### Path Forward: Verification

The fix has been implemented. The next step is to re-run the `snippets-system-prompts.spec.ts` test suite to verify that this logic correction resolves the failures. If successful, the full test suite (`just check`) will be run to assess the impact on the remaining test failures.

---

<details>
<summary>Click to see previous analysis</summary>

## Update: Snippet Resolution Logic Failing After `sessionMachine` Fix

The `sessionMachine` crash has been successfully resolved by correctly wrapping its async actors with `fromPromise`. This has fixed 2 critical tests and stabilized the application, allowing a deeper set of bugs to surface. The number of failing tests has been reduced from 26 to 24.

### Current State: Snippet Resolution is Broken

*   **Problem:** Analysis of the remaining 24 test failures reveals a clear pattern: the application's snippet resolution mechanism is not functioning. In multiple tests, the chat submission logic sends raw, unresolved snippet names (e.g., `"You are a @character."`) to the OpenAI API. The test mocks, which expect fully resolved content (e.g., `"You are a helpful assistant."`), correctly fail the tests by reporting an "Unexpected API call".
*   **Symptom:** The majority of failing tests are in `snippets-*.spec.ts` files, and the primary error is from the `ChatCompletionMocker` in `test-helpers.ts`, indicating a mismatch between the expected and actual API requests.
*   **Hypothesis:** The logic responsible for resolving snippet content, likely within the `chatSubmissionMachine` or a service it calls, is either being skipped or is failing silently. This causes the application to proceed with an incorrect request payload, leading to widespread test failures. The next debugging phase must focus on tracing the snippet resolution pathway, starting from the moment a user submits a prompt containing a snippet.

---

## Update: `sessionMachine` Fails to Load, Causing Widespread Test Failures

Following the debugging protocol, a root cause for 26 failing tests has been identified in `sessionMachine.ts`. The machine fails during its loading state, which prevents any chat session from being correctly initialized and causes a cascade of failures across all dependent tests.

### `sessionMachine` Actor Misconfiguration (Root Cause)

*   **Problem:** Similar to a previous bug in `promptsMachine`, the actors for `loadSession` and `saveSession` inside `src/machines/sessionMachine.ts` were defined as raw `async` functions. XState v5's `invoke` requires promise-based actors to be created using the `fromPromise` helper. This misconfiguration causes a runtime error (`this.logic.getInitialSnapshot is not a function`) deep inside XState's internals whenever the machine tries to invoke `loadSession`, leading the machine to an error state immediately.
*   **Symptom:** Tests that rely on loading a chat session (e.g., `session-navigation.spec.ts`, `snippets-chat-edit.spec.ts`, and many others) fail because the session data is never loaded. The browser console log for these tests consistently shows the "getInitialSnapshot is not a function" error.
*   **Hypothesis:** Correctly wrapping the `loadSession` and `saveSession` actors with `fromPromise` will fix the machine's primary state transition bug. This should resolve the majority of the 26 test failures, allowing us to see the true state of the application and uncover any subsequent issues.

---

## Proposed XState v5 Application Architecture

This document outlines a robust, type-safe, and scalable state management architecture for the application using XState v5, based on the actor model. The goal is to eliminate entire classes of bugs (race conditions, stale state) by making state transitions explicit and manageable.

### Architectural Overview

The architecture consists of several long-running "service" actors that manage global state (settings, prompts, snippets, models) and a central `sessionActor` that orchestrates the primary user experience of a chat session. The `sessionActor` spawns short-lived actors (`chatSubmissionActor`) to handle specific, complex, asynchronous tasks like fetching a response from the AI.

This separation of concerns ensures that each part of the application state is managed by a dedicated machine, making the logic easier to understand, test, and maintain.

### Mermaid Diagram

```mermaid
graph TD
    subgraph UI Layer (React)
        UI_ChatPage["ChatPage"]
        UI_SettingsPage["SettingsPage"]
        UI_Components["...other components"]
    end

    subgraph Global Services (Singleton Actors)
        A1[settingsActor]
        A2[promptsActor]
        A3[snippetsActor]
        A4[modelsActor]
    end

    subgraph Core Logic
        A5[sessionActor]
    end

    subgraph Ephemeral Actors (Spawned)
        A6[chatSubmissionActor]
    end

    %% UI to Actor Connections
    UI_ChatPage -- "useSelector(sessionActor, ...)\nsessionActor.send(...)" --> A5
    UI_SettingsPage -- "useSelector(promptsActor, ...)\npromptsActor.send(...)" --> A2
    UI_SettingsPage -- "useSelector(snippetsActor, ...)\nsnippetsActor.send(...)" --> A3
    UI_Components -- "useSelector(settingsActor, ...)\nsettingsActor.send(...)" --> A1
    UI_Components -- "useSelector(modelsActor, ...)\nmodelsActor.send(...)" --> A4

    %% Actor to Actor Connections
    A5 -- "Spawns/Stops" --> A6
    A6 -- "Sends UPDATE_MESSAGES/SUBMISSION_ERROR" --> A5
    A5 -- "Reads state from" --> A1
    A5 -- "Reads state from" --> A2
    A5 -- "Reads state from" --> A3
    A3 -- "Updates trigger transitive regenerations" --> A3

    %% Descriptions
    click A1 callback "settingsActor States: loading, idle, failure. Manages API key, model, etc. Persists to LocalStorage."
    click A2 callback "promptsActor States: loading, idle, CRUD states. Manages System Prompts. Persists to IndexedDB."
    click A3 callback "snippetsActor States: loading, idle, CRUD states, generating. Manages Snippets. Persists to IndexedDB. Orchestrates background snippet regeneration."
    click A4 callback "modelsActor States: idle, loading. Fetches and caches available models from OpenRouter API."
    click A5 callback "sessionActor States: idle, loading, processingSubmission. Manages the current chat session's messages. Spawns submission actors."
    click A6 callback "chatSubmissionActor (spawned) States: composingMessage, streamingResponse, failure. Handles a single chat API request lifecycle. Sends result back to parent sessionActor."

```

### How it's Connected to the UI

1.  **Provider:** A `GlobalStateProvider` instantiates all the singleton service actors (`settings`, `prompts`, `snippets`, `models`) and the main `sessionActor` using `createActor().start()`. These actor references are made available to the entire component tree via React Context.
2.  **Reading State:** UI components use the `useSelector` hook to subscribe to specific slices of an actor's state. This is highly efficient, as components only re-render when the selected state actually changes. For example: `const messages = useSelector(sessionActor, (state) => state.context.messages);`
3.  **Sending Events:** UI components dispatch events to the actors to trigger state transitions using the `.send()` method. For example: `sessionActor.send({ type: 'SUBMIT', prompt: 'Hello!' });`

This pattern cleanly separates the "view" (React components) from the "logic" (XState machines). The UI becomes a reactive representation of the application's state, and all business logic is encapsulated, tested, and visualized within the state machines.

### Key Decisions to Make

1.  **Actor Communication:**
    *   **Current:** The `sessionActor` receives other actors as `input`. When it needs data (e.g., the current API key), it directly inspects the snapshot of the other actor (`settingsActor.getSnapshot().context.apiKey`). This is a "pull" or "query" model.
    *   **Alternative (Push):** Actors could subscribe to each other's state changes using `actor.subscribe()`. Or, actors could `send` events to other actors when their state changes.
    *   **Recommendation:** The current "pull" model is simpler and often sufficient. For cases where one actor needs to react to a change in another (e.g., `snippetsActor` updates triggering regeneration), the logic should be handled *within* the responsible actor (`snippetsActor` should manage its own regeneration logic internally when its data changes).

2.  **State Granularity:**
    *   **Question:** Should we have one giant `appMachine` that orchestrates everything, or multiple smaller, specialized machines?
    *   **Recommendation:** The proposed architecture of multiple, specialized actors is more idiomatic for XState v5 and scales better. It aligns with the Single Responsibility Principle and makes the system easier to reason about.

3.  **Error Handling & UI Feedback:**
    *   **Question:** How should errors from a background actor (e.g., `snippetsActor` failing to regenerate a snippet) be communicated to the user?
    *   **Recommendation:** Each actor should manage its own error state within its context (e.g., `snippetsActor.context.regenerationErrors`). The UI can then use `useSelector` to read this error state and display appropriate feedback (e.g., a toast notification or an error message next to the specific snippet). The `sessionActor` should also check for errors in dependent actors before initiating actions; for example, it should refuse to submit a chat if the referenced snippets have regeneration errors.

4.  **Type Safety:**
    *   **Question:** How do we ensure end-to-end type safety?
    *   **Recommendation:** This architecture is designed for type safety. By defining all context, events, and inputs with TypeScript interfaces and using XState's built-in type generation (`SnapshotFrom`, `ActorRefFrom`), the TypeScript compiler can validate all state transitions and interactions between actors and the UI, catching bugs at compile time instead of runtime. The "poisonous `any`" problem described in `xstate.spec.md` is a direct result of incorrect machine setup, which this architecture, when implemented correctly with full type definitions, will solve.

---

## Update: `promptsMachine` Fixed, New Rendering Bug Uncovered

The previous hypothesis regarding a race condition or a stopped actor in `promptsMachine` was incorrect. The root cause was a fundamental misconfiguration of the actors within the machine's definition.

### `promptsMachine` Actor Misconfiguration (Root Cause & Solution)

*   **Problem:** The actors (`loadSystemPrompts`, `addPrompt`, etc.) inside `promptsMachine.ts` were defined as simple functions. XState's `invoke` requires actors to be created using helpers like `fromPromise`. This misconfiguration caused a runtime error (`this.logic.getInitialSnapshot is not a function`) deep inside XState's internals whenever the machine tried to invoke an actor, leading the machine to enter its `failure` state immediately.
*   **Solution:**
    1.  **Use `fromPromise`:** All actor definitions in `src/machines/promptsMachine.ts` were wrapped with the `fromPromise` helper.
    2.  **Correct Input Mapping:** The `invoke` configurations were updated to use the `input` property to correctly map data from the triggering event to the actor.
*   **Result:** The `promptsMachine` is now stable and correctly loads data from the database. This has fixed the majority of test failures in `tests/chat-interaction.spec.ts`.

### Path Forward: Debugging React "key" Prop Warning

With the state machine layer now functioning correctly, a new failure has been revealed in the UI layer.

*   **Test:** `shows system prompt immediately in a new chat`
*   **Symptom:** The test now fails with a React warning: `Each child in a list should have a unique "key" prop`. The test setup correctly treats this warning as a test failure.
*   **Hypothesis:** The component responsible for rendering chat messages (likely `ChatInterfaceContents.tsx`) is mapping over the messages array to create list items but is failing to assign a unique `key` prop to each rendered message component. This is a common React issue that needs to be fixed to ensure efficient and predictable rendering.

---

<details>
<summary>Click to see previous analysis</summary>

### OLD: System Prompt Failures in `settings.spec.ts` (RESOLVED)

The architectural refactoring was successful. All tests in `tests/settings.spec.ts` now pass.

#### `promptsMachine` Architecture Flaw (Root Cause & Solution)

*   **Problem:** The `promptsMachine` and `snippetsMachine` were being instantiated using the `useMachine` hook, which tied their lifecycle to the React component. This caused them to terminate prematurely after their initial data load, making them unable to process subsequent UI events for creating, updating, or deleting prompts.
*   **Solution:**
    1.  **Persistent State Machines:** The `idle` states in `promptsMachine.ts` and `snippetsMachine.ts` were modified to remove the `type: 'final'` property, converting them into long-running services.
    2.  **Singleton Actor Instantiation:** The `GlobalStateProvider` was refactored to use `createActor` to instantiate each global machine as a singleton service outside the React component lifecycle. The `useEffect` hook that dispatches the initial `LOAD` events was also updated to remove its dependencies, as the actors are now stable singletons.
*   **Result:** The state machines now persist for the application's entire lifecycle, reliably processing all events from the settings page. The application is stable, and the full test suite for system prompts passes.

</details>
</details>
</details>
</details>
</details>

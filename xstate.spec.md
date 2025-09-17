# Technical Specification: XState Architecture Refinements

## 1. Overview & Goal

Our debugging protocol has successfully identified four distinct root causes for all 28 failing tests. The initial migration to XState was structurally sound but contained architectural flaws that led to race conditions, missing functionality, and UI state synchronization bugs.

**The goal of this refactoring is to address these specific flaws by implementing a more robust, idiomatic XState v5 architecture. This will fix all known bugs and create a fully type-safe, maintainable, and scalable state management system.**

## 2. Current State: Architecturally Flawed but Well-Understood

The application is in a non-production state with 28 failing tests. However, we have a precise understanding of why each test is failing. The problems are not in business logic (e.g., snippet resolution) but in the "plumbing" of the actor model and its interaction with the UI and type system.

### Key Findings
*   **Stale State Race Conditions:** The use of a "pull" model for inter-actor communication (`actor.getSnapshot()`) is the primary source of bugs.
*   **Missing Orchestration Logic:** The `snippetsActor` lacks the necessary logic to manage the multi-step, asynchronous regeneration of dependent snippets.
*   **UI Component Bug:** The `Combobox` component has an internal state bug that prevents it from reacting correctly to asynchronously loaded props.
*   **Duplicate React Keys:** A static string is being used as a key for user messages.

## 3. Path Forward: A Type-Safe, Incremental Refactoring

The initial refactoring attempt failed due to cascading type-safety issues. The next step is to implement the same architectural improvements, but with a renewed focus on a deliberate, incremental approach that prioritizes satisfying the TypeScript compiler at each step.

## 4. The Type-Safety Challenge

Achieving 100% type safety with XState v5 in a complex actor model is a significant challenge that the previous implementation attempt underestimated. The core issues stem from the difficulty of getting TypeScript to correctly infer the complex, generic types that XState uses internally, especially across machine boundaries.

### Core Challenges Identified:
1.  **Accessing Machine `input`:** The correct pattern for an action to access the static `input` a machine was created with is not `self.getSnapshot().input`. This is often not available on the type level. The reliable pattern is to pass the input from the `invoke`'s `input` mapper to the invoked actor or action.
2.  **Spawning Actors:** The `spawn` function's type inference is difficult to satisfy when spawning machines that have complex `input` or `context`. Explicitly typing the returned actors and storing them in the context requires careful definition and exporting of actor types from each machine file (e.g., `export type MyActor = EmittedFrom<typeof myMachine>`).
3.  **Event-Carried State:** While architecturally correct, this pattern increases the surface area for type mismatches between the UI layer dispatching the event and the machine actor receiving it.

### Revised Strategy: Machine by Machine
The refactoring will proceed machine by machine. For each machine, the following steps will be taken *in order*:
1.  **Define Strict Types:** Explicitly define and export the `Context`, `Event`, `Input`, and `Emitted` types for the machine. Remove all `types: {} as ...` casts.
2.  **Refactor Logic:** Implement the required architectural changes (e.g., event-carried state, orchestration logic).
3.  **Achieve Type Compilation:** Ensure the individual machine file compiles with `tsc --noEmit` without errors before proceeding.
4.  **Address Upstream Errors:** After a machine is fully typed, fix the type errors that will appear in the parent machines or UI components that interact with it.
5.  **Run Tests:** Run the full test suite (`just check`) only after a complete vertical slice (from UI to machine) is fully typed and compiling.

This methodical approach will allow us to tackle the type complexity in manageable chunks and ensure that we are building a robust, maintainable system.

### xstate typescript best practices

Follow these guidelines to ensure that your TypeScript project is ready to use XState v5:

## Set up your `tsconfig.json` file

- Set [`strictNullChecks`](https://www.typescriptlang.org/tsconfig#strictNullChecks) to `true` in your `tsconfig.json` file. This will ensure that our types work correctly and help catch errors in your code. **(Strongly recommended)**.
- Set [`skipLibCheck`](https://www.typescriptlang.org/tsconfig#skipLibCheck) to `true` in your `tsconfig.json` file. (Recommended).

```json5
// tsconfig.json
{
  compilerOptions: {
    // ...
    // highlight-next-line
    strictNullChecks: true,
    // or set `strict` to true, which includes `strictNullChecks`
    // "strict": true,

    // highlight-next-line
    skipLibCheck: true,
  },
}
```

## Specifying types

The recommended way to strongly type your machine is to use the `setup(...)` function:

```ts
import { setup } from 'xstate';

const feedbackMachine = setup({
  types: {
    context: {} as { feedback: string },
    events: {} as { type: 'feedback.good' } | { type: 'feedback.bad' },
  },
  actions: {
    logTelemetry: () => {
      // TODO: implement
    },
  },
}).createMachine({
  // ...
});
```

You can also specify TypeScript types inside the [machine config](machines.mdx) using the `.types` property:

```ts
import { createMachine } from 'xstate';

const feedbackMachine = createMachine({
  types: {} as {
    context: { feedback: string };
    events: { type: 'feedback.good' } | { type: 'feedback.bad' };
    actions: { type: 'logTelemetry' };
  },
});
```

These types will be inferred throughout the machine config and in the created machine and actor so that methods such as `machine.transition(...)` and `actor.send(...)` will be type-safe.

## Dynamic parameters

It is recommended to use dynamic parameters in [actions](./actions.mdx) and [guards](./guards.mdx) as they allow you to make reusable functions that are not closely tied to the machine, and are strongly-typed.

```ts
import { setup } from 'xstate';

const feedbackMachine = setup({
  types: {
    context: {} as {
      user: { name: string };
    },
  },
  actions: {
    greet: (_, params: { name: string }) => {
      console.log(`Hello, ${params.name}!`);
    },
  },
}).createMachine({
  context: {
    user: {
      name: 'David',
    },
  },
  // ...
  entry: {
    type: 'greet',
    params: ({ context }) => ({
      name: context.user.name,
    }),
  },
});
```

## Asserting events

### Actions and Guards

:::info

It is strongly recommended to use dynamic parameters instead of directly accessing the event object whenever possible for improved type safety and reusability.

:::

If using dynamic parameters is infeasible and you must use the event in an action or guard implementation, you can assert the event type using the `assertEvent(...)` helper function:

```ts
import { createMachine, assertEvent } from 'xstate';

const machine = createMachine({
  types: {
    events: {} as
      | { type: 'greet'; message: string }
      | { type: 'log'; message: string }
      | { type: 'doSomethingElse' },
  },
  // ...
  states: {
    someState: {
      entry: ({ event }) => {
        // In the entry action, it is currently not possible to know
        // which event this action was called with.

        // Calling `assertEvent` will throw if
        // the event is not the expected type.
        // highlight-next-line
        assertEvent(event, 'greet');

        // Now we know the event is a `greet` event,
        // and we can access its `message` property.
        console.log(event.message.toUpperCase());
      },
      // ...
      exit: ({ event }) => {
        // You can also assert multiple possible event types.
        // highlight-next-line
        assertEvent(event, ['greet', 'log']);

        // Now we know the event is a `greet` or `log` event,
        // and we can access its `message` property.
        console.log(event.message.toUpperCase());
      },
    },
  },
});
```

### Invoked Actor Input

Another case where it helpful to use `assertEvent` is when specifying `input` for an invoked actor. The `event` received could be any one of the events received by that actor. In order for TypeScript to recognize the event type and its properties, you can use `assertEvent` to narrow down the event type.

```ts
import { createMachine, assertEvent } from 'xstate';

const machine = createMachine({
  types: {
    events: {} as
      | { type: 'messageSent'; message: string }
      | { type: 'incremented'; count: number },
  },
  actors: {
    someActor: fromPromise<void, { message: string }>(({ input }) => {
      // actor implementation
    }),
  }
  // ...
  states: {
    someState: {
      invoke: {
        src: 'someActor',
        input: ({ event }) => {
          // highlight-next-line
          assertEvent(event, 'messageSent');

          return { message: event.message };
        },
      },
    },
  },
});
```

## Type helpers

XState provides some type helpers to make it easier to work with types in TypeScript.

### `ActorRefFrom<T>`

Results in an `ActorRef` from the provided `T` actor logic parameter, which is useful for creating strongly-typed actors. The `T` parameter can be any `ActorLogic`, such as the return value of `createMachine(…)`, or any other actor logic, such as `fromPromise(…)` or `fromObservable(…)`.

```ts
import { type ActorRefFrom } from 'xstate';
import { someMachine } from './someMachine';

type SomeActorRef = ActorRefFrom<typeof someMachine>;
```

### `SnapshotFrom<T>`

Results in a `Snapshot` from the provided `T` parameter, which is useful for creating strongly-typed snapshots. The `T` parameter can be any `ActorLogic` or `ActorRef`.

```ts
import { type SnapshotFrom } from 'xstate';
import { someMachine } from './someMachine';

type SomeSnapshot = SnapshotFrom<typeof someMachine>;
```

### `EventFromLogic<T>`

Results in an union of all event types defined in the provided `T` actor logic parameter. Useful for type-safe event handling.

```ts
import { type EventFromLogic } from 'xstate';
import { someMachine } from './someMachine';

// SomeEvent would be a union of all event
// types defined in `someMachine`.
type SomeEvent = EventFromLogic<typeof someMachine>;
```

## Typegen

[Typegen](/docs/developer-tools#xstate-typegen-files) does not yet support XState v5. However, with the `setup(...)` function and/or the `.types` property explained above, you can provide strong typing for most (if not all) of your machine.

If you were previously using typegen to narrow down events used in actions or guards, you can use [the `assertEvent(...)` helper function](#asserting-events) to narrow down the event type.

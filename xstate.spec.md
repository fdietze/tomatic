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

# we use xstate v5. use the latest v5 syntax.

---
title: 'Migrating from XState v4 to v5'
---

The guide below explains how to migrate from XState version 4 to version 5. Migrating from XState v4 to v5 should be a straightforward process. If you get stuck or have any questions, please reach out to the Stately team on [our Discord](https://discord.gg/xstate).

:::new

Read [David’s blog post on the launch of XState v5](/blog/2023-12-01-xstate-v5).

:::

This guide is for developers who want to update their codebase from v4 to v5 and should also be valuable for any developers wanting to know the differences between v4 and v5.

:::video

Prefer video? [Watch our XState v5 webinar on YouTube](https://www.youtube.com/live/TRVjeil-y74).

:::

## XState v5 and TypeScript

XState v5 and its related libraries are written in TypeScript, and utilize complex types to provide the best type safety and inference possible for you. **XState v5 requires TypeScript version 5.0 or greater.** For best results, use the latest TypeScript version.

Follow these guidelines to ensure that your TypeScript project is ready to use XState v5:

- Use the latest version of TypeScript, version 5.0 or greater (required)

  ```bash
  npm install typescript@latest --save-dev
  ```

- Set [`strictNullChecks`](https://www.typescriptlang.org/tsconfig#strictNullChecks) to `true` in your `tsconfig.json` file. This will ensure that our types work correctly and will also help catch errors in your code (strongly recommended)

  ```json5
  // tsconfig.json
  {
    compilerOptions: {
      // ...
      // highlight-next-line
      strictNullChecks: true,
      // or set `strict` to true, which includes `strictNullChecks`
      // "strict": true
    },
  }
  ```

- Set [`skipLibCheck`](https://www.typescriptlang.org/tsconfig#skipLibCheck) to `true` in your `tsconfig.json` file (recommended)

## Creating machines and actors

### Use `createMachine()`, not `Machine()`

:::breakingchange

Breaking change

:::

The `Machine(config)` function is now called `createMachine(config)`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
import { createMachine } from 'xstate';

const machine = createMachine({
  // ...
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { Machine } from 'xstate';

const machine = Machine({
  // ...
});
```

</TabItem>
</Tabs>

### Use `createActor()`, not `interpret()`

:::breakingchange

Breaking change

:::

The `interpret()` function has been renamed to `createActor()`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
import { createMachine, createActor } from 'xstate';

const machine = createMachine(/* ... */);

// ✅
const actor = createActor(machine, {
  // actor options
});
```

</TabItem>
<TabItem value="v4" label="XState v4">

```ts
import { createMachine, interpret } from 'xstate';

const machine = createMachine(/* ... */);

// ❌ DEPRECATED
const actor = interpret(machine, {
  // actor options
});
```

</TabItem>
</Tabs>

### Use `machine.provide()`, not `machine.withConfig()`

:::breakingchange

Breaking change

:::

The `machine.withConfig()` method has been renamed to `machine.provide()`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const specificMachine = machine.provide({
  actions: {
    /* ... */
  },
  guards: {
    /* ... */
  },
  actors: {
    /* ... */
  },
  // ...
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const specificMachine = machine.withConfig({
  actions: {
    /* ... */
  },
  guards: {
    /* ... */
  },
  services: {
    /* ... */
  },
  // ...
});
```

</TabItem>
</Tabs>

### Set context with `input`, not `machine.withContext()`

:::breakingchange

Breaking change

:::

The `machine.withContext(...)` method can no longer be used, as `context` can no longer be overridden directly. Use [input](input.mdx) instead:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  context: ({ input }) => ({
    actualMoney: Math.min(input.money, 42),
  }),
});

const actor = createActor(machine, {
  input: {
    money: 1000,
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  context: {
    actualMoney: 0,
  },
});

const moneyMachine = machine.withContext({
  actualMoney: 1000,
});
```

</TabItem>
</Tabs>

### Actions ordered by default, `predictableActionArguments` no longer needed

:::breakingchange

Breaking change

:::

Actions are now in predictable order by default, so the `predictableActionArguments` flag is no longer required. Assign actions will always run in the order they are defined.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  entry: [
    ({ context }) => {
      console.log(context.count); // 0
    },
    assign({ count: 1 }),
    ({ context }) => {
      console.log(context.count); // 1
    },
    assign({ count: 2 }),
    ({ context }) => {
      console.log(context.count); // 2
    },
  ],
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  predictableActionArguments: true,
  entry: [
    (context) => {
      console.log(context.count); // 0
    },
    assign({ count: 1 }),
    (context) => {
      console.log(context.count); // 1
    },
    assign({ count: 2 }),
    (context) => {
      console.log(context.count); // 2
    },
  ],
});
```

</TabItem>
</Tabs>

### The `spawn()` function has been removed

Instead of using the imported `spawn()` function to create actors inside `assign(...)` actions:

- Use the `spawnChild(...)` action creator (preferred)
- Or use the `spawn(...)` method from the first argument passed to the assigner function inside of `assign(...)` actions (useful if you need the actor ref in `context`)

Read the documentation on [spawning actors](./spawn.mdx) for more information.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
// highlight-next-line
import { spawnChild, assign } from 'xstate';

// Spawning a direct child:
const machine1 = createMachine({
  // ...
  // highlight-start
  entry: spawnChild('someChildLogic', {
    id: 'someChild',
  }),
  // highlight-end
});

// Spawning a child with the actor ref in `context`:
const machine2 = createMachine({
  // ...
  entry: assign({
    // highlight-next-line
    child: ({ spawn }) => spawn('someChildLogic'),
  }),
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌
import { assign, spawn } from 'xstate';

const machine = createMachine({
  // ...
  entry: assign({
    // highlight-next-line
    child: () => spawn('someChildLogic'),
  }),
});
```

</TabItem>
</Tabs>

### Use `getNextSnapshot(…)` instead of `machine.transition(…)`

The `machine.transition(…)` method now requires an "actor scope" for the 3rd argument, which is internally created by `createActor(…)`. Instead, use `getNextSnapshot(…)` to get the next snapshot from some actor logic based on the current snapshot and event:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
import {
  createMachine,
  // highlight-next-line
  getNextSnapshot,
} from 'xstate';

const machine = createMachine({
  // ...
});

// highlight-start
const nextState = getNextSnapshot(
  machine,
  machine.resolveState({ value: 'green' }),
  { type: 'timer' },
);
// highlight-end

nextState.value; // yellow
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌
import { createMachine } from 'xstate';

const machine = createMachine({
  // ...
});

const nextState = machine.transition('green', { type: 'timer' });

nextState.value; // yellow
```

</TabItem>
</Tabs>

### Send events explictly instead of using `autoForward`

The `autoForward` property on invoke configs has been removed. Instead, send events explicitly.

In general, it's _not_ recommended to forward all events to an actor. Instead, only forward the specific events that the actor needs.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  invoke: {
    src: 'someSource',
    id: 'someId',
  },
  // highlight-start
  always: {
    // Forward events to the invoked actor
    // This will not cause an infinite loop in XState v5
    actions: sendTo('someId', ({ event }) => event),
  },
  // highlight-end
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌
const machine = createMachine({
  // ...
  invoke: {
    src: 'someSource',
    id: 'someId'
    // highlight-next-line
    autoForward: true // deprecated
  }
});
```

</TabItem>
</Tabs>

## States

### Use `state.getMeta()` instead of `state.meta`

:::breakingchange

Breaking change

:::

The `state.meta` property has been renamed to `state.getMeta()`:

<Tabs>
<TabItem value="v5" label="XState v5">
  
```ts
// ✅
state.getMeta();
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
state.meta;
```

</TabItem>
</Tabs>

### The `state.toStrings()` method has been removed

:::breakingchange

Breaking change

:::

```ts
import { type StateValue } from 'xstate';

export function getStateValueStrings(stateValue: StateValue): string[] {
  if (typeof stateValue === 'string') {
    return [stateValue];
  }
  const valueKeys = Object.keys(stateValue);

  return valueKeys.concat(
    ...valueKeys.map((key) =>
      getStateValueStrings(stateValue[key]!).map((s) => key + '.' + s),
    ),
  );
}

// ...

const stateValueStrings = getStateValueStrings(stateValue);
// e.g. ['green', 'yellow', 'red', 'red.walk', 'red.wait', …]
```

### Use `state._nodes` instead of `state.configuration`

:::breakingchange

Breaking change

:::

The `state.configuration` property has been renamed to `state._nodes`:

<Tabs>
<TabItem value="v5" label="XState v5">
  
```ts
// ✅
state._nodes;
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
state.configuration;
```

</TabItem>
</Tabs>

### Read events from inspection API instead of `state.events`

The `state.events` property has been removed, because events are not part of state, unless you explicitly add them to the state's `context`. Use the [inspection API](./inspection.mdx) to observe events instead, or add the event explicitly to the state's `context`:

<Tabs>
<TabItem value="v5" label="XState v5">
  
```ts
// ✅
import { createActor } from 'xstate';
import { someMachine } from './someMachine';

const actor = createActor(someMachine, {
// highlight-start
inspect: (inspEvent) => {
if (inspEvent.type === '@xstate.event') {
console.log(inspEvent.event);
}
}
// highlight-end
});

````

</TabItem>

<TabItem value="v5-alt" label="XState v5 (context)">

```ts
// ✅
import { setup, createActor } from 'xstate';

const someMachine = setup({
  // ...
  actions: {
    // highlight-start
    recordEvent: assign({
      event: ({ event }) => event
    })
    // highlight-end
  }
}).createMachine({
  context: { event: undefined },
  on: {
    someEvent: {
      // ...
      // highlight-next-line
      actions: ['recordEvent']
    }
  }
});

const someActor = createActor(someMachine);
someActor.subscribe(snapshot => {
  // highlight-next-line
  console.log(snapshot.context.event);
});
````

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { interpret } from 'xstate';
import { someMachine } from './someMachine';

const actor = interpret(someMachine);
actor.subscribe((state) => {
  // highlight-next-line
  console.log(state.event); // Removed
});
```

</TabItem>
</Tabs>

## Events and transitions

### Implementation functions receive a single argument

:::breakingchange

Breaking change

:::

Implementation functions now take in a single argument: an object with `context`, `event`, and other properties.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  entry: ({ context, event }) => {
    // ...
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  entry: (context, event) => {
    // ...
  },
});
```

</TabItem>
</Tabs>

### `send()` is removed; use `raise()` or `sendTo()`

:::breakingchange

Breaking change

:::

The `send(...)` action creator is removed. Use `raise(...)` for sending events to self or `sendTo(...)` for sending events to other actors instead.

Read the documentation on the [`sendTo` action](actions.mdx#send-to-action) and [`raise` action](actions.mdx#raise-action) for more information.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  entry: [
    // Send an event to self
    raise({ type: 'someEvent' }),

    // Send an event to another actor
    sendTo('someActor', { type: 'someEvent' }),
  ],
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  entry: [
    // Send an event to self
    send({ type: 'someEvent' }),

    // Send an event to another actor
    send({ type: 'someEvent' }, { to: 'someActor' }),
  ],
});
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update v4 projects to use `sendTo` or `raise` instead of `send`.

### Use `enqueueActions()` instead of `pure()` and `choose()`

The `pure()` and `choose()` methods have been removed. Use `enqueueActions()` instead.

For `pure()` actions:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
entry: [
  enqueueActions(({ context, event, enqueue }) => {
    enqueue('action1');
    enqueue('action2');
  }),
];
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
entry: [
  pure(() => {
    return ['action1', 'action2'];
  }),
];
```

</TabItem>
</Tabs>

For `choose()` actions:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
entry: [
  enqueueActions(({ enqueue, check }) => {
    if (check('someGuard')) {
      enqueue('action1');
      enqueue('action2');
    }
  }),
];
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
entry: [
  choose([
    {
      guard: 'someGuard',
      actions: ['action1', 'action2'],
    },
  ]),
];
```

</TabItem>
</Tabs>

### `actor.send()` no longer accepts string types

:::breakingchange

Breaking change

:::

String event types can no longer be sent to, e.g., `actor.send(event)`; you must send an event object instead:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
actor.send({ type: 'someEvent' });
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
actor.send('someEvent');
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update v4 projects to pass an object to `.send()`.

### `state.can()` no longer accepts string types

:::breakingchange

Breaking change

:::

String event types can no longer be sent to, e.g., `state.can(event)`; you must send an event object instead:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
state.can({ type: 'someEvent' });
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
state.can('someEvent');
```

</TabItem>
</Tabs>

### Guarded transitions use `guard`, not `cond`

:::breakingchange

Breaking change

:::

The `cond` transition property for guarded transitions is now called `guard`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  on: {
    someEvent: {
      guard: 'someGuard',
      target: 'someState',
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  on: {
    someEvent: {
      // renamed to `guard` in v5
      cond: 'someGuard',
      target: 'someState',
    },
  },
});
```

</TabItem>
</Tabs>

### Use `params` to pass params to actions & guards

:::breakingchange

Breaking change

:::

Properties other than `type` on action objects and guard objects should be nested under a `params` property; `{ type: 'someType', message: 'hello' }` becomes `{ type: 'someType', params: { message: 'hello' }}`. These `params` are then passed to the 2nd argument of the action or guard implementation:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  entry: {
    type: 'greet',
    params: {
      message: 'Hello world',
    },
  },
  on: {
    someEvent: {
      guard: { type: 'isGreaterThan', params: { value: 42 } },
    },
  },
}).provide({
  actions: {
    greet: ({ context, event }, params) => {
      console.log(params.message); // 'Hello world'
    },
  },
  guards: {
    isGreaterThan: ({ context, event }, params) => {
      return event.value > params.value;
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine(
  {
    entry: {
      type: 'greet',
      message: 'Hello world',
    },
    on: {
      someEvent: {
        cond: { type: 'isGreaterThan', value: 42 },
      },
    },
  },
  {
    actions: {
      greet: (context, event, { action }) => {
        console.log(action.message); // 'Hello world'
      },
    },
    guards: {
      isGreaterThan: (context, event, { guard }) => {
        return event.value > guard.value;
      },
    },
  },
);
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update action and guard objects on v4 projects to move properties (other than `type`) to a `params` object.

### Use wildcard `*` transitions, not strict mode

:::breakingchange

Breaking change

:::

Strict mode is removed. If you want to throw on unhandled events, you should use a wildcard transition:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  on: {
    knownEvent: {
      // ...
    },
    // highlight-start
    '*': {
      // unknown event
      actions: ({ event }) => {
        throw new Error(`Unknown event: ${event.type}`);
      },
    },
    // highlight-end
  },
});

const actor = createActor(machine);

actor.subscribe({
  // highlight-start
  error: (err) => {
    console.error(err);
  },
  // highlight-end
});

actor.start();

actor.send({ type: 'unknownEvent' });
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  strict: true,
  on: {
    knownEvent: {
      // ...
    },
  },
});

const service = interpret(machine);

service.send({ type: 'unknownEvent' });
```

</TabItem>
</Tabs>

### Use explicit eventless (`always`) transitions

:::breakingchange

Breaking change

:::

Eventless (“always”) transitions must now be defined through the `always: { ... }` property of a state node; they can no longer be defined via an empty string:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  states: {
    someState: {
      always: {
        target: 'anotherState',
      },
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  states: {
    someState: {
      on: {
        '': {
          target: 'anotherState',
        },
      },
    },
  },
});
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update v4 projects to use `always` for _eventless_ transitions.

### Use `reenter: true`, not `internal: false`

:::breakingchange

Breaking change

:::

`internal: false` is now `reenter: true`

External transitions previously specified with `internal: false` are now specified with `reenter: true`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  on: {
    someEvent: {
      target: 'sameState',
      reenter: true,
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  on: {
    someEvent: {
      target: 'sameState',
      internal: false,
    },
  },
});
```

</TabItem>
</Tabs>

### Transitions are internal by default, not external

:::breakingchange

Breaking change

:::

All transitions are **internal by default**. This change is relevant for transitions defined on state nodes with `entry` or `exit` actions, invoked actors, or delayed transitions (`after`). If you relied on the previous XState v4 behavior where transitions implicitly re-entered a state node, use `reenter: true`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  states: {
    compoundState: {
      entry: 'someAction',
      on: {
        // highlight-start
        someEvent: {
          target: 'compoundState.childState',
          // Reenters the `compoundState` state,
          // just like an external transition
          reenter: true,
        },
        selfEvent: {
          target: 'childState',
          reenter: true,
        },
        // highlight-end
      },
      initial: 'childState',
      states: {
        childState: {},
      },
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  states: {
    compoundState: {
      entry: 'someAction',
      on: {
        // highlight-start
        someEvent: {
          // implicitly external
          target: 'compoundState.childState', // non-relative target
        },
        selfEvent: {
          target: 'compoundState',
        },
        // highlight-end
      },
      initial: 'childState',
      states: {
        childState: {},
      },
    },
  },
});
```

</TabItem>
</Tabs>

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  states: {
    compoundState: {
      after: {
        1000: {
          target: 'compoundState.childState',
          reenter: true, // make it external explicitly!
        },
      },
      initial: 'childState',
      states: {
        childState: {},
      },
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  states: {
    compoundState: {
      after: {
        1000: {
          // implicitly external
          target: 'compoundState.childState', // non-relative target
        },
      },
      initial: 'childState',
      states: {
        childState: {},
      },
    },
  },
});
```

</TabItem>
</Tabs>

### Child state nodes are always re-entered

:::breakingchange

Breaking change

:::

Child state nodes are always re-entered when they are targeted by transitions (both external and internal) defined on compound state nodes. This change is relevant only if a child state node has `entry` or `exit` actions, invoked actors, or delayed transitions (`after`). Add a `stateIn` guard to prevent undesirable re-entry of the child state:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅

const machine = createMachine({
  // ...
  states: {
    compoundState: {
      on: {
        someEvent: {
          guard: not(stateIn({ compoundState: 'childState' })),
          target: '.childState',
        },
      },
      initial: 'childState',
      states: {
        childState: {
          entry: 'someAction',
        },
      },
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED

const machine = createMachine({
  // ...
  states: {
    compoundState: {
      on: {
        someEvent: {
          // Implicitly internal; childState not re-entered
          target: '.childState',
        },
      },
      initial: 'childState',
      states: {
        childState: {
          entry: 'someAction',
        },
      },
    },
  },
});
```

</TabItem>

</Tabs>

### Use `stateIn()` to validate state transitions, not `in`

:::breakingchange

Breaking change

:::

The `in: 'someState'` transition property is removed. Use `guard: stateIn(...)` instead:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  on: {
    someEvent: {
      guard: stateIn({ form: 'submitting' }),
      target: 'someState',
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  on: {
    someEvent: {
      in: '#someMachine.form.submitting'
      target: 'someState',
    },
  },
});
```

</TabItem>
</Tabs>

### Use `actor.subscribe()` instead of `state.history`

:::breakingchange

Breaking change

:::

The `state.history` property is removed. If you want the previous snapshot, you should maintain that via `actor.subscribe(...)` instead.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
let previousSnapshot = actor.getSnapshot();

actor.subscribe((snapshot) => {
  doSomeComparison(previousSnapshot, snapshot);
  previousSnapshot = snapshot;
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
actor.subscribe((state) => {
  doSomeComparison(state.history, state);
});
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update v4 projects to track history using `actor.subscribe()`.

### Actions can throw errors without `escalate`

:::breakingchange

Breaking change

:::

The `escalate` action creator is removed. In XState v5 actions can throw errors, and they will propagate as expected. Errors can be handled using an `onError` transition.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const childMachine = createMachine({
  // This will be sent to the parent machine that invokes this child
  // highlight-start
  entry: () => {
    throw new Error('This is some error');
  },
  // highlight-end
});

const parentMachine = createMachine({
  invoke: {
    src: childMachine,
    // highlight-start
    onError: {
      actions: ({ context, event }) => {
        console.log(event.error);
        //  {
        //    type: ...,
        //    error: {
        //      message: 'This is some error'
        //    }
        //  }
      },
    },
    // highlight-end
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const childMachine = createMachine({
  // highlight-start
  entry: escalate('This is some error'),
  // highlight-end
});

/* ... */
```

</TabItem>
</Tabs>

## Actors

### Use actor logic creators for `invoke.src` instead of functions

:::breakingchange

Breaking change

:::

The available actor logic creators are:

- `createMachine`
- `fromPromise`
- `fromObservable`
- `fromEventObservable`
- `fromTransition`
- `fromCallback`

See [Actors](actors.mdx) for more information.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
import { fromPromise, setup } from 'xstate';

const machine = setup({
  actors: {
    getUser: fromPromise(async ({ input }: { input: { userId: string } }) => {
      const data = await getData(input.userId);
      // ...
      return data;
    }),
  },
}).createMachine({
  invoke: {
    src: 'getUser',
    input: ({ context, event }) => ({
      userId: context.userId,
    }),
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { createMachine } from 'xstate';

const machine = createMachine({
  invoke: {
    src: (context) => async () => {
      const data = await getData(context.userId);

      // ...
      return data;
    },
  },
});
```

</TabItem>
</Tabs>

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
import { fromCallback, createMachine } from 'xstate';

const machine = createMachine({
  invoke: {
    src: fromCallback(({ sendBack, receive, input }) => {
      // ...
    }),
    input: ({ context, event }) => ({
      userId: context.userId,
    }),
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { createMachine } from 'xstate';

const machine = createMachine({
  invoke: {
    src: (context, event) => (sendBack, receive) => {
      // context.userId
      // ...
    },
  },
});
```

</TabItem>
</Tabs>

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
import { fromEventObservable, createMachine } from 'xstate';
import { interval, mapTo } from 'rxjs';

const machine = createMachine({
  invoke: {
    src: fromEventObservable(() =>
      interval(1000).pipe(mapTo({ type: 'tick' })),
    ),
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { createMachine } from 'xstate';
import { interval, mapTo } from 'rxjs';

const machine = createMachine({
  invoke: {
    src: () => interval(1000).pipe(mapTo({ type: 'tick' })),
  },
});
```

</TabItem>
</Tabs>

### Use `invoke.input` instead of `invoke.data`

:::breakingchange

Breaking change

:::

The `invoke.data` property is removed. If you want to provide context to invoked actors, use `invoke.input`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const someActor = createMachine({
  // The input must be consumed by the invoked actor:
  context: ({ input }) => input,
  // ...
});

const machine = createMachine({
  // ...
  invoke: {
    src: 'someActor',
    input: {
      value: 42,
    },
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const someActor = createMachine({
  // ...
});

const machine = createMachine({
  // ...
  invoke: {
    src: 'someActor',
    data: {
      value: 42,
    },
  },
});
```

</TabItem>
</Tabs>

### Use `output` in final states instead of `data`

:::breakingchange

Breaking change

:::

To produce output data from a machine which reached its final state, use the top-level `output` property instead of `data`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
    },
  },
  output: {
    answer: 42,
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
      data: {
        answer: 42,
      },
    },
  },
});
```

</TabItem>
</Tabs>

To provide a dynamically generated output, replace `invoke.data` with `invoke.output` and add a top-level `output` property:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
      output: ({ event }) => ({
        answer: event.someValue,
      }),
    },
  },
  output: ({ event }) => event.output,
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
      data: (context, event) => {
        answer: event.someValue,
      },
    },
  },
});
```

</TabItem>
</Tabs>

### Don't use property mappers in `input` or `output`

:::breakingchange

Breaking change

:::

If you want to provide dynamic context to invoked actors, or produce dynamic output from final states, use a function instead of an object with property mappers.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  // ...
  invoke: {
    src: 'someActor',
    input: ({ context, event }) => ({
      value: event.value,
    }),
  },
});

// The input must be consumed by the invoked actor:
const someActor = createMachine({
  // ...
  context: ({ input }) => input,
});

// Producing machine output
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
    },
  },
  output: ({ context, event }) => ({
    answer: context.value,
  }),
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  // ...
  invoke: {
    src: 'someActor',
    data: {
      value: (context, event) => event.value, // a property mapper
    },
  },
});

// Producing machine output
const machine = createMachine({
  // ...
  states: {
    finished: {
      type: 'final',
      data: {
        answer: (context, event) => context.value, // a property mapper
      },
    },
  },
});
```

</TabItem>
</Tabs>

### Use `actors` property on `options` object instead of `services`

:::breakingchange

Breaking change

:::

`services` have been renamed to `actors`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const specificMachine = machine.provide({
  actions: {
    /* ... */
  },
  guards: {
    /* ... */
  },
  actors: {
    /* ... */
  },
  // ...
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const specificMachine = machine.withConfig({
  actions: {
    /* ... */
  },
  guards: {
    /* ... */
  },
  services: {
    /* ... */
  },
  // ...
});
```

</TabItem>
</Tabs>

### Use `subscribe()` for changes, not `onTransition()`

:::breakingchange

Breaking change

:::

The `actor.onTransition(...)` method is removed. Use `actor.subscribe(...)` instead.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const actor = createActor(machine);
actor.subscribe((state) => {
  // ...
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const actor = interpret(machine);
actor.onTransition((state) => {
  // ...
});
```

</TabItem>
</Tabs>

### `createActor()` (formerly `interpret()`) accepts a second argument to restore state

:::breakingchange

Breaking change

:::

`interpret(machine).start(state)` is now `createActor(machine, { snapshot }).start()`

To restore an actor at a specific state, you should now pass the state as the `snapshot` property of the `options` argument of `createActor(logic, options)`. The `actor.start()` property no longer takes in a `state` argument.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const actor = createActor(machine, { snapshot: someState });
actor.start();
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const actor = interpret(machine);
actor.start(someState);
```

</TabItem>
</Tabs>

### Use `actor.getSnapshot()` to get actor’s state

:::breakingchange

Breaking change

:::

Subscribing to an actor (`actor.subscribe(...)`) after the actor has started will no longer emit the current snapshot immediately. Instead, read the current snapshot from `actor.getSnapshot()`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const actor = createActor(machine);
actor.start();

const initialState = actor.getSnapshot();

actor.subscribe((state) => {
  // Snapshots from when the subscription was created
  // Will not emit the current snapshot until a transition happens
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const actor = interpret(machine);
actor.start();

actor.subscribe((state) => {
  // Current snapshot immediately emitted
});
```

</TabItem>
</Tabs>

### Loop over events instead of using `actor.batch()`

:::breakingchange

Breaking change

:::

The `actor.batch([...])` method for batching events is removed.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
for (const event of events) {
  actor.send(event);
}
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
actor.batch(events);
```

</TabItem>
</Tabs>

**Pre-migration tip:** Update v4 projects to loop over events to send them as a batch.

### Use `snapshot.status === 'done'` instead of `snapshot.done`

:::breakingchange

Breaking change

:::

The `snapshot.done` property, which was previously in the snapshot object of state machine actors, is removed. Use `snapshot.status === 'done'` instead, which is available to all actors:

<Tabs>

<TabItem value="v5" label="XState v5">

```ts
// ✅
const actor = createActor(machine);
actor.start();

actor.subscribe((snapshot) => {
  if (snapshot.status === 'done') {
    // ...
  }
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const actor = interpret(machine);
actor.start();

actor.subscribe((state) => {
  if (state.done) {
    // ...
  }
});
```

</TabItem>
</Tabs>

### `state.nextEvents` has been removed

:::breakingchange

Breaking change

:::

The `state.nextEvents` property is removed, since it is not a completely safe/reliable way of determining the next events that can be sent to the actor. If you want to get the next events according to the previous behavior, you can use this helper function:

```ts
import type { AnyMachineSnapshot } from 'xstate';

function getNextEvents(snapshot: AnyMachineSnapshot) {
  return [...new Set([...snapshot._nodes.flatMap((sn) => sn.ownEvents)])];
}

// Instead of `state.nextEvents`:
const nextEvents = getNextEvents(state);
```

## TypeScript

### Use `types` instead of `schema`

:::breakingchange

Breaking change

:::

The `machineConfig.schema` property is renamed to `machineConfig.types`:

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  types: {} as {
    context: {
      /* ...*/
    };
    events: {
      /* ...*/
    };
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  schema: {} as {
    context: {
      /* ...*/
    };
    events: {
      /* ...*/
    };
  },
});
```

</TabItem>
</Tabs>

### Use `types.typegen` instead of `tsTypes`

:::breakingchange

Breaking change

:::

:::warningxstate

XState Typegen does not fully support XState v5 yet. However, strongly-typed machines can still be achieved without Typegen.

:::

The `machineConfig.tsTypes` property has been renamed and is now at `machineConfig.types.typegen`.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
const machine = createMachine({
  types: {} as {
    typegen: {};
    context: {
      /* ...*/
    };
    events: {
      /* ...*/
    };
  },
});
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
const machine = createMachine({
  tsTypes: {};
  schema: {} as {
    context: {
      /* ...*/
    };
    events: {
      /* ...*/
    };
  },
});
```

</TabItem>
</Tabs>

## `@xstate/react`

### `useInterpret()` is now `useActorRef()`

:::breakingchange

Breaking change

:::

The `useInterpret()` hook, which is used to return an `actorRef` ("service" in XState v4), is renamed to `useActorRef()`.

<Tabs>
<TabItem value="v5" label="XState v5">

```ts
// ✅
import { useActorRef } from '@xstate/react';

const actorRef = useActorRef(machine); // or any other logic
```

</TabItem>

<TabItem value="v4" label="XState v4">

```ts
// ❌ DEPRECATED
import { useInterpret } from '@xstate/react';

const service = useInterpret(machine);
```

</TabItem>
</Tabs>

### `useActor(logic)` now accepts actor logic, not an actor

:::breakingchange

Breaking change

:::

The `useActor(logic)` hook now accepts _actor logic_ (such as `fromPromise(...)`, `createMachine(...)`, etc.) instead of an existing `ActorRef`.

To use an existing `ActorRef`, use `actor.send(...)` to send events and `useSelector(actor, ...)` to get the snapshot:

<Tabs>
<TabItem value="v5" label="XState v5">

```tsx
// ✅
import { useSelector } from '@xstate/react';

function Component({ someActorRef }) {
  const state = useSelector(someActorRef, (s) => s);

  return <button onClick={() => someActorRef.send({ type: 'someEvent' })} />;
}
```

</TabItem>

<TabItem value="v4" label="XState v4">

```tsx
// ❌ DEPRECATED
import { useActor } from '@xstate/react';

function Component({ someActorRef }) {
  const [state, send] = useActor(someActorRef);

  return <button onClick={() => send({ type: 'someEvent' })} />;
}
```

</TabItem>
</Tabs>

## Use `machine.provide()` to provide implementations in hooks

:::breakingchange

Breaking change

:::

For dynamically creating machines with provided implementations, the `useMachine(...)`, `useActor(...)`, and `useActorRef(...)` hooks no longer accept:

- Lazy machine creators as the 1st argument
- Implementations passed to the 2nd argument

Instead, `machine.provide(...)` should be passed directly to the 1st argument.

The `@xstate/react` package considers machines with the same configuration to be the same machine, so it will minimize rerenders but still keep the provided implementations up-to-date.

<Tabs>
<TabItem value="v5" label="XState v5">

```tsx
// ✅
import { useMachine } from '@xstate/react';
import { someMachine } from './someMachine';

function Component(props) {
  const [state, send] = useMachine(
    someMachine.provide({
      actions: {
        doSomething: () => {
          props.onSomething?.(); // Kept up-to-date
        },
      },
    }),
  );

  // ...
}
```

</TabItem>

<TabItem value="v4 arguments" label="XState v4">

```tsx
// ❌ DEPRECATED
import { useMachine } from '@xstate/react';
import { someMachine } from './someMachine';

function Component(props) {
  const [state, send] = useMachine(someMachine, {
    actions: {
      doSomething: () => {
        props.onSomething?.();
      },
    },
  });

  // ...
}
```

</TabItem>

<TabItem value="v4 function" label="XState v4">

```tsx
// ❌ DEPRECATED
import { useMachine } from '@xstate/react';
import { someMachine } from './someMachine';

function Component(props) {
  const [state, send] = useMachine(() =>
    someMachine.withConfig({
      actions: {
        doSomething: () => {
          props.onSomething?.();
        },
      },
    }),
  );

  // ...
}
```

</TabItem>
</Tabs>

## `@xstate/vue`

### `useMachine()` now returns `snapshot` instead of `state`, and `actor` instead of `service`

:::breakingchange

Breaking change

:::

To keep consistent naming with the rest of XState and related libraries:

- `state` is now `snapshot`
- `service` is now `actor`

<Tabs>
<TabItem value="v5" label="XState v5">

```tsx
// ✅
import { useMachine } from '@xstate/vue';

// ...

const {
  // highlight-next-line
  snapshot, // Renamed from `state`
  send,
  // highlight-next-line
  actor, // Renamed from `service`
} = useMachine(someMachine);
```

</TabItem>

<TabItem value="v4" label="XState v4">

```tsx
// ❌ DEPRECATED
import { useMachine } from '@xstate/vue';

// ...

const {
  // highlight-next-line
  state, // Renamed to `snapshot` in @xstate/vue 3.0.0
  send,
  // highlight-next-line
  service, // Renamed to `actor` in @xstate/vue 3.0.0
} = useMachine(someMachine);
```

</TabItem>
</Tabs>

## New features

- [Create actor systems](system.mdx)
- [New actor logic creators](/docs/actors#actor-logic-creators)
- [Deep persistence for invoked and spawned actors](persistence.mdx)
- [Provide input data to state machines and actors](input.mdx)
- [Specify output “done data” for actors](output.mdx)
- [Partial event descriptors (partial wildcards)](/docs/transitions#partial-wildcard-transitions)
- [Enqueue actions](/docs/actions#enqueue-actions)
- [Higher-level guards](/docs/guards#higher-level-guards)
- [Setup API for specifying types and strongly-typed state values](/docs/machines#providing-implementations)
- [Inspect API](inspection.mdx)

## Frequently asked questions

### When will Stately Studio be compatible with XState v5?

We are currently working on [Stately Studio](studio.mdx) compatibility with XState v5. Exporting to XState v5 (JavaScript or TypeScript) is already available. We are working on support for new XState v5 features, such as higher-order guards, partial event wildcards, and machine input/output.

Upvote or comment on [Stately Studio + XState v5 compatibility in our roadmap](https://feedback.stately.ai/editor/p/stately-studio-xstate-v5-compatibility) to stay updated on our progress.

### When will the XState VS Code extension be compatible with XState v5?

The [XState VS Code extension](xstate-vscode-extension.mdx) is not yet compatible with XState v5. The extension is a priority for us, and work is already underway.

Upvote or comment on [XState v5 compatibility for VS Code extension in our roadmap](https://feedback.stately.ai/devtools/p/xstate-v5-compatibility-for-vs-code-extension) to stay updated on our progress.

### When will XState v5 have typegen?

TypeScript inference has been greatly improved in XState v5. Especially with features like the `setup()` API and dynamic parameters, the main use-cases for typegen are no longer needed.

However, we recognize that there may still be some specific use-cases for typegen. Upvote or comment on [Typegen for XState v5 in our roadmap](https://feedback.stately.ai/xstate/p/typegen-for-xstate-v5) to stay updated on our progress.

### How can I use both XState v4 and v5?

You can use both XState v4 and v5 in the same project, which is useful for incrementally migrating to XState v5. To use both, add `"xstate5": "npm:xstate@5"` to your `package.json` manually or through the CLI:

```bash
npm i xstate5@npm:xstate@5
```

Then, you can import the v5 version of XState in your code:

```ts
import { createMachine } from 'xstate5';
// or { createMachine as createMachine5 } from 'xstate5';
```

If you need to use different versions of an integration package, such as `@xstate/react`, you can use a similar strategy as above, but you will need to link to the correct version of XState in the integration package. This can be done by using a script:

```bash
npm i xstate5@npm:xstate@5 @xstate5/react@npm:@xstate/react@4 --force
```

```js
// scripts/xstate5-react-script.js
const fs = require('fs-extra');
const path = require('path');

const rootNodeModules = path.join(__dirname, '..', 'node_modules');

fs.ensureSymlinkSync(
  path.join(rootNodeModules, 'xstate5'),
  path.join(rootNodeModules, '@xstate5', 'react', 'node_modules', 'xstate'),
);
```

```json5
// package.json
"scripts": {
  "postinstall": "node scripts/xstate5-react-script.js"
}
```

Then, you can use the XState v5 compatible version of `@xstate/react` in your code:

```ts
import { useMachine } from '@xstate5/react';
// or { useMachine as useMachine5 } from '@xstate5/react';
import { createMachine } from 'xstate5';
// or { createMachine as createMachine5 } from 'xstate5';

// ...
```

# xstate cheatsheet


Use this cheatsheet to quickly look up the syntax for XState v5.

## Installing XState

<Tabs>
<TabItem value="npm" label="npm">

```bash
npm install xstate
```

</TabItem>

<TabItem value="pnpm" label="pnpm">

```bash
pnpm install xstate
```

</TabItem>

<TabItem value="yarn" label="yarn">

```bash
yarn add xstate
```

</TabItem>
</Tabs>

[Read more on installing XState](installation.mdx).

## Creating a state machine

```ts
import { setup, createActor, assign } from 'xstate';

const machine = setup({
  /* ... */
}).createMachine({
  id: 'toggle',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      entry: assign({
        count: ({ context }) => context.count + 1,
      }),
      on: {
        toggle: { target: 'inactive' },
      },
    },
    inactive: {
      on: {
        toggle: { target: 'active' },
      },
    },
  },
});

const actor = createActor(machine);
actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

actor.start();
// logs 'active' with context { count: 1 }

actor.send({ type: 'toggle' });
// logs 'inactive' with context { count: 1 }
actor.send({ type: 'toggle' });
// logs 'active' with context { count: 2 }
actor.send({ type: 'toggle' });
// logs 'inactive' with context { count: 2 }
```

[Read more about the actor model](actor-model.mdx).

## Creating promise logic

```ts
import { fromPromise, createActor } from 'xstate';

const promiseLogic = fromPromise(async () => {
  const response = await fetch('https://dog.ceo/api/breeds/image/random');
  const dog = await response.json();
  return dog;
});

const actor = createActor(promiseLogic);

actor.subscribe((snapshot) => {
  console.log(snapshot);
});

actor.start();
// logs: {
//   message: "https://images.dog.ceo/breeds/kuvasz/n02104029_110.jpg",
//   status: "success"
// }
```

[Read more about promise actor logic](/docs/actors#actors-as-promises).

## Creating transition logic

A transition function is just like a reducer.

```ts
import { fromTransition, createActor } from 'xstate';

const transitionLogic = fromTransition(
  (state, event) => {
    switch (event.type) {
      case 'inc':
        return {
          ...state,
          count: state.count + 1,
        };
      default:
        return state;
    }
  },
  { count: 0 }, // initial state
);

const actor = createActor(transitionLogic);

actor.subscribe((snapshot) => {
  console.log(snapshot);
});

actor.start();
// logs { count: 0 }

actor.send({ type: 'inc' });
// logs { count: 1 }
actor.send({ type: 'inc' });
// logs { count: 2 }
```

[Read more about transition actors](/docs/actors#fromtransition).

## Creating observable logic

```ts
import { fromObservable, createActor } from 'xstate';
import { interval } from 'rxjs';

const observableLogic = fromObservable(() => interval(1000));

const actor = createActor(observableLogic);

actor.subscribe((snapshot) => {
  console.log(snapshot);
});

actor.start();
// logs 0, 1, 2, 3, 4, 5, ...
// every second
```

[Read more about observable actors](/docs/actors#fromobservable).

## Creating callback logic

```ts
import { fromCallback, createActor } from 'xstate';

const callbackLogic = fromCallback(({ sendBack, receive }) => {
  const i = setTimeout(() => {
    sendBack({ type: 'timeout' });
  }, 1000);

  receive((event) => {
    if (event.type === 'cancel') {
      console.log('canceled');
      clearTimeout(i);
    }
  });

  return () => {
    clearTimeout(i);
  };
});

const actor = createActor(callbackLogic);

actor.start();

actor.send({ type: 'cancel' });
// logs 'canceled'
```

[Read more about callback actors](/docs/actors#fromcallback).

## Parent states

```ts
import { setup, createActor } from 'xstate';

const machine = setup({
  /* ... */
}).createMachine({
  id: 'parent',
  initial: 'active',
  states: {
    active: {
      initial: 'one',
      states: {
        one: {
          on: {
            NEXT: { target: 'two' },
          },
        },
        two: {},
      },
      on: {
        NEXT: { target: 'inactive' },
      },
    },
    inactive: {},
  },
});

const actor = createActor(machine);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

actor.start();
// logs { active: 'one' }

actor.send({ type: 'NEXT' });
// logs { active: 'two' }

actor.send({ type: 'NEXT' });
// logs 'inactive'
```

[Read more about parent states](parent-states.mdx).

## Actions

```ts
import { setup, createActor } from 'xstate';

const machine = setup({
  actions: {
    activate: () => {
      /* ... */
    },
    deactivate: () => {
      /* ... */
    },
    notify: (_, params: { message: string }) => {
      /* ... */
    },
  },
}).createMachine({
  id: 'toggle',
  initial: 'active',
  states: {
    active: {
      // highlight-next-line
      entry: { type: 'activate' },
      // highlight-next-line
      exit: { type: 'deactivate' },
      on: {
        toggle: {
          target: 'inactive',
          // highlight-next-line
          actions: [{ type: 'notify' }],
        },
      },
    },
    inactive: {
      on: {
        toggle: {
          target: 'active',
          // highlight-start
          actions: [
            // action with params
            {
              type: 'notify',
              params: {
                message: 'Some notification',
              },
            },
          ],
          // highlight-end
        },
      },
    },
  },
});

const actor = createActor(
  machine.provide({
    actions: {
      notify: (_, params) => {
        console.log(params.message ?? 'Default message');
      },
      activate: () => {
        console.log('Activating');
      },
      deactivate: () => {
        console.log('Deactivating');
      },
    },
  }),
);

actor.start();
// logs 'Activating'

actor.send({ type: 'toggle' });
// logs 'Deactivating'
// logs 'Default message'

actor.send({ type: 'toggle' });
// logs 'Some notification'
// logs 'Activating'
```

[Read more about actions](actions.mdx).

## Guards

```ts
import { setup, createActor } from 'xstate';

const machine = setup({
  // highlight-start
  guards: {
    canBeToggled: ({ context }) => context.canActivate,
    isAfterTime: (_, params) => {
      const { time } = params;
      const [hour, minute] = time.split(':');
      const now = new Date();
      return now.getHours() > hour && now.getMinutes() > minute;
    },
  },
  // highlight-end
  actions: {
    notifyNotAllowed: () => {
      console.log('Cannot be toggled');
    },
  },
}).createMachine({
  id: 'toggle',
  initial: 'active',
  context: {
    canActivate: false,
  },
  states: {
    inactive: {
      on: {
        toggle: [
          {
            target: 'active',
            // highlight-next-line
            guard: 'canBeToggled',
          },
          {
            actions: 'notifyNotAllowed',
          },
        ],
      },
    },
    active: {
      on: {
        toggle: {
          // Guard with params
          // highlight-next-line
          guard: { type: 'isAfterTime', params: { time: '16:00' } },
          target: 'inactive',
        },
      },
      // ...
    },
  },
});

const actor = createActor(machine);

actor.start();
// logs 'Cannot be toggled'
```

[Read more about guards](guards.mdx).

## Invoking actors

```ts
import { setup, fromPromise, createActor, assign } from 'xstate';

const loadUserLogic = fromPromise(async () => {
  const response = await fetch('https://jsonplaceholder.typicode.com/users/1');
  const user = await response.json();
  return user;
});

const machine = setup({
  // highlight-next-line
  actors: { loadUserLogic },
}).createMachine({
  id: 'toggle',
  initial: 'loading',
  context: {
    user: undefined,
  },
  states: {
    loading: {
      // highlight-start
      invoke: {
        id: 'loadUser',
        src: 'loadUserLogic',
        onDone: {
          target: 'doSomethingWithUser',
          actions: assign({
            user: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'failure',
          actions: ({ event }) => {
            console.log(event.error);
          },
        },
      },
      // highlight-end
    },
    doSomethingWithUser: {
      // ...
    },
    failure: {
      // ...
    },
  },
});

const actor = createActor(machine);

actor.subscribe((snapshot) => {
  console.log(snapshot.context.user);
});

actor.start();
// eventually logs:
// { id: 1, name: 'Leanne Graham', ... }
```

[Read more about invoking actors](invoke.mdx).

## Spawning actors

```ts
import { setup, fromPromise, createActor, assign } from 'xstate';

const loadUserLogic = fromPromise(async () => {
  const response = await fetch('https://jsonplaceholder.typicode.com/users/1');
  const user = await response.json();
  return user;
});

const machine = setup({
  actors: {
    loadUserLogic,
  },
}).createMachine({
  context: {
    userRef: undefined,
  },
  on: {
    loadUser: {
      actions: assign({
        // highlight-start
        userRef: ({ spawn }) => spawn('loadUserLogic'),
        // highlight-end
      }),
    },
  },
});

const actor = createActor(machine);
actor.subscribe((snapshot) => {
  const { userRef } = snapshot.context;
  console.log(userRef?.getSnapshot());
});
actor.start();

actor.send({ type: 'loadUser' });
// eventually logs:
// { id: 1, name: 'Leanne Graham', ... }
```

[Read more about spawning actors](spawn.mdx).

## Input and output

```ts
import { setup, createActor } from 'xstate';

const greetMachine = setup({
  types: {
    context: {} as { message: string },
    input: {} as { name: string },
  },
}).createMachine({
  // highlight-start
  context: ({ input }) => ({
    message: `Hello, ${input.name}`,
  }),
  // highlight-end
  entry: ({ context }) => {
    console.log(context.message);
  },
});

const actor = createActor(greetMachine, {
  // highlight-start
  input: {
    name: 'David',
  },
  // highlight-end
});

actor.start();
// logs 'Hello, David'
```

[Read more about input](input.mdx).

## Invoking actors with input

```ts
import { setup, createActor, fromPromise } from 'xstate';

const loadUserLogic = fromPromise(async ({ input }) => {
  const response = await fetch(
    `https://jsonplaceholder.typicode.com/users/${input.id}`,
  );
  const user = await response.json();
  return user;
});

const machine = setup({
  actors: {
    loadUserLogic,
  },
}).createMachine({
  initial: 'loading user',
  states: {
    'loading user': {
      invoke: {
        id: 'loadUser',
        src: 'loadUserLogic',
        // highlight-start
        input: {
          id: 3,
        },
        // highlight-end
        onDone: {
          actions: ({ event }) => {
            console.log(event.output);
          },
        },
      },
    },
  },
});

const actor = createActor(machine);

actor.start();
// eventually logs:
// { id: 3, name: 'Clementine Bauch', ... }
```

[Read more about invoking actors with input](input.mdx#invoking-actors-with-input).

## Types

```ts
import { setup, fromPromise } from 'xstate';

const promiseLogic = fromPromise(async () => {
  /* ... */
});

const machine = setup({
  types: {
    context: {} as {
      count: number;
    };
    events: {} as
      | { type: 'inc'; }
      | { type: 'dec' }
      | { type: 'incBy'; amount: number };
    actions: {} as
      | { type: 'notify'; params: { message: string } }
      | { type: 'handleChange' };
    guards: {} as
      | { type: 'canBeToggled' }
      | { type: 'isAfterTime'; params: { time: string } };
    children: {} as {
      promise1: 'someSrc';
      promise2: 'someSrc';
    };
    delays: 'shortTimeout' | 'longTimeout';
    tags: 'tag1' | 'tag2';
    input: number;
    output: string;
  },
  actors: {
    promiseLogic
  }
}).createMachine({
  // ...
});
```


# testing xstate machines

---
title: 'Testing'
description: 'How to test state machine and actor logic in XState'
---

## Testing logic

Testing actor logic is important for ensuring that the logic is correct and that it behaves as expected. You can test your state machines and actors using various testing libraries and tools. You should follow the **Arrange, Act, Assert** pattern when writing tests for your state machines and actors:

- **Arrange** - set up the test by creating the actor logics (such as a state machine) and the actors from the actor logics.
- **Act** - send event(s) to the actor(s).
- **Assert** - assert that the actor(s) reached their expected state(s) and/or executed the expected side effects.

```ts
import { setup, createActor } from 'xstate';
import { test, expect } from 'vitest';

test('some actor', async () => {
  const notifiedMessages: string[] = [];

  // 1. Arrange
  const machine = setup({
    actions: {
      notify: (_, params) => {
        notifiedMessages.push(params.message);
      },
    },
  }).createMachine({
    initial: 'inactive',
    states: {
      inactive: {
        on: { toggle: { target: 'active' } },
      },
      active: {
        entry: { type: 'notify', params: { message: 'Active!' } },
        on: { toggle: { target: 'inactive' } },
      },
    },
  });

  const actor = createActor(machine);

  // 2. Act
  actor.start();
  actor.send({ type: 'toggle' }); // => should be in 'active' state
  actor.send({ type: 'toggle' }); // => should be in 'inactive' state
  actor.send({ type: 'toggle' }); // => should be in 'active' state

  // 3. Assert
  expect(actor.getSnapshot().value).toBe('active');
  expect(notifiedMessages).toEqual(['Active!', 'Active!']);
});
```

:::studio

You can now [generate test paths from your state machines in Stately Studio](generate-test-paths.mdx). You can try Stately Studio’s premium plans with a free trial. [Check out the features on our Pro plan](studio-pro-plan.mdx), [Team plan](studio-team-plan.mdx), [Enterprise plan](studio-enterprise-plan.mdx) or [upgrade your existing plan](https://stately.ai/registry/billing).

:::

## Testing actors

When testing actors, you typically want to verify that they transition to the correct state and update their context appropriately when receiving events.

```ts
import { setup, createActor } from 'xstate';
import { test, expect } from 'vitest';

test('actor transitions correctly', () => {
  const toggleMachine = setup({}).createMachine({
    initial: 'inactive',
    context: { count: 0 },
    states: {
      inactive: {
        on: { 
          activate: { 
            target: 'active',
            actions: assign({ count: ({ context }) => context.count + 1 })
          }
        }
      },
      active: {
        on: { 
          deactivate: 'inactive' 
        }
      }
    }
  });

  const actor = createActor(toggleMachine);
  actor.start();

  // Test initial state
  expect(actor.getSnapshot().value).toBe('inactive');
  expect(actor.getSnapshot().context.count).toBe(0);

  // Send event and test transition
  actor.send({ type: 'activate' });
  
  expect(actor.getSnapshot().value).toBe('active');
  expect(actor.getSnapshot().context.count).toBe(1);

  // Send another event
  actor.send({ type: 'deactivate' });
  
  expect(actor.getSnapshot().value).toBe('inactive');
  expect(actor.getSnapshot().context.count).toBe(1);
});
```

## Mocking effects

When testing state machines that have side effects (like API calls, logging, or other external interactions), you should mock these effects to make your tests deterministic and isolated.

```ts
import { setup, createActor } from 'xstate';
import { test, expect, vi } from 'vitest';

test('mocking actions', () => {
  const mockLogger = vi.fn();
  
  const machine = setup({
    actions: {
      // Mock the logging action
      logMessage: mockLogger
    }
  }).createMachine({
    initial: 'idle',
    states: {
      idle: {
        on: {
          start: {
            target: 'running',
            actions: { 
              type: 'logMessage', 
              params: { message: 'Started!' } 
            }
          }
        }
      },
      running: {}
    }
  });

  const actor = createActor(machine);
  actor.start();
  
  actor.send({ type: 'start' });
  
  expect(actor.getSnapshot().value).toBe('running');
  expect(mockLogger).toHaveBeenCalledWith(
    expect.anything(), // action meta
    { message: 'Started!' } // params
  );
});
```

For promise-based actors, you can mock the promises:

```ts
test('mocking promise actors', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ data: 'test' });
  
  const machine = setup({
    actors: {
      fetchData: fromPromise(mockFetch)
    }
  }).createMachine({
    initial: 'idle',
    states: {
      idle: {
        on: {
          fetch: 'loading'
        }
      },
      loading: {
        invoke: {
          src: 'fetchData',
          onDone: 'success',
          onError: 'error'
        }
      },
      success: {},
      error: {}
    }
  });

  const actor = createActor(machine);
  actor.start();
  
  actor.send({ type: 'fetch' });
  
  // Wait for promise to resolve
  await new Promise(resolve => setTimeout(resolve, 0));
  
  expect(actor.getSnapshot().value).toBe('success');
  expect(mockFetch).toHaveBeenCalled();
});
```

## Using `@xstate/test`

:::warning

The XState Test model-based testing utilities have moved into `xstate` itself and are now available under `xstate/graph`. The standalone `@xstate/test` package is deprecated in favor of the integrated testing utilities.

:::

The model-based testing utilities allow you to automatically generate test cases from your state machines, ensuring comprehensive coverage of all possible paths and edge cases.

import { describe, it, expect } from 'vitest';
import {
  createActor,
  fromPromise,
  setup,
  assign,
  enqueueActions,
  type ActorRefFrom,
  and,
  not,
} from 'xstate';

// Define the actor logic once, to be used in both tests
const childActorLogic = fromPromise(
  async ({ input }: { input: { id: string } }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return `Child ${input.id} succeeded`;
  },
);

// Define the machine using the setup API for better type safety and dependency management
const parentMachine = setup({
  actors: {
    childActor: childActorLogic,
  },
  actions: {
    spawnChildren: enqueueActions(({ context, enqueue }) => {
      context.ids.forEach((id: string) => {
        enqueue.spawnChild('childActor', { id: `child-${id}`, input: { id } });
      });
    }),
    assignSpawnedCount: assign({
      spawnedCount: ({ context }) => context.ids.length,
    }),
  },
  guards: {
    allChildrenDone: ({ context }) => {
      const finishedCount =
        Object.keys(context.results).length +
        Object.keys(context.errors).length;
      return finishedCount === context.spawnedCount && context.spawnedCount > 0;
    },
    hasErrors: ({ context }) => {
      return Object.keys(context.errors).length > 0;
    },
  },
  types: {} as {
    events:
    | { type: 'START' }
    | { type: 'xstate.done.actor.*', output: string, actorId: string }
    | { type: 'xstate.error.actor.*', data: unknown, actorId: string }
  }
}).createMachine({
  id: 'parent',
  initial: 'idle',
  context: ({ input }: { input: { ids: string[] } }) => ({
    ids: input.ids,
    results: {} as Record<string, string>,
    errors: {} as Record<string, string>,
    spawnedCount: 0,
    __tempActor: null as ActorRefFrom<typeof childActorLogic> | null, // for type inference
  }),
  states: {
    idle: {
      on: {
        START: 'spawning',
      },
    },
    spawning: {
      entry: ['spawnChildren', 'assignSpawnedCount'],
      always: 'waiting',
    },
    waiting: {
      on: {
        'xstate.done.actor.*': {
          actions: assign({
            results: ({ context, event }) => {
              const id = event.actorId.replace('child-', '');
              return { ...context.results, [id]: event.output };
            },
          }),
          target: 'waiting', // Self-transition to re-evaluate always transitions
        },
        'xstate.error.actor.*': {
          actions: assign({
            errors: ({ context, event }) => {
              const id = event.actorId.replace('child-', '');
              const message = event.data instanceof Error ? event.data.message : 'Unknown error';
              return { ...context.errors, [id]: message };
            },
          }),
          target: 'waiting', // Self-transition to re-evaluate always transitions
        },
      },
      always: [
        {
          guard: and(['allChildrenDone', 'hasErrors']),
          target: 'failure',
        },
        {
          guard: and(['allChildrenDone', not('hasErrors')]),
          target: 'success',
        },
      ],
    },
    success: { type: 'final' },
    failure: { type: 'final' },
  },
});

describe('Dynamic Actor Pattern', () => {
  it('should successfully mock dynamically spawned child actors', async () => {
    // 1. Create an actor from the parent machine and start it
    const parentActor = createActor(parentMachine, {
      input: { ids: ['a', 'b', 'c'] },
    });
    parentActor.start();

    // 2. Send an event to trigger the spawning
    parentActor.send({ type: 'START' });

    // 3. Assert the final state and context
    await new Promise((resolve) => setTimeout(resolve, 100)); // wait for actors to finish

    const finalState = parentActor.getSnapshot();
    expect(finalState.status).toBe('done');
    expect(finalState.value).toBe('success');
    expect(Object.keys(finalState.context.results).length).toBe(3);
    expect(finalState.context.results['a']).toBe('Child a succeeded');
  });

  it('should handle errors by transitioning to the failure state when a mocked child actor fails', async () => {
    // 1. Define the mock logic that fails only for a specific ID
    const mockChildActorLogic = fromPromise<string, {id: string}>(
      async ({ input }: { input: { id: string } }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (input.id === 'b') {
          throw new Error(`Mock child ${input.id} failed deliberately`);
        }
        return `Child ${input.id} succeeded`;
      },
    );

    // 2. Create the parent actor and PROVIDE the mock implementation
    const parentActor = createActor(
      parentMachine.provide({
        actors: {
          childActor: mockChildActorLogic,
        },
      }),
      {
        input: { ids: ['a', 'b', 'c'] },
      },
    );

    // 3. Start the actor and send the event
    parentActor.start();
    parentActor.send({ type: 'START' });

    // 4. Assert the final state and context
    await new Promise((resolve) => setTimeout(resolve, 100)); // wait for actors to finish

    const finalState = parentActor.getSnapshot();
    expect(finalState.status).toBe('done');
    expect(finalState.value).toBe('failure');
    expect(Object.keys(finalState.context.errors).length).toBe(1);
    expect(finalState.context.results['a']).toBe('Child a succeeded');
    expect(finalState.context.errors['b']).toBe('Unknown error');
  });
});

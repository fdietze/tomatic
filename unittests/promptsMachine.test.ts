/**
 * @vitest-environment jsdom
 */
/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { promptsMachine } from '../src/machines/promptsMachine';
import { SystemPrompt } from '../src/types/storage';

const createTestPrompt = (overrides: Partial<SystemPrompt> & { name: string }): SystemPrompt => ({
    prompt: 'Test Prompt',
    ...overrides,
});

const mockPrompts: SystemPrompt[] = [
    createTestPrompt({ name: 'Prompt A' }),
    createTestPrompt({ name: 'Prompt B' }),
];

// 1. Create a mock function for the action that sends to parent
const mockNotifyParent = vi.fn();

// A test-specific version of the machine with mocks.
const createTestPromptsMachine = () => {
    const machineWithMocks = promptsMachine.provide({
        actions: {
            notifyParent: (context, event) => {
                console.log('[DEBUG] mockNotifyParent called with context:', context.context);
                mockNotifyParent(context, event);
            },
        },
        actors: {
            loadSystemPrompts: fromPromise(async () => {
                await vi.waitFor(() => {}, { timeout: 10 }); // short delay
                return structuredClone(mockPrompts);
            }),
            addPrompt: fromPromise(async ({ input }: { input: SystemPrompt }) => {
                await vi.waitFor(() => {}, { timeout: 10 });
                return input;
            }),
            updatePrompt: fromPromise(async ({ input }: { input: { oldName: string, prompt: SystemPrompt }}) => {
                await vi.waitFor(() => {}, { timeout: 10 });
                return input.prompt;
            }),
            deletePrompt: fromPromise(async ({ input }: { input: string }) => {
                await vi.waitFor(() => {}, { timeout: 10 });
                return input;
            }),
        }
    });
    return createActor(machineWithMocks);
};

describe('promptsMachine', () => {
    // Reset the mock before each test
    beforeEach(() => {
        mockNotifyParent.mockClear();
    });

    it('should load prompts and transition to idle', async () => {
        const actor = createTestPromptsMachine();
        actor.start();

        await vi.waitFor(() => {
            expect(actor.getSnapshot().value).toBe('idle');
        });

        const snapshot = actor.getSnapshot();
        expect(snapshot.context.systemPrompts).toHaveLength(2);
        expect(snapshot.context.systemPrompts[0]?.name).toBe('Prompt A');
        // It should be called once on initial load now
        expect(mockNotifyParent).toHaveBeenCalledTimes(1);
    });

    it('should optimistically add a prompt, save it, and notify parent', async () => {
        const actor = createTestPromptsMachine();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        // Clear mock calls from initial load to isolate the ADD action
        mockNotifyParent.mockClear();

        const newPrompt = createTestPrompt({ name: 'Prompt C' });
        actor.send({ type: 'ADD', prompt: newPrompt });

        // Check for optimistic update
        expect(actor.getSnapshot().context.systemPrompts).toHaveLength(3);
        expect(actor.getSnapshot().value).toBe('persistingAdd');

        // Check that it returns to idle after saving
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        expect(actor.getSnapshot().context.systemPrompts.find(p => p.name === 'Prompt C')).toBeDefined();

        // Assert that our mock was called correctly.
        expect(mockNotifyParent).toHaveBeenCalledTimes(1);
        const firstCallArgs = mockNotifyParent.mock.calls[0];
        expect(firstCallArgs).toBeDefined();
        const { context } = firstCallArgs![0];
        expect(context.systemPrompts).toHaveLength(3);
    });

    it('should revert an optimistic add on failure', async () => {
        const machineWithMocks = promptsMachine.provide({
            actions: {
                notifyParent: (context, event) => {
                    console.log('[DEBUG] mockNotifyParent called in revert test with context:', context.context);
                    mockNotifyParent(context, event);
                },
            },
            actors: {
                // This mock is used for the revert operation
                loadSystemPrompts: fromPromise(async () => structuredClone(mockPrompts)),
                addPrompt: fromPromise<SystemPrompt, SystemPrompt>(async () => { throw new Error('Save failed'); }),
            }
        });
        
        const actor = createActor(machineWithMocks);
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        mockNotifyParent.mockClear();
        
        const newPrompt = createTestPrompt({ name: 'Prompt C' });
        actor.send({ type: 'ADD', prompt: newPrompt });

        expect(actor.getSnapshot().context.systemPrompts).toHaveLength(3); // Optimistic update
        
        // Should go to loading to revert, then idle
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        // Check that the state has been reverted
        expect(actor.getSnapshot().context.systemPrompts).toHaveLength(2);
        // It's still called once for the initial successful load, but not for the failed add.
        expect(mockNotifyParent).toHaveBeenCalledTimes(1);
    });

    it('should optimistically update a prompt, save it, and notify parent', async () => {
        const actor = createTestPromptsMachine();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        mockNotifyParent.mockClear();
        
        const originalPrompt = mockPrompts[0];
        if (!originalPrompt) throw new Error("Test setup error: mock prompt is undefined");
        
        const updatedPrompt: SystemPrompt = { 
            ...originalPrompt, 
            prompt: 'Updated Content' 
        };
        actor.send({ type: 'UPDATE', oldName: 'Prompt A', prompt: updatedPrompt });

        expect(actor.getSnapshot().context.systemPrompts[0]?.prompt).toBe('Updated Content');
        expect(actor.getSnapshot().value).toBe('updating');
        
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        expect(actor.getSnapshot().context.systemPrompts[0]?.prompt).toBe('Updated Content');

        expect(mockNotifyParent).toHaveBeenCalledTimes(1);
        const firstCallArgs = mockNotifyParent.mock.calls[0];
        expect(firstCallArgs).toBeDefined();
        const { context } = firstCallArgs![0];
        expect(context.systemPrompts.find((p: SystemPrompt) => p.name === 'Prompt A')?.prompt).toBe('Updated Content');
    });
    
    it('should optimistically delete a prompt and notify parent', async () => {
        const actor = createTestPromptsMachine();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        mockNotifyParent.mockClear();

        actor.send({ type: 'DELETE', name: 'Prompt A' });

        expect(actor.getSnapshot().context.systemPrompts).toHaveLength(1);
        expect(actor.getSnapshot().value).toBe('deleting');

        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        expect(actor.getSnapshot().context.systemPrompts).toHaveLength(1);
        expect(actor.getSnapshot().context.systemPrompts.find(p => p.name === 'Prompt A')).toBeUndefined();

        expect(mockNotifyParent).toHaveBeenCalledTimes(1);
        const firstCallArgs = mockNotifyParent.mock.calls[0];
        expect(firstCallArgs).toBeDefined();
        const { context } = firstCallArgs![0];
        expect(context.systemPrompts).toHaveLength(1);
    });
});

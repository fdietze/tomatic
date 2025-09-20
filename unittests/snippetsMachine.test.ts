/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { snippetsMachine, AllSnippetsMachineEvents } from '../src/machines/snippetsMachine';
import { Snippet } from '../src/types/storage';
import { settingsMachine } from '../src/machines/settingsMachine';
import { promptsMachine } from '../src/machines/promptsMachine';
import { ActorRefFrom } from 'xstate';
import { snippetRegenerationMachineSetup } from '../src/machines/snippetRegenerationMachine';

// A no-op regenerator that never completes on its own; the test drives completion by sending
// explicit events to the parent machine.
const noopRegenerationMachine = snippetRegenerationMachineSetup.createMachine({
    id: 'snippetRegenerator',
    initial: 'regenerating',
    context: ({ input }) => ({
        name: input.snippet.name,
        error: null,
        result: null,
        input,
    }),
    states: {
        regenerating: {
            on: {}
        },
        failed: {},
        done: { type: 'final' }
    }
});

vi.mock('../src/services/chatService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/services/chatService')>();
    return {
        ...actual,
        streamChatResponse: vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
                finalMessages: [],
                assistantResponse: 'Mocked regeneration response',
            };
        }),
    };
});

// Mock the entire database layer that any of the machines might depend on
vi.mock('../src/services/db/snippets', () => ({
    loadAllSnippets: vi.fn().mockResolvedValue([]),
    saveSnippet: vi.fn().mockResolvedValue(undefined),
    deleteSnippet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/db/system-prompts', () => ({
    loadAllSystemPrompts: vi.fn().mockResolvedValue([]),
    saveSystemPrompt: vi.fn().mockResolvedValue(undefined),
    deleteSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

const createTestSnippet = (overrides: Partial<Snippet> & { name: string }): Snippet => ({
  content: '',
  isGenerated: false,
  prompt: '',
  model: undefined,
  createdAt_ms: Date.now(),
  updatedAt_ms: Date.now(),
  generationError: null,
  isDirty: false,
  ...overrides,
});

// Mocks for actor dependencies
const mockSettingsActor = createActor(settingsMachine);
mockSettingsActor.start();
const mockPromptsActor = createActor(promptsMachine);

describe('snippetsMachine', () => {
    const mockNotifyParent = vi.fn();

    beforeEach(() => {
        mockNotifyParent.mockClear();
    });

    describe('Snippet Regeneration Orchestration', () => {
        it('spawns regeneration actors for all transitive dependents on UPDATE', async () => {
            const snippets: Snippet[] = [
                createTestSnippet({ name: 'C', content: 'base' }),
                createTestSnippet({ name: 'B', prompt: 'uses @C', content: 'old stuff', isGenerated: true }),
                createTestSnippet({ name: 'A', prompt: 'uses @B', content: 'old stuff', isGenerated: true }),
                createTestSnippet({ name: 'D', content: 'unused' }),
            ];

            const machineWithPreloadedSnippets = snippetsMachine.provide({
                actors: {
                    loadSnippets: fromPromise(async () => snippets),
                    updateSnippet: fromPromise(async ({ input }) => input.snippet),
                    regenerateSnippet: noopRegenerationMachine,
                },
                actions: {
                    notifyParent: () => {},
                }
            });

            const testMachine = createActor(machineWithPreloadedSnippets, {
                input: {
                    settingsActor: mockSettingsActor,
                    promptsActor: mockPromptsActor,
                },
            });

            testMachine.start();
            
            await vi.waitFor(() => {
                expect(testMachine.getSnapshot().value).toBe('idle');
            });

            const updatedSnippetC = { ...snippets.find(s => s.name === 'C')!, content: 'new base content' };
            const updateEvent: AllSnippetsMachineEvents = {
                type: 'UPDATE',
                oldName: 'C',
                snippet: updatedSnippetC,
            };
            testMachine.send(updateEvent);

            // 1. Wait for the machine to enter the 'regenerating' state
            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('regenerating'));
            
            // 2. Assertions while in the regenerating state
            const regeneratingSnapshot = testMachine.getSnapshot();
            expect(regeneratingSnapshot.context.regeneratingSnippetNames).toHaveLength(2);
            expect(regeneratingSnapshot.context.regeneratingSnippetNames).toContain('A');
            expect(regeneratingSnapshot.context.regeneratingSnippetNames).toContain('B');
            
            // 3. Manually drive completion events to the parent in deterministic order
            testMachine.send({ type: 'snippet.regeneration.done', name: 'B', content: 'Mocked regeneration response' });
            testMachine.send({ type: 'snippet.regeneration.done', name: 'A', content: 'Mocked regeneration response' });

            // 4. Wait for the regeneration to complete and return to 'idle'
            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('idle'));
            expect(testMachine.getSnapshot().context.regeneratingSnippetNames).toHaveLength(0);

            // 4. Assert final content
            const finalSnapshot = testMachine.getSnapshot();
            const snippetA = finalSnapshot.context.snippets.find(s => s.name === 'A');
            const snippetB = finalSnapshot.context.snippets.find(s => s.name === 'B');
            expect(snippetA?.content).toBe('Mocked regeneration response');
            expect(snippetB?.content).toBe('Mocked regeneration response');
        });

        it('correctly waits for all child regeneration actors to complete before returning to idle', async () => {
            // Purpose: This test ensures the machine does not prematurely exit the 'regenerating'
            // state when child actors take time to complete. It uses manually controlled mock
            // actors to simulate asynchronicity.

            // 1. Arrange: Create a mock machine that can be controlled manually
            const mockRegenerationMachine = noopRegenerationMachine;

            const snippets: Snippet[] = [
                createTestSnippet({ name: 'C', content: 'base' }),
                createTestSnippet({ name: 'B', prompt: 'uses @C', content: 'old stuff', isGenerated: true }),
                createTestSnippet({ name: 'A', prompt: 'uses @B', content: 'old stuff', isGenerated: true }),
            ];

            const machineWithMocks = snippetsMachine.provide({
                actors: {
                    loadSnippets: fromPromise(async () => snippets),
                    regenerateSnippet: mockRegenerationMachine,
                    updateSnippet: fromPromise(async ({ input }) => input.snippet),
                },
                actions: {
                    notifyParent: () => {},
                }
            });

            const testMachine = createActor(machineWithMocks, {
                input: { settingsActor: mockSettingsActor, promptsActor: mockPromptsActor },
            });
            
            // Hacky way to get actor refs before starting the machine
            let actorRefs: ActorRefFrom<typeof mockRegenerationMachine>[] = [];
            testMachine.subscribe(snapshot => {
                actorRefs = Object.values(snapshot.children) as ActorRefFrom<typeof mockRegenerationMachine>[];
            });

            testMachine.start();


            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('idle'));

            // 2. Act
            testMachine.send({ type: 'UPDATE', oldName: 'C', snippet: { ...snippets[0]!, content: 'new' } });

            // 3. Assert
            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('regenerating'));
            expect(testMachine.getSnapshot().context.regeneratingSnippetNames).toHaveLength(2);

            const actorA = Object.values(actorRefs).find(a => a.id.endsWith('A'));
            const actorB = Object.values(actorRefs).find(a => a.id.endsWith('B'));
            expect(actorA).toBeDefined();
            expect(actorB).toBeDefined();

            // Drive only one completion; ensure we are still regenerating
            testMachine.send({ type: 'snippet.regeneration.done', name: 'B', content: 'Mocked content' });
            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('regenerating'));
            expect(testMachine.getSnapshot().context.regeneratingSnippetNames).toHaveLength(1);

            // Drive the second completion; now we should return to idle
            testMachine.send({ type: 'snippet.regeneration.done', name: 'A', content: 'Mocked content' });
            await vi.waitFor(() => expect(testMachine.getSnapshot().value).toBe('idle'));
            expect(testMachine.getSnapshot().context.regeneratingSnippetNames).toHaveLength(0);
        });

        it.skip('should use the updated snippet content when calculating transitive dependencies for regeneration', async () => {
            // This test is skipped because its mock setup requires the machine to be fully typed first.
            // It will be re-enabled after the foundational type-safety refactoring is complete.
            
            // TODO: Re-enable and implement this test after refactoring.
        });
    });
});

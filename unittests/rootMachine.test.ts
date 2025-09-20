/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { rootMachine } from '../src/machines/rootMachine';
import { settingsMachine, SettingsSnapshot } from '../src/machines/settingsMachine';
import { promptsMachine, PromptsSnapshot } from '../src/machines/promptsMachine';
import { snippetsMachine, SnippetsSnapshot } from '../src/machines/snippetsMachine';
import { modelsMachine, ModelsSnapshot } from '../src/machines/modelsMachine';
import { sessionMachine, LoadSessionOutput } from '../src/machines/sessionMachine';

// Provide inert, synchronous versions of the child machines for testing the root orchestrator.
const inertSettingsMachine = settingsMachine.provide({
    actors: {
        loadSettings: fromPromise(async () => ({} as Partial<SettingsSnapshot['context']>)),
        saveSettings: fromPromise(async () => ({} as SettingsSnapshot['context'])),
    }
});
const inertPromptsMachine = promptsMachine.provide({
    actors: {
        loadSystemPrompts: fromPromise(async () => [] as PromptsSnapshot['context']['systemPrompts']),
    }
});
const inertSnippetsMachine = snippetsMachine.provide({
    actors: {
        loadSnippets: fromPromise(async () => [] as SnippetsSnapshot['context']['snippets']),
    }
});
const inertModelsMachine = modelsMachine.provide({
    actors: {
        fetchModels: fromPromise(async () => [] as ModelsSnapshot['context']['cachedModels']),
    }
});
const inertSessionMachine = sessionMachine.provide({
    actors: {
        loadSession: fromPromise(async () => ({ messages: [], sessionId: '', prevId: null, nextId: null } as LoadSessionOutput)),
    }
});


describe('rootMachine', () => {
  it('should spawn all child actors on start', () => {
    const testRootMachine = rootMachine.provide({
        actors: {
            settings: inertSettingsMachine,
            prompts: inertPromptsMachine,
            snippets: inertSnippetsMachine,
            models: inertModelsMachine,
            session: inertSessionMachine,
        }
    });
    const rootActor = createActor(testRootMachine).start();
    const snapshot = rootActor.getSnapshot();
    expect(snapshot.children.settings).toBeDefined();
    expect(snapshot.children.prompts).toBeDefined();
    expect(snapshot.children.snippets).toBeDefined();
    expect(snapshot.children.models).toBeDefined();
    expect(snapshot.children.session).toBeDefined();
  });

  it('should trigger forwarding logic on SETTINGS_UPDATED', () => {
    const mockForwardAction = vi.fn();
    const testRootMachine = rootMachine.provide({
        actors: {
            settings: inertSettingsMachine,
            prompts: inertPromptsMachine,
            snippets: inertSnippetsMachine,
            models: inertModelsMachine,
            session: inertSessionMachine,
        },
        actions: {
            forwardSettingsUpdate: mockForwardAction,
        }
    });

    const rootActor = createActor(testRootMachine).start();
    const mockSettingsSnapshot = {} as SettingsSnapshot;
    rootActor.send({ type: 'SETTINGS_UPDATED', settings: mockSettingsSnapshot });
    expect(mockForwardAction).toHaveBeenCalled();
  });

  it('should trigger forwarding logic on PROMPTS_UPDATED', () => {
    const mockForwardAction = vi.fn();
    const testRootMachine = rootMachine.provide({
        actors: {
            settings: inertSettingsMachine,
            prompts: inertPromptsMachine,
            snippets: inertSnippetsMachine,
            models: inertModelsMachine,
            session: inertSessionMachine,
        },
        actions: {
            forwardPromptsUpdate: mockForwardAction,
        }
    });
    const rootActor = createActor(testRootMachine).start();
    const mockPromptsSnapshot = {} as PromptsSnapshot;
    rootActor.send({ type: 'PROMPTS_UPDATED', prompts: mockPromptsSnapshot });
    expect(mockForwardAction).toHaveBeenCalled();
  });

  it('should trigger forwarding logic on SNIPPETS_UPDATED', () => {
    const mockForwardAction = vi.fn();
    const testRootMachine = rootMachine.provide({
        actors: {
            settings: inertSettingsMachine,
            prompts: inertPromptsMachine,
            snippets: inertSnippetsMachine,
            models: inertModelsMachine,
            session: inertSessionMachine,
        },
        actions: {
            forwardSnippetsUpdate: mockForwardAction,
        }
    });
    const rootActor = createActor(testRootMachine).start();
    const mockSnippetsSnapshot = {} as SnippetsSnapshot;
    rootActor.send({ type: 'SNIPPETS_UPDATED', snippets: mockSnippetsSnapshot });
    expect(mockForwardAction).toHaveBeenCalled();
  });
});

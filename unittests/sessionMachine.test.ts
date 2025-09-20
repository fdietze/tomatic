// Add imports
import { createActor } from 'xstate';
import { settingsMachine, SettingsSnapshot } from '../src/machines/settingsMachine';
import { promptsMachine, PromptsSnapshot } from '../src/machines/promptsMachine';
import { snippetsMachine, SnippetsSnapshot } from '../src/machines/snippetsMachine';
import { sessionMachine } from '../src/machines/sessionMachine';

// Create real actors for mocks (inert)
const mockSettingsActor = createActor(settingsMachine).start();
const mockPromptsActor = createActor(promptsMachine).start();
const mockSnippetsActor = createActor(snippetsMachine, {
  input: { promptsActor: mockPromptsActor, settingsActor: mockSettingsActor }
}).start();

// In tests, use these

// For send, provide full snapshots, e.g.
// actor.send({ type: 'SETTINGS_UPDATED', settings: mockSettingsActor.getSnapshot() as SettingsSnapshot });
// actor.send({ type: 'PROMPTS_UPDATED', prompts: mockPromptsActor.getSnapshot() as PromptsSnapshot });
// actor.send({ type: 'SNIPPETS_UPDATED', snippets: mockSnippetsActor.getSnapshot() as SnippetsSnapshot });

describe('sessionMachine', () => {
  it('queues SUBMIT_USER_MESSAGE while in waitingForDependencies', () => {
    const actor = createActor(sessionMachine, {
      input: { settingsActor: mockSettingsActor, promptsActor: mockPromptsActor, snippetsActor: mockSnippetsActor }
    });
    actor.start();
    actor.send({ type: 'SUBMIT_USER_MESSAGE', message: 'Early submit' });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('waitingForDependencies');
    expect(snapshot.context.pendingEvents).toHaveLength(1);
    expect(snapshot.context.pendingEvents[0]!.type).toBe('SUBMIT_USER_MESSAGE');
  });

  it('processes queued events when entering idle', async () => {
    const actor = createActor(sessionMachine, {
      input: { settingsActor: mockSettingsActor, promptsActor: mockPromptsActor, snippetsActor: mockSnippetsActor }
    });
    actor.start();
    actor.send({ type: 'SUBMIT_USER_MESSAGE', message: 'Queued' });
    // Simulate readiness
    actor.send({ type: 'SETTINGS_UPDATED', settings: mockSettingsActor.getSnapshot() as SettingsSnapshot });
    actor.send({ type: 'PROMPTS_UPDATED', prompts: mockPromptsActor.getSnapshot() as PromptsSnapshot });
    actor.send({ type: 'SNIPPETS_UPDATED', snippets: mockSnippetsActor.getSnapshot() as SnippetsSnapshot });
    actor.send({ type: 'CHECK_READY' });

    // Increase polling attempts or time if needed
    let attempts = 0;
    while (actor.getSnapshot().value !== 'processingSubmission' && attempts < 20) {
      await new Promise(r => setTimeout(r, 10));
      attempts++;
    }
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('processingSubmission');
    expect(snapshot.context.pendingEvents).toHaveLength(0);
  });
});

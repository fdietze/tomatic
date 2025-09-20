/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import { createActor } from 'xstate';
import { settingsMachine, SettingsContext } from '../src/machines/settingsMachine';
import * as settingsPersistence from '../src/services/persistence/settings';
import { fromPromise } from 'xstate';

// Mock the persistence layer
vi.mock('../src/services/persistence/settings', () => ({
    loadSettings: vi.fn().mockReturnValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe('settingsMachine', () => {
    // A test-specific version of the machine with the notifyParent action mocked.
    const createTestActor = () => {
        const mockNotifyParent = vi.fn();
        const machineWithMocks = settingsMachine.provide({
            actions: {
                notifyParent: mockNotifyParent,
            },
            actors: {
                // Make saveSettings resolve immediately in tests
                saveSettings: fromPromise(async ({ input }: { input: SettingsContext }) => {
                    settingsPersistence.saveSettings(input);
                    return input;
                }),
            }
        });
        const actor = createActor(machineWithMocks);
        return { actor, mockNotifyParent };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(settingsPersistence, 'loadSettings').mockReturnValue({});
    });

    it('should start in the loading state', () => {
        const { actor } = createTestActor();
        actor.start();
        expect(actor.getSnapshot().value).toBe('loading');
    });

    it('should transition to idle after successfully loading settings', async () => {
        const mockSettings: Partial<SettingsContext> = { apiKey: 'test-key', modelName: 'test-model' };
        vi.spyOn(settingsPersistence, 'loadSettings').mockReturnValue(mockSettings);

        const { actor } = createTestActor();
        actor.start();

        await vi.waitFor(() => {
            // eslint-disable-next-line jest/no-standalone-expect
            expect(actor.getSnapshot().value).toBe('idle');
        });

        const snapshot = actor.getSnapshot();
        expect(snapshot.context.apiKey).toBe('test-key');
        expect(snapshot.context.modelName).toBe('test-model');
        expect(snapshot.context.isInitializing).toBe(false);
    });

    it('should handle settings loading failure', async () => {
        vi.spyOn(settingsPersistence, 'loadSettings').mockImplementation(() => { throw new Error('Load failed'); });

        const { actor } = createTestActor();
        actor.start();

        await vi.waitFor(() => {
            // eslint-disable-next-line jest/no-standalone-expect
            expect(actor.getSnapshot().value).toBe('failure');
        });

        const snapshot = actor.getSnapshot();
        expect(snapshot.context.error).toBe('Failed to load settings');
        expect(snapshot.context.isInitializing).toBe(false);
    });

    // Test each SET_* event
    it('should update apiKey, save, and notify on SET_API_KEY', async () => {
        const { actor, mockNotifyParent } = createTestActor();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        actor.send({ type: 'SET_API_KEY', key: 'new-api-key' });

        // Optimistic update
        expect(actor.getSnapshot().context.apiKey).toBe('new-api-key');
        // Should be saving
        expect(actor.getSnapshot().value).toBe('saving');

        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        expect(settingsPersistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            apiKey: 'new-api-key',
        }));
        expect(mockNotifyParent).toHaveBeenCalled();
    });

    it('should update modelName, save, and notify on SET_MODEL_NAME', async () => {
        const { actor, mockNotifyParent } = createTestActor();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        
        actor.send({ type: 'SET_MODEL_NAME', name: 'new-model' });

        expect(actor.getSnapshot().context.modelName).toBe('new-model');
        expect(actor.getSnapshot().value).toBe('saving');

        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        expect(settingsPersistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            modelName: 'new-model',
        }));
        expect(mockNotifyParent).toHaveBeenCalled();
    });

    it('should update input without saving on SET_INPUT', async () => {
        const { actor, mockNotifyParent } = createTestActor();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        mockNotifyParent.mockClear();

        actor.send({ type: 'SET_INPUT', text: 'hello' });

        expect(actor.getSnapshot().context.input).toBe('hello');
        expect(actor.getSnapshot().value).toBe('idle'); // Should not transition
        expect(settingsPersistence.saveSettings).not.toHaveBeenCalled();
        expect(mockNotifyParent).not.toHaveBeenCalled();
    });

    it('should toggle autoScrollEnabled, save, and notify on TOGGLE_AUTO_SCROLL', async () => {
        const { actor, mockNotifyParent } = createTestActor();
        actor.start();
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));
        const initialValue = actor.getSnapshot().context.autoScrollEnabled;

        actor.send({ type: 'TOGGLE_AUTO_SCROLL' });
        
        expect(actor.getSnapshot().context.autoScrollEnabled).toBe(!initialValue);
        expect(actor.getSnapshot().value).toBe('saving');

        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('idle'));

        expect(settingsPersistence.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            autoScrollEnabled: !initialValue,
        }));
        expect(mockNotifyParent).toHaveBeenCalled();
    });
});

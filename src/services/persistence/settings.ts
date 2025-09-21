import { SettingsState } from '@/store/features/settings/settingsSlice';

const STORAGE_KEY = 'tomatic-storage';

export const loadSettings = (): Partial<SettingsState> => {
    try {
        const serializedState = localStorage.getItem(STORAGE_KEY);
        if (serializedState === null) {
            return {};
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const stored: { state: Partial<SettingsState> } = JSON.parse(serializedState);
        // We only care about the 'state' property of the stored object.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return stored.state || {};
    } catch (error) {
        console.error("Error loading settings from localStorage:", error);
        return {};
    }
};

export const saveSettings = (state: SettingsState): void => {
    try {
        const stateToSave = {
            state: state,
            version: 1,
        };
        const serializedState = JSON.stringify(stateToSave);
        localStorage.setItem(STORAGE_KEY, serializedState);
    } catch (error) {
        console.error("Error saving settings to localStorage:", error);
    }
};

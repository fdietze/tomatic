import { SettingsState } from '@/store/features/settings/settingsSlice';
import { localStorageSchema, PersistedSettingsState } from './schemas';

const STORAGE_KEY = 'tomatic-storage';

export const loadSettings = (): Partial<SettingsState> => {
    try {
        const serializedState = localStorage.getItem(STORAGE_KEY);
        if (serializedState === null) {
            return {};
        }
        
        // Parse and validate the localStorage data using Zod
        const parseResult = localStorageSchema.safeParse(JSON.parse(serializedState));
        if (!parseResult.success) {
            console.log('[Settings] Invalid localStorage data structure, using defaults:', parseResult.error.format());
            return {};
        }
        
        return parseResult.data.state;
    } catch (error) {
        console.log('[Settings] Error loading settings from localStorage:', error);
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
        console.log("Error saving settings to localStorage:", error);
    }
};

import { SettingsState } from '@/store/features/settings/settingsSlice';
import { localStorageSchema } from './schemas';
import { migrateLocalStorage, CURRENT_LOCALSTORAGE_VERSION } from './migrations';

const STORAGE_KEY = 'tomatic-storage';

export const loadSettings = (): Partial<SettingsState> => {
    try {
        const serializedState = localStorage.getItem(STORAGE_KEY);
        if (serializedState === null) {
            return {};
        }
        
        // Parse the raw data first
        const rawData = JSON.parse(serializedState);
        
        // Handle migration if needed
        let migratedData;
        try {
            migratedData = migrateLocalStorage(rawData);
        } catch (migrationError) {
            console.log('[Settings] Migration failed, using defaults:', migrationError);
            return {};
        }
        
        // Validate the migrated data using Zod
        const parseResult = localStorageSchema.safeParse(migratedData);
        if (!parseResult.success) {
            console.log('[Settings] Invalid localStorage data structure after migration, using defaults:', parseResult.error.format());
            return {};
        }
        
        // If migration occurred, save the migrated data back to localStorage
        if (rawData.version !== CURRENT_LOCALSTORAGE_VERSION) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedData));
            console.log(`[Settings] Migrated localStorage from version ${rawData.version} to ${CURRENT_LOCALSTORAGE_VERSION}`);
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
            version: CURRENT_LOCALSTORAGE_VERSION,
        };
        const serializedState = JSON.stringify(stateToSave);
        localStorage.setItem(STORAGE_KEY, serializedState);
    } catch (error) {
        console.log("Error saving settings to localStorage:", error);
    }
};

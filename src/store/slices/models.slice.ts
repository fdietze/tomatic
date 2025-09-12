import { StateCreator } from 'zustand';
import { AppState, ModelsSlice } from '@/store/types';
import { listAvailableModels } from '@/api/openrouter';

export const createModelsSlice: StateCreator<
    AppState,
    [],
    [],
    ModelsSlice
> = (set) => ({
    cachedModels: [],
    modelsLoading: false,
    modelsError: null,
    fetchModelList: async () => {
        set({ modelsLoading: true, modelsError: null });
        console.debug('[STORE|fetchModelList] Fetching model list...');
        try {
            const models = await listAvailableModels();
            set({ cachedModels: models, modelsLoading: false });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.error(`[STORE|fetchModelList] Failed to fetch models: ${error}`);
            set({ modelsError: error, modelsLoading: false });
        }
    },
});
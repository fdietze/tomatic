// A mapping of event names to their corresponding CustomEvent types.
// This allows for strong typing of event dispatching and listening.
interface AppEvents {
    'app_initialized': CustomEvent<void>;
    'app:models_loaded': CustomEvent<{ success: boolean; count: number }>;
    'snippet_regeneration_started': CustomEvent<void>;
    'snippet_regeneration_completed': CustomEvent<void>;
    'snippet_regeneration_update': SnippetRegenerationUpdateEvent;
    'db_migration_complete': CustomEvent<{ from: number; to: number }>;
}

export interface SnippetRegenerationUpdatePayload {
    name: string;
    status: 'success' | 'failure';
    error?: string;
}

export class SnippetRegenerationUpdateEvent extends CustomEvent<SnippetRegenerationUpdatePayload> {
    constructor(detail: SnippetRegenerationUpdatePayload) {
        super('snippet_regeneration_update', { detail });
    }
}


export function dispatchEvent<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]['detail']): void {
  console.log(`[EVENT]: ${name}`, detail);
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Waits for a specific set of snippets to complete regeneration.
 * @param names The array of snippet names to wait for.
 * @param timeout_ms The maximum time to wait per snippet in milliseconds.
 * @returns A promise that resolves when all specified snippets have regenerated, or rejects on failure or timeout.
 */
export function waitForSnippets(names: string[], timeout_ms = 120000): Promise<void> {
    return new Promise((resolve, reject) => {
        const waitingFor = new Set(names);
        const timeouts = new Map<string, NodeJS.Timeout>();

        const cleanup = (): void => {
            window.removeEventListener('snippet_regeneration_update', listener);
            for (const timeoutId of timeouts.values()) {
                clearTimeout(timeoutId);
            }
        };

        const listener = (event: Event): void => {
            const detail = (event as CustomEvent<SnippetRegenerationUpdatePayload>).detail;
            if (!waitingFor.has(detail.name)) {
                return;
            }

            const timeoutId = timeouts.get(detail.name);
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeouts.delete(detail.name);
            }

            if (detail.status === 'failure') {
                cleanup();
                reject(new Error(`Snippet '@${detail.name}' failed to regenerate: ${detail.error ?? 'Unknown error'}`));
                return;
            }

            waitingFor.delete(detail.name);

            if (waitingFor.size === 0) {
                cleanup();
                resolve();
            }
        };

        window.addEventListener('snippet_regeneration_update', listener);

        for (const name of names) {
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out after ${String(timeout_ms / 1000)}s waiting for snippet '@${name}' to regenerate.`));
            }, timeout_ms);
            timeouts.set(name, timeoutId);
        }
    });
}

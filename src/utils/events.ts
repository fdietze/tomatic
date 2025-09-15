// A mapping of event names to their corresponding CustomEvent types.
// This allows for strong typing of event dispatching and listening.
interface AppEvents {
    'app_initialized': CustomEvent<void>;
    'snippet_regeneration_started': CustomEvent<void>;
    'snippet_regeneration_completed': CustomEvent<void>;
    'snippet_regeneration_update': SnippetRegenerationUpdateEvent;
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
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

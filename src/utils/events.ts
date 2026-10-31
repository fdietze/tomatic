// Window CustomEvents that the app announces so e2e tests can observe progress
// (tests/fixtures.ts records them, tests/test-helpers.ts `waitForEvent` waits on them).
// They are observation hooks only: app code never listens to them, so control flow
// between sagas stays in redux-saga (`call`/`take`), where it is typed and testable.
interface AppEvents {
    'app_initialized': undefined;
    'app:models_loaded': { success: boolean; count: number };
    'db_migration_complete': { from: number; to: number };
    'app:snippet:regeneration:start': SnippetRef;
    'app:snippet:regeneration:complete': SnippetRef;
}

interface SnippetRef {
    id: string;
    name: string;
}

export function dispatchEvent<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]): void {
  console.log(`[EVENT]: ${name}`, detail);
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

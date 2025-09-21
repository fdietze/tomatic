import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { openTomaticDB } from "./persistence";

// Mock the event dispatcher to avoid window is not defined error in Node.js env
vi.mock("@/utils/events", () => ({
  dispatchEvent: vi.fn(),
}));

describe("Database Persistence & Migrations", () => {
  // Before each test, we need to clear all fake IndexedDB databases
  // to ensure we are starting with a clean slate (version 0).
  beforeEach(() => {
    // FDBFactory is the fake implementation of IDBFactory
    const FDBFactory = new IDBFactory();
    FDBFactory.deleteDatabase("tomatic_chat_db");
  });

  test("should correctly set up the database schema from version 0 to the latest version", async () => {
    // Purpose: This test verifies that the database migration logic correctly creates all
    // necessary object stores and indexes when initializing a new database from scratch.

    // 1. Open the database, which will trigger the `upgrade` handlers
    const db = await openTomaticDB();

    // 2. Assert the final database version
    expect(db.version).toBe(3);

    // 3. Assert that all expected object stores were created
    const storeNames = db.objectStoreNames;
    expect(storeNames).toContain("chat_sessions");
    expect(storeNames).toContain("system_prompts");
    expect(storeNames).toContain("snippets");

    // 4. Assert that indexes were created correctly
    // To do this, we need to start a transaction and inspect the object store.
    const tx = db.transaction("chat_sessions", "readonly");
    const chatSessionsStore = tx.objectStore("chat_sessions");
    expect(chatSessionsStore.indexNames).toContain("updated_at_ms");

    // 5. Clean up the connection
    db.close();
  });
});

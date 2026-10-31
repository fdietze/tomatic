import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// Mock events module to avoid window-related errors in Node test environment
vi.mock("@/utils/events", () => ({
  dispatchEvent: vi.fn(),
}));

describe("Feature: corrupted IndexedDB records are reported, not hidden", () => {
  beforeEach(async () => {
    // Fresh database per test: close the cached connection, reset modules so the next
    // import of ./persistence opens a new dbPromise, then delete the old database.
    const { closeDbForTesting } = await import("./persistence");
    await closeDbForTesting();
    vi.resetModules();
    const { deleteDB } = await import("idb");
    await deleteDB("tomatic_chat_db");
  });

  async function putRaw(storeName: "snippets" | "system_prompts" | "chat_sessions", value: unknown) {
    const { dbPromise } = await import("./persistence");
    const db = await dbPromise;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately writing an invalid record
    await db.put(storeName, value as any);
  }

  it("loadAllSnippets rejects instead of returning an empty list", async () => {
    // Purpose: req:snippet-storage-errors-visible - one invalid snippet record must surface as a load error,
    // not make all snippets silently disappear.
    await putRaw("snippets", { id: "broken", name: "broken" });
    const { loadAllSnippets } = await import("./persistence");

    await expect(loadAllSnippets()).rejects.toThrow(/Stored snippets are invalid/);
  });

  it("loadAllSystemPrompts rejects instead of returning an empty list", async () => {
    // Purpose: req:snippet-storage-errors-visible - an invalid system prompt record surfaces as a load error.
    await putRaw("system_prompts", { name: "broken" });
    const { loadAllSystemPrompts } = await import("./persistence");

    await expect(loadAllSystemPrompts()).rejects.toThrow(/Stored system prompts are invalid/);
  });

  it("loadSession rejects for an invalid session instead of reporting it as missing", async () => {
    // Purpose: a corrupted session must not be reported as "Session not found."
    await putRaw("chat_sessions", { session_id: "broken" });
    const { loadSession } = await import("./db/chat-sessions");

    await expect(loadSession("broken")).rejects.toThrow(/Stored session 'broken' is invalid/);
  });
});

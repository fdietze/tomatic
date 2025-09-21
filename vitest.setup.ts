import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import { beforeEach, afterEach, vi } from "vitest";
import type { TestContext } from "vitest";
import { MockInstance } from "vitest";
import "@testing-library/jest-dom";

vi.mock("@/api/openrouter", () => ({
  requestMessageContent: vi.fn(),
}));

let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;
const logBuffer: unknown[][] = [];

// This ReadableStream is a polyfill for the web API
// It's needed for our fetch mock below
if (typeof ReadableStream === "undefined") {
  global.ReadableStream = require("web-streams-polyfill").ReadableStream;
}

beforeEach(() => {
  consoleLogSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      logBuffer.push(args);
    });
  consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      logBuffer.push(args);
      throw new Error(args.join(" "));
    });
});

afterEach((context: TestContext) => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();

  if (context.task.result?.state === "fail") {
    console.log(`logs for test '${context.task.name}'`);
    logBuffer.forEach((args) => console.log(...args));
  }

  logBuffer.length = 0;
});

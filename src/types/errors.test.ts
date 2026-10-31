import { describe, test, expect } from "vitest";
import { createAppError, toAppError } from "./errors";

describe("Feature: toAppError", () => {
  test("an AppError keeps its type and details", () => {
    // Purpose: regression for API errors thrown as AppError values (src/api/openrouter.ts) being shown as
    // 'An unknown error occurred'.
    const apiError = createAppError.api("rate limited", 429, "chat.completions.create");
    expect(toAppError(apiError)).toBe(apiError);
  });

  test("an Error becomes an unknown error with its message", () => {
    // Purpose: plain exceptions keep their message for display.
    expect(toAppError(new Error("boom"))).toEqual({ type: "UNKNOWN_ERROR", message: "boom" });
  });

  test("an object that merely has a type field is not mistaken for an AppError", () => {
    // Purpose: only the known AppError variants pass through unchanged.
    expect(toAppError({ type: "SOMETHING_ELSE" })).toEqual({ type: "UNKNOWN_ERROR", message: "An unknown error occurred" });
  });
});

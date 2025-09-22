export function assertUnreachable(x: never): never {
  console.error(`[BUG] Unexpected value reached in assertUnreachable:`, x);
  throw new Error(`[BUG] Unexpected value reached: ${JSON.stringify(x)}`);
}

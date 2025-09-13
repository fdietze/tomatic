import { beforeEach, afterEach, vi } from 'vitest';
import type { TestContext } from 'vitest';

let consoleLogSpy: (...args: any[]) => void;
let consoleErrorSpy: (...args: any[]) => void;
const logBuffer: any[][] = [];

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logBuffer.push(args);
  });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    logBuffer.push(args);
    throw new Error(args.join(' '));
  });
});

afterEach((context: TestContext) => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();

  if (context.result?.state === 'fail') {
    logBuffer.forEach(args => console.log(...args));
  }
  
  logBuffer.length = 0;
});

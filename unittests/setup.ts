import { beforeEach, afterEach, vi } from 'vitest';
import type { TestContext } from 'vitest';
import { MockInstance } from 'vitest';
import '@testing-library/jest-dom';

let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;
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

  if (context.task.result?.state === 'fail') {
    logBuffer.forEach(args => console.log(...args));
  }
  
  logBuffer.length = 0;
});

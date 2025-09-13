import { beforeEach, afterEach, vi } from 'vitest';
import type { TestContext } from 'vitest';

let consoleLogSpy: (...args: any[]) => void;
const logBuffer: any[][] = [];

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logBuffer.push(args);
  });
});

afterEach((context: TestContext) => {
  consoleLogSpy.mockRestore();

  if (context.result?.state === 'fail') {
    logBuffer.forEach(args => console.log(...args));
  }
  
  logBuffer.length = 0;
});

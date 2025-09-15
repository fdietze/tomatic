export {};

declare global {
  interface Window {
    __IS_TESTING__: boolean;
    app_events: { type: string; detail: unknown }[];
  }
}

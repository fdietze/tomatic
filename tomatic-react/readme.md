# Tomatic React

This project is a React-based web application providing a chat interface, built with Vite, TypeScript, and Zustand for state management.

## Development

-   `just dev`: Starts the Vite development server.
-   `just check`: Runs TypeScript checks and Playwright end-to-end tests.
-   `just fix`: Formats the code with Prettier.

## Debugging Playwright Tests

When end-to-end tests fail unexpectedly, it can be difficult to diagnose the root cause. A useful strategy is to trace the application's execution flow by adding debug logs that will appear in the test output.

Here's a step-by-step guide to this process:

1.  **Instrument the Code:** Add `console.log` statements to key areas of the application that are relevant to the failing test. It's helpful to prefix these messages with a unique identifier, such as `[DEBUG]`, to make them easy to spot in the logs. Good places to add logs include:
    *   State management actions (e.g., in the Zustand store).
    *   API call functions.
    *   Component render methods to see when they update.

2.  **Expose Console Logs in Tests:** By default, browser console logs are not printed to the terminal during a Playwright test run. To make them visible, add the following snippet to your test file:

    ```typescript
    test('my test', async ({ page }) => {
      // Listen for console messages
      page.on('console', (msg) => {
        // Optional: filter for your specific debug messages
        if (msg.text().startsWith('[DEBUG]')) {
          console.log(msg.text());
        }
      });

      // ... rest of your test
    });
    ```

3.  **Run the Tests:** Execute the tests as usual (`just check`). The `[DEBUG]` messages from the application will now be printed in the test runner's output.

4.  **Analyze the Output:** By following the sequence of debug logs, you can trace the data flow and component lifecycle during the test run. This will help you pinpoint exactly where the process is breaking down—for example, if a state update is not happening as expected, or if a component is not re-rendering with new props.

5.  **Clean Up:** Once the issue is resolved, remember to remove the `console.log` statements from the application code and the `page.on('console', ...)` listener from the test file.

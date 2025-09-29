# User requests
- update @requirements.md and add or change requirements.
- for every user request (feature request, bug report, etc), develop it in a test-driven way. What exactly needs to be tested? can we reproduce the bug with a regression-test? Do we change or extend existing tests? Do we create a new test? do we use vitest unit/integration tests and/or playwright e2e tests?

# Requirement Traceability
- the code and documentation has comments like "// req:a-requierement" everywhere. Use grep to find other references.
- when writing new code, extend @requirements.md and comments in the code accordingly


# Validating Changes

- automatically run `just check` to check (for compiling, linting and running tests) in-between and after implementation milestones. Always plan at which points you will execute `just check`.
- Where appropriate, add a new unit and/or e2e test for the feature. Look at other tests, test helpers and fixtures before attempting to write a new test. Always run all tests using the `just check` command.
- before commiting, opening a PR or considering a task as done, `just check` must have run successfully
- When `just check` results in a failed test, you must immediately enter the debugging protocol.
- if you cannot satisfy the linter, it is ok to disable linting rules in the code on a per-case basis.
- e2e tests often report the number of failed tests and the number of passed tests. pay special attention to these numbers.

# General
- trust the type checker.
- with every step, consider different options and their tradeoffs
- all plans must contain linting (`npm run lint`) and testing (`just check`) steps.
- prefer pure functions
- design functions and datastructures that do one thing well. Follow SRP.
- move code that is domain independent and is candidate for a library to separate files
- business logic should be high-level and readable like pseudo-code
- prefer type-safety and compiler errors over run-time errors
- Add assertions to test nontrivial assumptions
- organize the functions in a file in a top-down design, so that the reader sees high-level code at the top and low-level code at the bottom
- trust and follow the instructions of deprecation warnings
- error handling: use guard clauses / early returns to improve readability of the happy path and reduce nesting.
- if possible, push ifs out of functions up to the caller
- after failed attempts, fetch docs from the internet or do a web search
- do web searches for tricky error messages
- if a variable or field name contains a quantity with a unit, like seconds, meters, etc. include that as a suffix in the name.
- make illegal states irrepresentable
- parse, don't validate
- aid type inference by adding more explicit types
- use exhaustiveness matching of typescript wherever possible
- handled errors should never use console.error, only console.log. console.error is considered an error by the tests.

# Tests
- We want a composable test setup with low abstraction levels and no builder patterns. 
- each test must be as explicit and self-contained as possible.
- each test must have a comment inside its test block stating its purpose
- Every `test()` block must begin with a "Purpose:" comment explaining what behavior it verifies.
- make the test's setup completely explicit and easy to understand without needing to look up a fixture's definition.
- Keep simple fixtures for boilerplate that is truly generic and shared by all tests.
- for test setup, prefer direct data seeding (e.g., of IndexedDB or localStorage) over UI interactions to keep tests fast and focused
- always use unambiguous and stable data-testids in the e2e tests instead of classes, placeholders or strings.
- when testing loading states, use manual mock triggers to assert that spinners appear before the mock is resolved and disappear after.
- is the test waiting if the application is ready? (await waitForEvent(page, "app_initialized");)
- when there are timing issues, use mocks that are triggered awaited manually
- tests should not use page.goto to navigate between pages (that would trigger reseeding the database state). page.goto is only allowed on initial page load. use clicks instead.
- Use a hierarchical, scenario-based architecture for test files. Group tests into `describe` blocks based on the feature and specific scenarios. Scope data seeding to the narrowest possible `beforeEach` block to ensure tests are perfectly isolated and self-contained.

```typescript
// good example
describe('Feature: Snippet Editing', () => {
  // Common setup for all tests in this file (e.g., initialize Page Objects)
  test.beforeEach(() => { /* ... */ });

  describe('Scenario: When snippets are valid', () => {
    // Specific data seeding for this scenario
    test.beforeEach(() => { 
      seedIndexedDB({ snippets: [/* valid snippets */] }); 
    });

    test('it should resolve a snippet', () => { /* ... */ });
  });

  describe('Scenario: When a snippet does not exist', () => {
    // A different, clean state for this scenario
    test.beforeEach(() => { 
      seedIndexedDB({ snippets: [] }); 
    });

    test('it should show a "not found" error', () => { /* ... */ });
  });
});
```

# Big tasks
- bigger tasks always have specification gaps. note, which decisions you have taken to fill those gaps. be conservative and don't do anything the user didn't ask for.
- for bigger tasks, break it down into smaller steps, that can be individually typechecked and tested, before moving on to the next step.

# Debugging Protocol
Strictly follow this process by creating a plan for it:
State that you are "Entering the debugging protocol."
analyze the previous run or run the tests (fix type-errors if necessary) and see them failing. after each run of `just check` you must ask the following quesions:
- what are the current hypotheses of the tests failing? Explain the hypotheses with log traces.
- where and which logging must we add to confirm or refute these hypotheses
- add logging to trace the whole flow from start to finish (always use console.log).
- which logs should we remove to reduce noise?
- run the tests again
- don't fix anything yet
run this iteration 3 times. Number your iterations.
Finally, report your findings and stop.

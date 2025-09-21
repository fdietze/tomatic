# User requests
- for every user request, decide if we can develop it in a test-driven way. which tests would be appropriate? vitest unit tests and/or playwright e2e tests?

# Validating Changes

- automatically run `just check` to check (for compiling, linting and running tests) in-between and after implementation milestones. Always plan at which points you will execute `just check`.
- Where appropriate, add a new unit and/or e2e test for the feature. Look at other tests, test helpers and fixtures before attempting to write a new test. Always run all tests using the `just check` command.
- before commiting, opening a PR or considering a task as done, `just check` must have run successfully
- When `just check` results in a failed test, you must immediately enter the debugging protocol.
- if you cannot satisfy the linter, it is ok to disable linting rules in the code on a per-case basis.

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
- When debugging XState machines with `always` transitions that depend on context updated by events, ensure the state is re-entered (e.g., via a self-transition) to force re-evaluation of the `always` transition.

# Tests
- We want a composable test setup with low abstraction levels and no builder patterns. 
- each test must be as explicit and self-contained as possible.
- each test must have a comment inside its test block stating its purpose
- make the test's setup completely explicit and easy to understand without needing to look up a fixture's definition.
- Keep simple fixtures for boilerplate that is truly generic and shared by all tests.
- for test setup, prefer direct data seeding (e.g., of IndexedDB or localStorage) over UI interactions to keep tests fast and focused
- always use unambiguous and stable data-testids in the e2e tests instead of classes, placeholders or strings.
- when testing loading states, use manual mock triggers to assert that spinners appear before the mock is resolved and disappear after.

# Big tasks
- bigger tasks always have specification gaps. note, which decisions you have taken to fill those gaps. be conservative and don't do anything the user didn't ask for.
- for bigger tasks, break it down into smaller steps, that can be individually typechecked and tested, before moving on to the next step.

# Debugging Protocol
Follow this process by creating a plan for it:
State that you are "Entering the debugging protocol."
run the tests (fix linting if necessary) and see them failing. after each run of `just check` you must ask the following quesions:
- what are the current hypotheses of the tests failing? Explain the hypotheses with log traces.
- are we able to catch those problems with more future-proof unit tests?
- where and which logging must we add to confirm or refute these hypotheses
- add logging to trace the whole flow from start to finish. always raw use console.log calls - never console.error.
- which logs should we remove to reduce noise?
- run the tests again
- don't fix anything yet
run this iteration 3 times. Number your iterations.
Finally, report your findings and stop.

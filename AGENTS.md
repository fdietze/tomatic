# Project specific

- Where appropriate, add a new unit and/or e2e test for the feature. Look at other tests, test helpers and fixtures before attempting to write a new test. Always run all tests using the `just check` command
- automatically run `just check` to check (for compiling, linting and running tests) in-between and after implementation steps. Always mention at which points you will execute `just check`.
- always use unambiguous and stable data-testids in the e2e tests instead of classes, placeholders or strings.
- before commiting, opening a PR or considering a task as done, just check must have run successfully

# General
- trust the type checker.
- with every step, consider different options and their tradeoffs
- all plans must contain those typechecking and testing steps.
- When encountering a runtime error or failed test, immediately pause before attempting a fix and formulate several specific hypotheses about the root cause. Strategically add logging to gather evidence that will either confirm or reject each hypothesis. Execute the test and analyze the log output. You must repeat this cycle—refining your hypotheses, adjusting logging, and re-running the test after each execution—until one hypothesis is conclusively proven. Only after a hypothesis is confirmed should you design and implement a robust fix. If your fix fails, treat it as a new problem: revert the change, form new hypotheses for the new failure, and restart the logging and iteration process. Once the issue is resolved, leave any lightweight and informative debug logs in the codebase. we will need them later.
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

# Tests
- We want a composable test setup with low abstraction levels and no builder patterns. 
- each test must be as explicit and self-contained as possible.
- make the test's setup completely explicit and easy to understand without needing to look up a fixture's definition.
- Keep simple fixtures for boilerplate that is truly generic and shared by all tests.

# Big tasks
- bigger tasks always have specification gaps. note, which decisions you have taken to fill those gaps. be conservative and don't do anything the user didn't ask for.
- for bigger tasks, break it down into smaller steps, that can be individually typechecked and tested, before moving on to the next step.

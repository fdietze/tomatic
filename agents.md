# Project specific

- automatically run `just check` to check (for compiling, linting and running tests) in-between and after implementation steps.
- always use unambiguous and stable data-testids in the e2e tests instead of classes, placeholders or strings.
- trust the type checker.

# General
- if a variable or field name contains a quantity with a unit, like seconds, meters, etc. include that as a suffix in the name.
- When confronted with a runtime problem or failed test case, before fixing anything, form a hypothesis and add debug prints ("\[\<context\>\] msg...") to confirm the hypothesis and understand the problem. If a fix is not working, refine the debug prints and iterate. Always leave debug prints (if lightweight) in the code to aid future debugging.
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

# Big tasks
- bigger tasks always have specification gaps. note, which decisions you have taken to fill those gaps. be conservative and don't do anything the user didn't ask for.
- for bigger tasks, break it down into smaller steps, that can be individually typechecked and tested, before moving on to the next step.
- plans must contain those typechecking and testing steps.

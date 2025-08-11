# Claude Assistant Guidelines for Tomatic

## Project Overview

Tomatic is a frontend-only AI chat interface built with Rust/Leptos that uses OpenRouter for AI model access. The project emphasizes UI efficiency, high information density, and staying close to the LLM API interface without hidden system prompts.

## Development Environment

- Uses devbox and direnv for environment management
- Built with Rust/Leptos framework for WebAssembly
- Uses Trunk for building and serving
- Leptosfmt for code formatting
- Clippy for linting

### Quality Assurance

- `devbox run -- just check` - Run tests and clippy checks
- `devbox run -- just fix` - Auto-fix clippy issues and format code

## Code Style Guidelines

- Follow Rust best practices
- Address all clippy warnings
- Write tests for new functionality
- Use RUSTFLAGS="--cfg erase_components" for builds

## Project Structure

- `src/` - Main Rust source code
  - `chat/` - Chat-related components
  - Core modules: `main.rs`, `llm.rs`, `settings.rs`, etc.
- `css/` - Stylesheets
- `favicon/` - Favicon assets
- `docs/` - Documentation

## Development

- automatically run `devbox run -- just check` to check (for compiling, linting and running tests) in-between and after implementation steps. To automatically fix some linter errors (clippy), run `devbox run -- just fix` (will internally run cargo clippy --fix). After running `devbox run -- just fix`, re-read the affected files and run `devbox run -- just check` again to make sure all linter errors are fixed.
- before commiting, the code must be formatted. run `devbox run -- just fix` to format.
- Modify Cargo.toml using cargo commands.
- trust the compiler.

### Rust

- variables should be used directly in the `format!`, `println!`, `assert!` strings, for example println!("{my_variable}") instead of println!("{}", my_variable)

## Dependencies

Key dependencies include:

- Leptos (CSR framework)
- OpenRouter API for LLM integration
- Web-sys for browser APIs
- Serde for serialization
- IndexedDB for client-side storage

## Notes

- Frontend-only architecture (no backend required)
- All AI functionality via OpenRouter
- Focus on space-efficient, high-density UI
- Transparent interaction with LLM APIs

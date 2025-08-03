# Claude Assistant Guidelines for Tomatic

## Project Overview
Tomatic is a frontend-only AI chat interface built with Rust/Leptos that uses OpenRouter for AI model access. The project emphasizes UI efficiency, high information density, and staying close to the LLM API interface without hidden system prompts.

## Development Environment
- Uses devbox and direnv for environment management
- Built with Rust/Leptos framework for WebAssembly
- Uses Trunk for building and serving
- Leptosfmt for code formatting
- Clippy for linting

## Key Commands
Use these commands via the justfile:

### Development
- `just dev` - Start development server on port 12345
- `just` - List all available commands

### Quality Assurance
- `just check` - Run tests and clippy checks
- `just fix` - Auto-fix clippy issues and format code
- `just ci-checks` - Run all CI checks (format, lint, test, build)

### Individual Commands
- `just check-format` - Check leptosfmt formatting
- `just lint` - Run clippy linter
- `just test-all` - Run all tests
- `just build-debug` - Debug build
- `just build-release` - Release build

## Code Style Guidelines
- Follow Rust best practices
- Use leptosfmt for formatting
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

## Development Workflow
1. Run `just dev` to start development server
2. Make changes to source code
3. Use `just fix` to auto-format and fix linting issues
4. Run `just check` to verify tests and linting
5. Use `just ci-checks` before committing to ensure all checks pass

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
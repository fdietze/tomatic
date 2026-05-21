# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

# start development environment
dev:
  pnpm dev

check:
  pnpm typecheck && \
  pnpm lint && \
  pnpm test:unit && \
  pnpm test:e2e


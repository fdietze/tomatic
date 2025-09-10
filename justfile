# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

# start development environment
dev:
  npm run dev

check:
  npm run typecheck && \
  npm run test:e2e && \
  npm run lint


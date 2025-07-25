# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

# start development environment
dev:
  RUSTFLAGS="--cfg erase_components" trunk serve --port 12345 --locked --no-error-reporting --skip-version-check --public-url /

# Check Formatting
check-format:
  @echo "Running format check..."
  leptosfmt --check src

# Lint Code
lint:
  @echo "Running linter..."
  RUSTFLAGS="--cfg erase_components" cargo clippy --all-targets --all-features -- -D warnings

check:
  RUSTFLAGS="--cfg erase_components" cargo test --workspace --all-targets && cargo clippy --all-targets

# Run Tests
test-all:
  @echo "Running tests..."
  RUSTFLAGS="--cfg erase_components" cargo test --workspace --all-targets

# Build (Debug mode - for PR checks)
build-debug:
  @echo "Running debug build..."
  trunk build --locked --skip-version-check --public-url /
  cp dist/index.html dist/404.html # github pages hack to serve SPA under any sub-path

# Build (Release mode - for deployment)
build-release:
  @echo "Running release build..."
  trunk build --locked --release --minify --skip-version-check --public-url /
  cp dist/index.html dist/404.html # github pages hack to serve SPA under any sub-path
  ls -lh dist

# ---- Composite "CI Steps" ----
# Run all checks (format, lint, test, and a debug build to ensure compilability)
ci-checks: check-format lint test-all build-debug
  @echo "All CI checks passed!"

# run ci checks locally and re-run on file changes
ci-watch:
  (git ls-files && git ls-files --others --exclude-standard) | entr -cnr just ci-checks

fix:
  cargo clippy --fix --allow-dirty --allow-staged --all-targets
  leptosfmt src

# count lines of code in repo
cloc:
  # ignores generated code
  cloc --vcs=git --fullpath .


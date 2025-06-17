# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

# start development environment
dev:
  trunk serve --port 12345 --locked --no-error-reporting --skip-version-check

check:
  cargo clippy --all-targets --profile check-tmp
  cargo test --workspace --all-targets --profile check-tmp
  trunk build

fix:
  cargo clippy --fix --allow-dirty --allow-staged --all-targets

# run ci checks locally
ci:
  (git ls-files && git ls-files --others --exclude-standard) | entr -cnr earthly +ci-test


# count lines of code in repo
cloc:
  # ignores generated code
  cloc --vcs=git --fullpath .

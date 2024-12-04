# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

# start development environment
dev:
  trunk serve --no-error-reporting

# run ci checks locally
ci:
  (git ls-files && git ls-files --others --exclude-standard) | entr -cnr earthly +ci-test

# count lines of code in repo
cloc:
  # ignores generated code
  cloc --vcs=git --fullpath .


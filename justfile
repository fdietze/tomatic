# https://github.com/casey/just

# List available recipes in the order in which they appear in this file
_default:
  @just --list --unsorted

dev:
  trunk serve --no-error-reporting

# count lines of code in repo
cloc:
  # ignores generated code
  cloc --vcs=git --fullpath .


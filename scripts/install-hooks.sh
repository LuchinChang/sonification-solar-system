#!/bin/sh
# Install git hooks from scripts/ into .git/hooks/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(git -C "$SCRIPT_DIR" rev-parse --git-dir)/hooks"

cp "$SCRIPT_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "Git hooks installed."

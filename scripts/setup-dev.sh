#!/usr/bin/env bash
# Setup development helpers: install pre-commit and enable hooks
set -euo pipefail

echo "Installing pre-commit (if Python/pip available)..."
if command -v pip >/dev/null 2>&1; then
  pip install --user pre-commit || true
fi

if command -v pre-commit >/dev/null 2>&1; then
  echo "Installing git hooks via pre-commit..."
  pre-commit install || true
  echo "Pre-commit installed. Run 'pre-commit run --all-files' to check existing files."
else
  echo "pre-commit not found. Please install Python pip and run 'pip install pre-commit', then 'pre-commit install'"
fi

echo "Done."

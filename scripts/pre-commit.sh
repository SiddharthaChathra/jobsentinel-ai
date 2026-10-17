#!/usr/bin/env sh
# Pre-commit: block committing secrets. Uses gitleaks if installed; otherwise a lightweight grep.
# Install gitleaks: https://github.com/gitleaks/gitleaks#installing (winget install gitleaks / brew install gitleaks)
# Always, gitleaks or not: never commit an env file, a signing key or a private JWK (D101).
STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
if echo "$STAGED" | grep -E '(^|/)\.env(\..*)?$' | grep -v '\.env\.example$' >/dev/null; then
  echo "[pre-commit] refusing to commit a .env file (.env, .env.test, ...)"; exit 1
fi
if echo "$STAGED" | grep -E '(^|/)signing_keys\.json$' >/dev/null; then
  echo "[pre-commit] refusing to commit supabase/signing_keys.json (local test signing key)"; exit 1
fi
# A JWK private key's "d" member is a long base64url string (43+ chars for P-256); public keys
# have none. Matched per line, so pretty-printed JSON is caught too.
if git diff --cached -U0 -- . ':!scripts/pre-commit.sh' | grep -E '^\+' | grep -E '"d" *: *"[A-Za-z0-9_-]{40,}"' >/dev/null; then
  echo "[pre-commit] staged change contains a private JWK; aborting"; exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --no-banner --redact --config .gitleaks.toml || exit 1
else
  echo "[pre-commit] gitleaks not installed; running basic secret grep instead."
  if git diff --cached --name-only | grep -E '(^|/)\.env(\..*)?$' | grep -v '\.env\.example$' >/dev/null; then
    echo "[pre-commit] refusing to commit a .env file"; exit 1
  fi
  # Patterns: Anthropic keys, Google API keys, JWTs, Telegram bot tokens. This script excludes itself.
  PATTERN='(sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|[0-9]{8,}:AA[A-Za-z0-9_-]{30,})'
  if git diff --cached -U0 -- . ':!scripts/pre-commit.sh' | grep -E '^\+' | grep -iE "$PATTERN" >/dev/null; then
    echo "[pre-commit] possible secret detected in staged changes; aborting"; exit 1
  fi
fi

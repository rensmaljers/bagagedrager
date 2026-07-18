#!/bin/bash
# Stop-hook: bewaakt de 0-errors-typecheck-gate (zie CLAUDE.md).
# Draait alleen als er ongecommitte wijzigingen in src/ staan; blokkeert (exit 2)
# zodat Claude de errors fixt vóór de beurt eindigt.

input=$(cat)

# Loop-preventie: als we al door een stop-hook zijn doorgestart, niet nogmaals blokkeren.
if echo "$input" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

# Alleen checken als er iets in src/ (of de ts-config) gewijzigd is.
if ! git status --porcelain -- src tsconfig.json svelte.config.mjs 2>/dev/null | grep -q .; then
  exit 0
fi

out=$(npm run typecheck 2>&1)
if [ $? -ne 0 ]; then
  {
    echo "npm run typecheck faalt — de 0-errors-gate (CLAUDE.md) is geschonden. Fix dit vóór je stopt:"
    echo "$out" | tail -30
  } >&2
  exit 2
fi

exit 0

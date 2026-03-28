#!/usr/bin/env bash
set -e
echo "=== AGENT CONFLICT CHECK ==="
echo ""

# 1️⃣ Files edited by multiple agents (git diff since last commit)
echo "--- Files touched by multiple agents since last commit ---"
git diff --name-only | sort | uniq -d || true
echo ""

# 2️⃣ Duplicate module.exports across src/
echo "--- Duplicate module.exports across src/ (possible name clash) ---"
grep -rn "module.exports" src/ --include="*.js" | cut -d: -f1,2 | sort | uniq -d || true
echo ""

# 3️⃣ Type definitions outside shared/
echo "--- Type definitions outside shared/ (VIOLATIONS) ---"
grep -rn "@typedef" src/ --include="*.js" 2>/dev/null || true
grep -rn "Object.freeze" src/ --include="*.js" 2>/dev/null || true
echo ""

# 4️⃣ Files using shared constants without proper import
echo "--- Files using shared constants without proper import ---"
for f in $(find src/ -name "*.js"); do
  if grep -q "AGENT_IDS\|MEMORY_LAYERS\|PORTS\|MESSAGE_TYPES" "$f"; then
    if ! grep -q "require.*shared/types" "$f"; then
      echo " VIOLATION: $f"
    fi
  fi
done
echo ""

# 5️⃣ LOCK CONSISTENCY CHECK (no jq needed)
echo "--- Checking lock consistency ---"
grep '"owner"' .agents/LOCKS.json | grep -v SHARED | grep -v null \
  | sed -E 's/.*"owner": *"([^"]+)".*/\1/' | sort | uniq -c | sort -rn
echo ""
echo "=== CHECK COMPLETE ==="
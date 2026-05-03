#!/usr/bin/env bash
# Usage: ./dev.sh <tunnel-url>
# Example: ./dev.sh https://abc-def-123.trycloudflare.com
#
# Run this every time your cloudflared tunnel URL changes.
# It updates .env.local and repoints the Telegram webhook.
#
# Workflow:
#   Terminal 1: cloudflared tunnel --url http://localhost:3000
#   Terminal 2: bun run --cwd apps/autohodl dev
#   Terminal 3: ./dev.sh <url printed by cloudflared>

set -euo pipefail

TUNNEL_URL="${1:-}"
ENV_FILE="apps/autohodl/.env.local"

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Usage: ./dev.sh <tunnel-url>"
  echo "Example: ./dev.sh https://abc-def-123.trycloudflare.com"
  exit 1
fi

# Strip trailing slash
TUNNEL_URL="${TUNNEL_URL%/}"

# Read bot token from .env.local
BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2 | awk '{print $1}')
if [[ -z "$BOT_TOKEN" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in $ENV_FILE"
  exit 1
fi

# Update NEXT_PUBLIC_MINI_APP_URL in .env.local (macOS sed syntax)
sed -i '' "s|^NEXT_PUBLIC_MINI_APP_URL=.*|NEXT_PUBLIC_MINI_APP_URL=${TUNNEL_URL}|" "$ENV_FILE"
echo "✓ Updated NEXT_PUBLIC_MINI_APP_URL in $ENV_FILE"

# Set Telegram webhook
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${TUNNEL_URL}/api/bot\"}")

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✓ Telegram webhook set to ${TUNNEL_URL}/api/bot"
else
  echo "✗ Webhook update failed: $RESPONSE"
  exit 1
fi

echo ""
echo "Restart the dev server to pick up the new URL:"
echo "  bun run --cwd apps/autohodl dev"

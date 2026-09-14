#!/usr/bin/env bash
# Housewarden self-hosted deploy on this VPS (run as the app user; sudo needed once for setcap + firewall).
#   bash ~/housewarden/deploy/install.sh
# What it does:
#   1. builds the Next.js app (standalone) and runs migrations against the embedded Postgres (PGlite, on disk)
#   2. installs two systemd --user services: housewarden (Next on 127.0.0.1:3124) and caddy (HTTPS on :443 → 3124)
#   3. Caddy gets automatic TLS (Let's Encrypt, ZeroSSL fallback) for the hostname in deploy/Caddyfile
set -euo pipefail
APP=~/housewarden
BIN=~/.local/bin
mkdir -p "$BIN" ~/.config/systemd/user "$APP/.data"

# --- 1. app -----------------------------------------------------------------
cd "$APP"
[ -f .env.local ] || { echo "missing $APP/.env.local (HOUSEWARDEN_TOKEN, HOUSEWARDEN_ADMIN_SECRET, HOUSEWARDEN_ALLOWED_ORIGINS)"; exit 1; }
npm ci --silent
npm run build
# Next's standalone output does not include static assets or public/ — copy them in, or every CSS/JS asset 404s.
mkdir -p .next/standalone/.next .next/standalone/public
rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public/. .next/standalone/public/ || true
npm run migrate

# --- 2. caddy binary (static, no root needed to download) ------------------------
if [ ! -x "$BIN/caddy" ]; then
  V=$(curl -s https://api.github.com/repos/caddyserver/caddy/releases/latest | python3 -c "import sys,json;print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
  curl -sL "https://github.com/caddyserver/caddy/releases/download/v${V}/caddy_${V}_linux_amd64.tar.gz" | tar -xz -C "$BIN" caddy
fi
"$BIN/caddy" version
# binding :443 as a normal user needs this capability once (root):
if ! getcap "$BIN/caddy" | grep -q cap_net_bind_service; then
  echo ">> run:  sudo setcap 'cap_net_bind_service=+ep' $BIN/caddy"
  sudo setcap 'cap_net_bind_service=+ep' "$BIN/caddy"
fi
# open the port if ufw is active (root)
if sudo ufw status 2>/dev/null | grep -q "Status: active"; then sudo ufw allow 443/tcp; sudo ufw allow 80/tcp; fi

# --- 3. services ------------------------------------------------------------------
cp deploy/housewarden.service deploy/caddy.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now housewarden.service caddy.service
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
sleep 3
systemctl --user --no-pager status housewarden.service caddy.service | grep -E "Active:|housewarden|caddy" | head -6
echo "MCP endpoint: https://$(grep -m1 -oE '^[a-z0-9.-]+' deploy/Caddyfile)/api/mcp"

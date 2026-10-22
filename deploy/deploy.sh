#!/usr/bin/env bash
# Deploy to pearlkin.pearlwren.com per the PearlWren launch guide:
#   /            landing page        -> /var/www/pearlkin
#   /app/        web build of the app -> /var/www/pearlkin/app
#   /api/*       OCR proxy           -> /opt/pearlkin-server, systemd "pearlkin-api", port 3001
# Re-run any time; every step is idempotent. Secrets live only on the server in /etc/pearlkin-api.env.
set -euo pipefail

HOST=${DEPLOY_HOST:-admin@8.218.190.208}
KEY=${DEPLOY_KEY:-$HOME/.ssh/pearlwren_deploy}
DOMAIN=pearlkin.pearlwren.com
PORT=3001
APP_TOKEN=${APP_TOKEN:?set APP_TOKEN (same value the server has in /etc/pearlkin-api.env)}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SSH="ssh -i $KEY -o IdentitiesOnly=yes"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

echo "== build"
(cd "$ROOT" && npm test --silent >/dev/null && cd server && npm test --silent >/dev/null)
(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL="https://$DOMAIN" EXPO_PUBLIC_APP_TOKEN="$APP_TOKEN" \
  npx expo export --platform web --output-dir "$BUILD/site/app" --clear >/dev/null)
cp "$ROOT/landing/index.html" "$BUILD/site/"

echo "== upload"
$SSH "$HOST" 'mkdir -p ~/pearlkin-upload'
rsync -az --delete -e "$SSH" "$BUILD/site/" "$HOST:pearlkin-upload/site/"
rsync -az --delete -e "$SSH" --exclude node_modules --exclude '*.test.ts' "$ROOT/server/" "$HOST:pearlkin-upload/server/"

echo "== install on server"
$SSH "$HOST" "DOMAIN=$DOMAIN PORT=$PORT APP_TOKEN=$APP_TOKEN bash -s" <<'REMOTE'
set -euo pipefail
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "Node >= 22.18 required on the server (have: $(node -v 2>/dev/null || echo none))"; exit 1; }

sudo mkdir -p /var/www/pearlkin /opt/pearlkin-server
sudo rsync -a --delete ~/pearlkin-upload/site/ /var/www/pearlkin/
sudo rsync -a --delete --exclude node_modules ~/pearlkin-upload/server/ /opt/pearlkin-server/
sudo chown -R admin:admin /var/www/pearlkin /opt/pearlkin-server
(cd /opt/pearlkin-server && npm install --omit=dev --no-audit --no-fund --silent)

# Secrets: created once, never overwritten. The API key is added by hand.
if [ ! -f /etc/pearlkin-api.env ]; then
  printf 'APP_TOKEN=%s\n# ANTHROPIC_API_KEY=sk-ant-...\n' "$APP_TOKEN" | sudo tee /etc/pearlkin-api.env >/dev/null
  sudo chmod 600 /etc/pearlkin-api.env
fi

sudo tee /etc/systemd/system/pearlkin-api.service >/dev/null <<UNIT
[Unit]
Description=PearlKin OCR proxy
After=network.target

[Service]
WorkingDirectory=/opt/pearlkin-server
ExecStart=$(command -v node) server.ts
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
EnvironmentFile=/etc/pearlkin-api.env
Restart=always
User=admin

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now pearlkin-api >/dev/null 2>&1
sudo systemctl restart pearlkin-api

# Caddy: append the site block once, back up first, validate before reload (launch guide step 3).
if ! grep -q "^$DOMAIN {" /etc/caddy/Caddyfile; then
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%F-%H%M)"
  sudo tee -a /etc/caddy/Caddyfile >/dev/null <<CADDY

$DOMAIN {
	encode gzip zstd
	handle /api/* {
		reverse_proxy localhost:$PORT
	}
	handle /app* {
		root * /var/www/pearlkin
		try_files {path} /app/index.html
		file_server
	}
	handle {
		root * /var/www/pearlkin
		file_server
	}
}
CADDY
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  sudo systemctl reload caddy
fi

sleep 2
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
REMOTE

echo "== done: https://$DOMAIN  https://$DOMAIN/app/"

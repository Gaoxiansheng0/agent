#!/usr/bin/env bash
# Deploy to pearlkin.pearlwren.com per the PearlWren launch guide:
#   /                       landing page, /privacy, /terms  -> /var/www/pearlkin
#   /app/                   web build of the app            -> /var/www/pearlkin/app
#   /api/*, /admin          server + admin panel            -> /opt/pearlkin-server, systemd "pearlkin-api", port 3001
#   database                                                -> /var/lib/pearlkin/pearlkin.db (kept across deploys)
# Runs from Git Bash on Windows too (tar + scp, no rsync). Re-run any time; every step is idempotent.
# Secrets live only on the server in /etc/pearlkin-api.env. APP_TOKEN is read from there when not set;
# on the first deploy a random one is generated.
set -euo pipefail

HOST=${DEPLOY_HOST:-root@8.218.190.208}
KEY=${DEPLOY_KEY:-$HOME/.ssh/resume.pem}
DOMAIN=pearlkin.pearlwren.com
PORT=3001
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

if [ -z "${APP_TOKEN:-}" ]; then
  APP_TOKEN=$(remote "sed -n 's/^APP_TOKEN=//p' /etc/pearlkin-api.env 2>/dev/null" || true)
  [ -n "$APP_TOKEN" ] || APP_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
fi

echo "== test"
(cd "$ROOT" && npm test --silent >/dev/null)
(cd "$ROOT/server" && npm test --silent >/dev/null && npx tsc --noEmit)
(cd "$ROOT/mobile" && npx tsc --noEmit)

echo "== build"
(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL="https://$DOMAIN" EXPO_PUBLIC_SITE_URL="https://$DOMAIN" EXPO_PUBLIC_APP_TOKEN="$APP_TOKEN" \
  npx expo export --platform web --output-dir "$BUILD/site/app" --clear >/dev/null)
cp "$ROOT"/landing/*.html "$ROOT"/landing/*.css "$BUILD/site/"
mkdir -p "$BUILD/srv/server/admin" "$BUILD/srv/engine"
(cd "$ROOT/server" && cp *.ts package.json package-lock.json tsconfig.json "$BUILD/srv/server/" && rm -f "$BUILD"/srv/server/*.test.ts && cp admin/* "$BUILD/srv/server/admin/")
cp "$ROOT/engine/engine.ts" "$ROOT/engine/rule-pack.json" "$BUILD/srv/engine/"
cp -r "$ROOT/deploy/tools" "$BUILD/tools"
tar -czf "$BUILD/pearlkin.tar.gz" -C "$BUILD" site srv tools

echo "== upload"
scp "${SSH_OPTS[@]}" "$BUILD/pearlkin.tar.gz" "$HOST:/tmp/pearlkin.tar.gz"

echo "== install on server"
remote "DOMAIN=$DOMAIN PORT=$PORT APP_TOKEN=$APP_TOKEN bash -s" <<'REMOTE'
set -euo pipefail
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "Node >= 22.18 required on the server (have: $(node -v 2>/dev/null || echo none))"; exit 1; }

STAGE=$(mktemp -d)
tar -xzf /tmp/pearlkin.tar.gz -C "$STAGE"
rm -f /tmp/pearlkin.tar.gz

mkdir -p /var/www/pearlkin /opt/pearlkin-server /var/lib/pearlkin
rm -rf /var/www/pearlkin/* && cp -r "$STAGE/site/." /var/www/pearlkin/
chmod -R a+rX /var/www/pearlkin
# Code only; node_modules is reinstalled, the database lives in /var/lib/pearlkin.
rm -rf /opt/pearlkin-server/* && cp -r "$STAGE/srv/." /opt/pearlkin-server/
install -m 700 "$STAGE"/tools/* /usr/local/sbin/
rm -rf "$STAGE"
chown -R admin:admin /opt/pearlkin-server /var/lib/pearlkin
chmod 700 /var/lib/pearlkin
runuser -u admin -- bash -c 'cd /opt/pearlkin-server/server && npm ci --omit=dev --no-audit --no-fund --loglevel=error'

# Secrets: created once, never overwritten. Keys and the admin password are added with the pearlkin-* tools.
f=/etc/pearlkin-api.env
[ -f "$f" ] || { printf 'APP_TOKEN=%s\n' "$APP_TOKEN" > "$f"; }
grep -q '^SESSION_SECRET=' "$f" || printf 'SESSION_SECRET=%s\n' "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" >> "$f"
chmod 600 "$f"

cat > /etc/systemd/system/pearlkin-api.service <<UNIT
[Unit]
Description=PearlKin server (OCR proxy, stats, admin)
After=network.target

[Service]
WorkingDirectory=/opt/pearlkin-server/server
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server.ts
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DB_FILE=/var/lib/pearlkin/pearlkin.db
EnvironmentFile=/etc/pearlkin-api.env
Restart=always
RestartSec=3
User=admin
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/pearlkin

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pearlkin-api >/dev/null 2>&1
systemctl restart pearlkin-api

# Caddy: one site file per project under /etc/caddy/sites. Rewritten each deploy, validated before reload.
SITE=/etc/caddy/sites/pearlkin.caddy
NEW=$(mktemp)
cat > "$NEW" <<CADDY
$DOMAIN {
	encode zstd gzip
	@server path /api/* /admin /admin/*
	handle @server {
		reverse_proxy 127.0.0.1:$PORT {
			header_up X-Real-IP {remote_host}
		}
	}
	handle /app* {
		root * /var/www/pearlkin
		try_files {path} /app/index.html
		file_server
	}
	handle {
		root * /var/www/pearlkin
		try_files {path} {path}.html
		file_server
	}
}
CADDY
if ! cmp -s "$NEW" "$SITE"; then
  BAK="$SITE.bak-$(date +%F-%H%M%S)"
  [ -f "$SITE" ] && cp "$SITE" "$BAK"
  cp "$NEW" "$SITE"
  if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
  else
    echo "Caddy config invalid, restoring the previous one"
    if [ -f "$BAK" ]; then cp "$BAK" "$SITE"; else rm -f "$SITE"; fi
    exit 1
  fi
fi
rm -f "$NEW"

sleep 2
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
grep -q '^ADMIN_PASSWORD_HASH=' "$f" || echo "!! 还没设置后台密码：ssh -t -i ~/.ssh/resume.pem root@<server> pearlkin-admin-password"
REMOTE

echo "== done: https://$DOMAIN  https://$DOMAIN/app/  https://$DOMAIN/admin"

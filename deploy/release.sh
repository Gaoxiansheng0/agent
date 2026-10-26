#!/usr/bin/env bash
# 在本地（Git Bash）执行：发布到香港服务器（Node 与 Caddy 已由简历站装好）。
#
#   首次部署：bash deploy/release.sh root@8.218.190.208 -i ~/.ssh/resume.pem --init
#   之后更新：bash deploy/release.sh root@8.218.190.208 -i ~/.ssh/resume.pem
#
# --init  创建运行用户、.env（DeepSeek Key 直接从服务器上 ai-reader 的 .env 复制，不经过本机）、
#         系统服务和 Caddy 站点。
# 站点不加密码，但发送 noindex，不被搜索引擎收录。
set -euo pipefail

target="" key="" init=0
while [ $# -gt 0 ]; do
  case "$1" in
    -i) key="$2"; shift 2 ;;
    --init) init=1; shift ;;
    *) target="$1"; shift ;;
  esac
done
[ -n "$target" ] || { echo "用法：bash deploy/release.sh root@服务器IP [-i 私钥路径] [--init]"; exit 1; }
ssh_opts=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15)
[ -n "$key" ] && ssh_opts+=(-i "$key")
remote() { ssh "${ssh_opts[@]}" "$target" "$@"; }
APP_DIR=/opt/flow-forge
PORT=8840
DOMAIN=flow.pearlwren.com

cd "$(dirname "$0")/.."

echo "==> 测试与构建（含类型检查）"
npm test
npm run build

echo "==> 打包"
stage=$(mktemp -d)
cp -r package.json package-lock.json server shared config dist deploy README.md .env.example "$stage/"
bundle="flow-forge-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$bundle" -C "$stage" .
rm -rf "$stage"

echo "==> 上传代码"
scp "${ssh_opts[@]}" "$bundle" "$target:/tmp/$bundle"
rm -f "$bundle"

if [ $init = 1 ]; then
  echo "==> 初始化（用户、.env、服务、Caddy）"
  remote "bash -s" <<EOF
set -euo pipefail
id flowforge >/dev/null 2>&1 || useradd --system --home-dir $APP_DIR --shell /usr/sbin/nologin flowforge
mkdir -p $APP_DIR
if [ ! -f $APP_DIR/.env ]; then
  key=\$(grep -E '^DEEPSEEK_API_KEY=' /opt/ai-reader/.env | cut -d= -f2-)
  model=\$(grep -E '^DEEPSEEK_MODEL=' /opt/ai-reader/.env | cut -d= -f2- || true)
  cat > $APP_DIR/.env <<ENV
PORT=$PORT
DEEPSEEK_API_KEY=\$key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=\${model:-deepseek-chat}
ENV
  chmod 600 $APP_DIR/.env
  echo "已新建 .env"
fi
cat > /etc/systemd/system/flow-forge.service <<UNIT
[Unit]
Description=flow-forge (video script to Dify/Coze workflow)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=flowforge
Group=flowforge
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/node $APP_DIR/node_modules/tsx/dist/cli.mjs server/index.ts
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
MemoryMax=300M

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/sites/flow-forge.caddy <<CADDY
$DOMAIN {
	encode zstd gzip
	header X-Robots-Tag "noindex, nofollow, noarchive"
	reverse_proxy 127.0.0.1:$PORT {
		header_up X-Real-IP {remote_host}
	}
}
CADDY
systemctl daemon-reload
systemctl enable flow-forge >/dev/null
EOF
fi

echo "==> 安装并重启"
remote "bash -s" <<EOF
set -euo pipefail
cd $APP_DIR
rm -rf server shared config dist
tar -xzf /tmp/$bundle -C $APP_DIR
rm /tmp/$bundle
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R flowforge:flowforge $APP_DIR
systemctl restart flow-forge
caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy
sleep 3
systemctl is-active flow-forge
EOF
echo "==> 完成：https://$DOMAIN"

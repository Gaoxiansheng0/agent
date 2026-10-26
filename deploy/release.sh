#!/usr/bin/env bash
# 在本地（Git Bash）执行：发布到香港服务器（Node 与 Caddy 已由简历站装好）。
#
#   首次部署：bash deploy/release.sh root@8.218.190.208 -i ~/.ssh/resume.pem --init
#   之后更新：bash deploy/release.sh root@8.218.190.208 -i ~/.ssh/resume.pem
#
# --init  创建运行用户、.env（DeepSeek Key 直接从服务器上 ai-reader 的 .env 复制，不经过本机）、
#         系统服务和 Caddy 站点。线上数据（data/）不会被覆盖。
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
APP_DIR=/opt/idea-forge
PORT=8830
DOMAIN=idea.pearlwren.com

cd "$(dirname "$0")/.."

echo "==> 类型检查、测试与前端构建"
npm run check
npm test
npm run build

echo "==> 打包"
stage=$(mktemp -d)
cp -r package.json package-lock.json server shared dist deploy README.md .env.example "$stage/"
bundle="idea-forge-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$bundle" -C "$stage" .
rm -rf "$stage"

echo "==> 上传代码"
scp "${ssh_opts[@]}" "$bundle" "$target:/tmp/$bundle"
rm -f "$bundle"

if [ $init = 1 ]; then
  echo "==> 初始化（用户、.env、服务、Caddy）"
  remote "bash -s" <<EOF
set -euo pipefail
id ideaforge >/dev/null 2>&1 || useradd --system --home-dir $APP_DIR --shell /usr/sbin/nologin ideaforge
mkdir -p $APP_DIR/data
if [ ! -f $APP_DIR/.env ]; then
  key=\$(grep -E '^DEEPSEEK_API_KEY=' /opt/ai-reader/.env | cut -d= -f2-)
  model=\$(grep -E '^DEEPSEEK_MODEL=' /opt/ai-reader/.env | cut -d= -f2- || true)
  cat > $APP_DIR/.env <<ENV
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=data
DEEPSEEK_API_KEY=\$key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=\${model:-deepseek-chat}
# 联网检索 Key（三选一）：填上后 systemctl restart idea-forge
SEARCH_PROVIDER=
TAVILY_API_KEY=
SERPER_API_KEY=
BOCHA_API_KEY=
SEARCH_RESULTS_PER_QUERY=5
ENV
  chmod 600 $APP_DIR/.env
  echo "已新建 .env"
fi
cat > /etc/systemd/system/idea-forge.service <<UNIT
[Unit]
Description=idea-forge (idea to business plan)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ideaforge
Group=ideaforge
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/node --disable-warning=ExperimentalWarning --env-file-if-exists=.env server/index.ts
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data
MemoryMax=300M

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/sites/idea-forge.caddy <<CADDY
$DOMAIN {
	encode zstd gzip
	header X-Robots-Tag "noindex, nofollow, noarchive"
	reverse_proxy 127.0.0.1:$PORT {
		header_up X-Real-IP {remote_host}
	}
}
CADDY
systemctl daemon-reload
systemctl enable idea-forge >/dev/null
EOF
fi

echo "==> 安装并重启"
remote "bash -s" <<EOF
set -euo pipefail
cd $APP_DIR
rm -rf server shared dist
tar -xzf /tmp/$bundle -C $APP_DIR
rm /tmp/$bundle
chown -R ideaforge:ideaforge $APP_DIR
systemctl restart idea-forge
caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy
sleep 2
systemctl is-active idea-forge
EOF
echo "==> 完成：https://$DOMAIN"

#!/usr/bin/env bash
# 服务器一次性初始化（可重复执行）：deploy/setup-server.sh <host> <证书路径> <私钥路径>
# 建 lightmeal 用户和目录、安装 systemd 单元、添加 nginx 站点（可选：加入 stream SNI 分流）。
# 配置读取 deploy/deploy.env；nginx -t 失败会自动回滚。/etc/light-meal.env 由 deploy.sh 同步。
set -euo pipefail
cd "$(dirname "$0")"
[ -f deploy.env ] || { echo "缺少 deploy/deploy.env，请参照 deploy.env.example 创建" >&2; exit 1; }
. ./deploy.env
[ $# -eq 3 ] || { echo "用法：$0 <host> <证书路径> <私钥路径>" >&2; exit 1; }
HOST=$1 CERT=$2 KEY=$3

sed -e "s#__DOMAIN__#$APP_DOMAIN#" -e "s#__LISTEN__#$NGINX_LISTEN#g" -e "s#__PORT__#$APP_PORT#" -e "s#__CERT__#$CERT#" -e "s#__KEY__#$KEY#" nginx-light-meal.conf \
  | ssh "root@$HOST" "cat > /tmp/light-meal.conf"
sed "s#__PORT__#$APP_PORT#" light-meal.service | ssh "root@$HOST" "cat > /etc/systemd/system/light-meal.service"

ssh "root@$HOST" DOMAIN="$APP_DOMAIN" BACKEND="${NGINX_SNI_BACKEND:-}" bash -s <<'REMOTE'
set -e
id lightmeal >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin lightmeal
mkdir -p /opt/light-meal/releases
[ -f /etc/light-meal.env ] || install -m 640 -g lightmeal /dev/null /etc/light-meal.env
BAK=/etc/nginx/nginx.conf.bak-light-meal-$(date +%Y%m%d%H%M%S)
cp /etc/nginx/nginx.conf "$BAK"
if [ -n "$BACKEND" ] && ! grep -qE "^\s*${DOMAIN//./\\.}\s" /etc/nginx/nginx.conf; then
  sed -i "/map \$ssl_preread_server_name/a\        $DOMAIN $BACKEND;" /etc/nginx/nginx.conf
fi
mv /tmp/light-meal.conf /etc/nginx/conf.d/light-meal.conf
if nginx -t 2>/tmp/nginx-t.log; then
  systemctl reload nginx
else
  cat /tmp/nginx-t.log; cp "$BAK" /etc/nginx/nginx.conf; rm -f /etc/nginx/conf.d/light-meal.conf
  echo "nginx 配置检查失败，已回滚"; exit 1
fi
systemctl daemon-reload
systemctl enable light-meal >/dev/null 2>&1
echo "setup ok on $(hostname)"
REMOTE

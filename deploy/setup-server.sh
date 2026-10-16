#!/usr/bin/env bash
# 一次性初始化（可重复执行）：deploy/setup-server.sh <host> <cert> <key>
# 建 lightmeal 用户和目录、装 systemd 单元、加 nginx 站点和 SNI 分流。/etc/light-meal.env 需另行写入。
set -euo pipefail
cd "$(dirname "$0")"
HOST=$1 CERT=$2 KEY=$3
sed "s#__CERT__#$CERT#; s#__KEY__#$KEY#" nginx-light-meal.conf | ssh "root@$HOST" "cat > /tmp/light-meal.conf"
scp -q light-meal.service "root@$HOST:/etc/systemd/system/light-meal.service"
ssh "root@$HOST" 'set -e
  id lightmeal >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin lightmeal
  mkdir -p /opt/light-meal/releases
  [ -f /etc/light-meal.env ] || install -m 640 -g lightmeal /dev/null /etc/light-meal.env
  cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-light-meal-$(date +%Y%m%d%H%M%S)
  grep -q "meal.example.com" /etc/nginx/nginx.conf || sed -i "/^\s*cdn.example.com\s\+real_web;/a\        meal.example.com         real_web;" /etc/nginx/nginx.conf
  mv /tmp/light-meal.conf /etc/nginx/conf.d/light-meal.conf
  if nginx -t 2>/tmp/nginx-t.log; then systemctl reload nginx; else cat /tmp/nginx-t.log; exit 1; fi
  systemctl daemon-reload
  systemctl enable light-meal >/dev/null 2>&1
  echo "setup ok on $(hostname)"'

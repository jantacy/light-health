#!/usr/bin/env bash
# 本机构建 Next.js standalone 包，推到服务器并重启服务。
# 用法：deploy/deploy.sh [host...]   不带参数时发布到 deploy/deploy.env 里的 DEPLOY_HOSTS
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/deploy.env ] || { echo "缺少 deploy/deploy.env，请参照 deploy/deploy.env.example 创建" >&2; exit 1; }
. deploy/deploy.env
if [ $# -gt 0 ]; then HOSTS=("$@"); else read -r -a HOSTS <<< "$DEPLOY_HOSTS"; fi
[ -f .env.local ] || { echo "缺少 .env.local（构建时需要 NEXT_PUBLIC_SUPABASE_*）" >&2; exit 1; }

npm run build
PKG=$(mktemp -d)/light-meal
cp -R .next/standalone "$PKG"
rm -f "$PKG"/.env*                      # 服务端密钥只放在 /etc/light-meal.env
cp -R .next/static "$PKG/.next/static"
cp -R public "$PKG/public"
REL=$(date +%Y%m%d%H%M%S)

for h in "${HOSTS[@]}"; do
  echo "==> $h"
  # 服务端配置：.env.local 去掉只在本机用的数据库密码
  grep -v '^SUPABASE_DB_PASSWORD=' .env.local | ssh "root@$h" "cat > /etc/light-meal.env.new && install -m 640 -o root -g lightmeal /etc/light-meal.env.new /etc/light-meal.env && rm /etc/light-meal.env.new"
  ssh "root@$h" "mkdir -p /opt/light-meal/releases/$REL"
  rsync -az --delete "$PKG/" "root@$h:/opt/light-meal/releases/$REL/"
  ssh "root@$h" "set -e
    chown -R root:root /opt/light-meal/releases/$REL
    ln -sfn /opt/light-meal/releases/$REL /opt/light-meal/current
    systemctl restart light-meal
    for i in \$(seq 1 20); do curl -fs -o /dev/null http://127.0.0.1:$APP_PORT/ && break; sleep 1; done
    curl -fs -o /dev/null http://127.0.0.1:$APP_PORT/ && echo '   服务正常' || { journalctl -u light-meal -n 30 --no-pager; exit 1; }
    ls -1dt /opt/light-meal/releases/* | tail -n +4 | xargs -r rm -rf   # 保留最近 3 个版本"
done

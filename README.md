# 轻食记 · 私人饮食记录 PWA

给 3–10 位受邀用户用的饮食和体重记录工具：拍照识别食物、AI 估算热量和三大营养素、按天汇总和看趋势。主要在 iPhone Safari 上使用，可以添加到主屏幕当 App 用。

- 技术栈：Next.js 15（App Router，standalone 输出）+ Supabase（Postgres / Auth / Storage）+ OpenAI 兼容的视觉/语言模型（默认 DeepSeek）
- 部署：自建 Linux 服务器（nginx + systemd），可多台同时运行，前面可以套 Cloudflare 等 CDN

## 功能

| 模块 | 说明 |
| --- | --- |
| 登录 | 手机号 + License，管理员在 `/admin/licenses` 签发，无短信、无邮箱 |
| 记录一餐 | 照片可选，可多张；上传后自动识别，识别出几种食物就列几行（食物、重量、热量、✓）。改名称或重量后点 ✓ 重新计算；清空名称再点即删除。可补录过去的日期 |
| 每日 | 当天摄入汇总（热量 / 蛋白质 / 碳水 / 脂肪），前后翻日期，点记录编辑，点照片看大图 |
| 趋势 | 热量和体重折线图，7 / 30 / 90 天，点某一天查看或跳转 |
| 体重 | 每天一条，可选日期补录 |
| 设置 | 头像（可自行更换）、昵称、性别、生日（月日）、星座（由生日推算） |
| 启动页 | iOS 启动图 + 应用内启动页，显示每日一句积极、健康的短句 |
| 离线 | 页面、照片、食物数据本地缓存；保存先落本地，后台同步 |

营养数据都是估算值，份量、酱料和用油误差最大，保存前可以修改。

## 架构

```
iPhone（PWA）
 ├─ Service Worker：页面缓存秒开、静态资源缓存
 ├─ 本地：照片缓存（7 天）、食物库缓存（7 天）、每日一句（10 天）、待同步队列
 ├─ Supabase（直连，RLS 只能读写自己的数据）：饮食、体重、资料、照片、头像
 └─ 你的域名（CDN → nginx → Next.js）
      ├─ /api/auth/license   手机号 + License 登录，换取 Supabase 会话
      ├─ /api/admin/licenses 管理员签发 License
      ├─ /api/analyze        识图（视觉模型，保留推理）
      ├─ /api/estimate       按名称 + 重量估算（先查食物库，再问语言模型）
      ├─ /api/quotes         未来 10 天的每日一句
      └─ 后台任务            每 30 分钟按使用次数重估常用食物
```

服务端密钥（service role、模型 API key、管理员密钥）只在服务器上，浏览器拿不到。

## 目录

```
src/app/                 页面和 API 路由（api/analyze、estimate、quotes、auth、admin）
src/components/          home（主界面）、meal-modal（记录一餐）、trends、settings-modal、splash 等
src/lib/vision/          模型 provider：OpenAI 兼容接口、返回结果解析
src/lib/food-library.ts  服务端共享食物库读写
src/lib/food-refresh.ts  食物库定时重估（由 src/instrumentation.ts 启动）
src/lib/food-cache.ts    手机本地食物库
src/lib/outbox.ts        饮食记录的待同步队列
src/lib/photo-cache.ts   照片本地缓存
public/sw.js             Service Worker
supabase/schema.sql      数据库、存储桶、RLS、触发器（可重复执行）
deploy/                  部署脚本、systemd 单元、nginx 配置
```

## 数据模型

| 表 / 桶 | 用途 | 访问 |
| --- | --- | --- |
| `user_licenses` | 手机号、License 哈希、对应的 Auth 用户、状态 | 仅服务端 |
| `user_profiles` | 昵称、性别、生日、头像路径 | 本人可读；只能改昵称/性别/生日/头像 |
| `meal_records` | 一条饮食记录：日期、餐次、总营养、`dishes`（按照片分组的食物明细，每项含名称、克数、热量、三大营养素） | 本人 |
| `weight_records` | 每天一条体重 | 本人 |
| `food_library` | 共享食物库，每 100 克营养，含使用次数 `uses`、待更新标记 `needs_refresh` | 仅服务端 |
| `app_settings` | 键值配置，如 `food_refresh_every` | 仅服务端 / SQL |
| `meal-photos` 桶 | 饮食照片，按用户 ID 分目录 | 本人 |
| `avatars` 桶 | 头像，按用户 ID 分目录 | 本人 |

`schema.sql` 可以重复执行，用于新建和升级。

## 登录与 License

- 管理员在 `/admin/licenses` 输入手机号（11 位大陆号码或带国家码，统一存为 E.164）和管理员密钥，生成 License。明文只显示这一次，数据库只存 SHA-256 哈希。
- 用户必须同时输入手机号和对应的 License。服务端把手机号映射到一个内部 Supabase Auth 用户，签发会话后，浏览器用 RLS 直接读写自己的数据。
- 内部 Auth 密码只在创建账号和重新签发 License 时设置，登录时不改：Supabase 修改密码会注销该账号的所有会话，所以同一账号可以同时在多台设备（或 Safari 与主屏幕 App）登录。
- 重新签发会让旧 License 立即失效，并注销该账号已有的全部会话。撤销：把 `user_licenses.status` 改成 `revoked`。
- 浏览器端会话存在 localStorage（Safari 会把脚本写的 cookie 限制为 7 天）；旧版本存在 cookie 里的会话，首次打开新版本时自动迁移。
- 最多 10 个手机号。Supabase 的公开注册已关闭；Email/Password provider 需保持开启，供服务端创建内部账号用。
- 每次调用 AI 接口都会校验登录状态和 License 是否有效，未授权时不会把数据发给模型。

## AI 识别与估算

模型调用封装在 `src/lib/vision/`，前端不绑定任何厂商。

| `VISION_PROVIDER` | 默认模型 | 说明 |
| --- | --- | --- |
| `deepseek`（默认） | `deepseek-flash` | 支持图片输入，价格最低 |
| `qwen` | `qwen-vl-max-latest` | 阿里百炼 OpenAI 兼容接口 |
| 其他名称 | — | 同时设置 `VISION_BASE_URL` 和 `VISION_MODEL`，任何 OpenAI 兼容接口都可以 |

- **识图** `/api/analyze`：浏览器先把照片（含 HEIC）缩到最长边 1600px 的 JPEG。模型逐项返回食物名称、估计克数、热量和三大营养素；保留推理，超时 55 秒，通常 8–20 秒。
- **按名称估算** `/api/estimate`：只调用语言模型、不发图片，并关闭推理（DeepSeek 的 `thinking: disabled`），通常 1–3 秒。
- **只改重量**：直接在手机上按比例换算，不联网。
- **查找顺序**：手机本地食物库 → 服务端 `food_library` → 模型。模型或识图得到的新食物会自动入库，已有的不覆盖，所以同一种食物前后数值一致。
- **定期重估**：每保存一条记录，触发器给其中每种食物的 `uses` 加 1；每满 N 次标记待更新。服务端每 30 分钟认领一批，让模型按"名称，100克"重估，新旧值各取一半。N 默认 30，修改后立即生效：

  ```sql
  update public.app_settings set value = '50' where key = 'food_refresh_every';
  ```

- **每日一句**：`/api/quotes` 由模型生成积极、健康的短句（中文不超过 20 字，或英文不超过 10 个词），每台服务器每天生成一次；失败时用内置列表。

没有选用百度菜品识别，因为它只给菜名和每 100 克热量，没有三大营养素，也不估份量。

## 离线与同步

- **启动**：iOS 启动图（`public/splash/`，覆盖常见 iPhone 尺寸）→ 应用内启动页（读取登录状态期间显示）。Service Worker 有缓存时直接用缓存打开页面，后台更新，所以**新版本在第二次打开时生效**。
- **保存 / 删除**：照片先存进本地缓存，记录写入待同步队列（`localStorage`），弹窗立即关闭。后台依次上传照片、写数据库、删除被替换的旧照片。联网恢复、打开 App、或每分钟一次会自动重试。记录 ID 在客户端生成，写入都是 upsert，重试不会重复。提示区显示"正在同步 N 条记录"，完成后显示 3 秒"所有饮食记录已同步"。
- **照片**：按存储路径缓存在 Cache Storage 中，保存 7 天；离线时过期的照片也照样显示。
- **当天数据**：Supabase 连不上时，显示上次缓存的当天数据。

## 本地开发

1. 复制 `.env.example` 为 `.env.local`，填写：
   - `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（只在服务端用，不能加 `NEXT_PUBLIC_` 前缀）
   - `LICENSE_ADMIN_SECRET`（至少 32 位随机字符）
   - `VISION_PROVIDER`、`VISION_API_KEY`（可选 `VISION_BASE_URL`、`VISION_MODEL`）
2. 执行 `supabase/schema.sql`（SQL Editor，或 `npx supabase db query --linked --project-ref <ref> -f supabase/schema.sql`）。
3. 启动：

   ```bash
   npm install
   npm run dev          # 开发
   npm run build && npm start   # 本地跑生产版本（Service Worker 只在生产版本注册）
   ```

4. 测试用固定测试账号，手机号和 License 放在 `.env.test.local`（已被 git 忽略，也不会同步到服务器）。不要每次新建和删除测试用户。

## 部署

在本机构建 standalone 包，用 rsync 推到一台或多台服务器，由 systemd 运行、nginx 反代。应用本身无状态（数据都在 Supabase），多台服务器可以同时运行，配合 DNS 切换做主备。

1. 复制 `deploy/deploy.env.example` 为 `deploy/deploy.env`（不进 git），填写服务器、域名、端口和 nginx 监听方式。
2. 每台服务器初始化一次（可重复执行；`nginx -t` 失败会自动回滚）：

   ```bash
   deploy/setup-server.sh <host> <证书路径> <私钥路径>
   ```

   会创建 `lightmeal` 系统用户、`light-meal.service`（内存上限 320M）和 nginx 站点。如果 443 由 nginx stream 按 SNI 分流，设置 `NGINX_SNI_BACKEND` 后脚本会把域名加进 SNI map。

3. 发布：

   ```bash
   deploy/deploy.sh          # 发布到 DEPLOY_HOSTS：构建、同步 /etc/light-meal.env（来自 .env.local，不含数据库密码）、重启、健康检查，保留最近 3 个版本
   deploy/deploy.sh host2    # 只发某一台
   ```

服务器需要 Node.js 20+、nginx（1.25+，使用了 `http2 on`）、rsync，以及能用 root 登录的 SSH。

## 运维与排查

```bash
journalctl -u light-meal -f        # 应用日志（识图、估算、食物库重估都会打日志）
systemctl restart light-meal
curl -s --resolve <域名>:443:127.0.0.1 https://<域名>/   # 在服务器上绕过 CDN 测源站
```

注意事项：

- 如果前面套了 Cloudflare：源站不要返回 502/504，否则会被换成 Cloudflare 自己的非 JSON 错误页；接口出错统一用 503。
- 推理模型的推理 token 也计入 `max_tokens`，上限太小会返回空内容。
- 本机如果通过 Clash 等工具走 TUN 代理，`curl --resolve <IP>` 仍会按域名被转发到 CDN；要测源站，请在服务器上执行。
- iOS 的启动图要删除主屏幕图标后重新"添加到主屏幕"才会更新。

## 已知限制

- 每日热量目标固定为 2000 kcal。
- 食物库还没有管理页面，修改数值需要直接改表。
- 照片从 Supabase Storage 直接加载，首次查看和上传受用户到 Supabase 区域的网络影响。

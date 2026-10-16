# 轻食记 · 私人饮食 PWA

为 3–10 位受邀用户设计的移动端饮食与体重记录工具。包含 License 登录、今日饮食汇总、餐食照片上传、营养数据手动修正、体重记录，以及 AI 识图的服务端接入位置。页面适配 iPhone Safari，可添加到主屏幕。

## License 规则

- 管理员打开 `/admin/licenses`，输入手机号（11 位大陆号码或 +国家码，服务端统一为 E.164）和 `LICENSE_ADMIN_SECRET`，由服务端生成 License。
- 每个手机号至多对应一条有效 License。重新签发时旧 License 立即替换，并封禁对应的 Supabase Auth 用户；新的 License 登录后恢复账号。已签发的短期访问令牌可能在到期前仍可用。
- 管理员将 License 通过安全渠道交给对应手机号的使用者。用户登录时必须同时输入手机号和 License；服务端同时匹配手机号与 License 哈希，不提供仅凭 License 反查或登录的方式，也不收短信验证码或用户邮箱。
- 数据库只保存 License 的 SHA-256 哈希。明文只在签发成功时返回并展示一次，管理员应立即复制给用户。
- 服务端使用手机号哈希映射到内部 Supabase Auth 用户，创建认证会话后，浏览器继续使用 Supabase RLS 访问自己的记录。
- Supabase Auth 需启用 Email/Password provider 供服务端建立内部 Auth 账号使用；用户流程不收集邮箱、不发送邮件，也不要求用户输入邮箱。
- 最多 10 个受邀手机号。管理入口需要 HTTPS，并使用至少 32 字符的随机管理员密钥。请不要把管理员密钥放在 `NEXT_PUBLIC_` 环境变量中。

## 配置与启动

1. 在 Supabase 创建项目。
2. 将 `.env.example` 复制为 `.env.local`，设置：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（只供服务端使用）
   - `LICENSE_ADMIN_SECRET`（建议随机生成至少 32 字符）
3. 在 Supabase SQL Editor 执行 [`supabase/schema.sql`](./supabase/schema.sql)。这会创建 License、饮食、体重表及私有图片存储策略。
4. 安装并启动：

   ```bash
   npm install
   npm run dev
   ```

5. 打开 `/admin/licenses` 为每个受邀手机号签发 License，再把 License 交给对方。iPhone 端打开站点后输入手机号和对应 License 登录。

## 访问控制与数据

- License 签发和验证都在服务端执行，License 明文不入库。
- `user_licenses` 无客户端访问策略；RLS 将餐食、体重和私有 Storage 图片限制为当前用户自己的数据。
- 重新签发同一手机号的 License 会使旧 License 失效；撤销可在 Supabase SQL Editor 中将该号码的状态更新为 `revoked`，并封禁对应 auth user。
- `SUPABASE_SERVICE_ROLE_KEY` 绝不能带 `NEXT_PUBLIC_` 前缀或传入浏览器。

## AI 识图

识图封装为服务端 provider（`src/lib/vision/`），前端只调用 `/api/analyze`，不绑定任何厂商，API key 只在服务端。

| `VISION_PROVIDER` | 默认模型 | 说明 |
| --- | --- | --- |
| `deepseek`（默认） | `deepseek-flash` | 2026-09 起主模型原生支持图片输入，价格最低 |
| `qwen` | `qwen-vl-max-latest` | 阿里百炼 OpenAI 兼容接口，中文菜品识别可作备选 |
| 其他任意名称 | — | 需同时设置 `VISION_BASE_URL` 和 `VISION_MODEL`，任何 OpenAI 兼容视觉接口都可用 |

环境变量：`VISION_API_KEY`（旧的 `DEEPSEEK_API_KEY` 仍兼容），可选 `VISION_BASE_URL`、`VISION_MODEL` 覆盖预置值。

**为什么没用百度菜品识别：** 它面向单菜品图，只返回菜名和每 100g 卡路里，没有蛋白质/碳水/脂肪，也不估算份量；混合使用时三大营养素仍需要大模型补充。目前直接用视觉大模型一次性给出整份估算，后续若要接入，在 `src/lib/vision/` 新增 provider 即可。

**流程：**
1. 浏览器先把照片（含 iPhone HEIC）缩到最长边 1600px 并转成 JPEG（`src/lib/image.ts`），既避开 Vercel 4.5MB 请求体限制，也绕过预编译 sharp 不能解 HEIC 的问题。
2. `/api/analyze` 校验 Supabase 登录和 License 有效性，未授权时不会把图片发给模型。
3. 模型返回整份餐食的热量、三大营养素、分项明细（菜名/份量/热量）、把握程度和估算说明；服务端校验字段后回传。
4. 表单回填并标记“AI 估算”，分项明细自动写入备注，用户保存前可修改任何数值。

照片营养估算是近似值，尤其是份量、酱料和烹饪用油。API 故障不影响手动录入。

## 食物库

估算顺序：手机本地（7 天有效）→ 服务端 `food_library`（每 100 克营养，所有用户共享）→ AI。AI 文字估算和识图得到的新食物会自动入库，已有的不覆盖。

- 每保存一条饮食记录，触发器按食物名称累加 `uses`；每满 N 次标记 `needs_refresh`。
- 服务端每 30 分钟认领待更新的食物，让 AI 按"名称，100克"重估，新旧值各取一半。
- N 在 `app_settings` 表里，默认 30。修改：`update public.app_settings set value = '50' where key = 'food_refresh_every';`（立即生效，不用重新部署）

## 部署（server1 主 / server2 备）

线上地址 `https://meal.example.com`。DNS 是 Cloudflare 代理的 CNAME → `www.example.com`，双机切换时随 www 一起切，不需要改 HA 脚本。

- 请求链路：Cloudflare → 443 nginx stream（按 SNI 分到 real_web:9000）→ `conf.d/light-meal.conf` → `127.0.0.1:3100` 的 `light-meal.service`（lightmeal 用户，内存上限 320M）。
- 证书：server1 用现有的 `*.example.com` 通配符证书；server2 用单独签发的 `/root/.acme.sh/meal.example.com_ecc/`，续期后自动 reload nginx。
- 服务端配置在两台的 `/etc/light-meal.env`，由 `deploy.sh` 从本机 `.env.local` 同步（不含数据库密码）。
- 应用无状态，数据都在 Supabase（东京，项目 `your-project-ref`），两台同时运行即可。

日常发布：

```bash
deploy/deploy.sh            # 本机构建 standalone，推到 server1 和 server2，重启并检查
deploy/deploy.sh server2       # 只发某一台
```

新服务器初始化：`deploy/setup-server.sh <host> <cert> <key>`（可重复执行，nginx -t 失败会自动回滚）。

排查：`ssh root@server1 journalctl -u light-meal -f`。源站不要返回 502/504，Cloudflare 会把它们换成自己的非 JSON 错误页。

## iPhone 安装

在 iPhone Safari 打开 `https://meal.example.com`，点分享按钮并选择“添加到主屏幕”。Manifest 使用 standalone 展示模式，并提供 192/512 PNG 图标与 Apple touch icon。

## 功能

- **每日**：按天查看摄入汇总与饮食记录，可前后翻日期、为过去的日期补记；点记录可编辑或删除（照片会一并删除）。
- **趋势**：近 7/30 天每日热量柱状图（含 2000 kcal 目标线）、记录天数、日均热量/蛋白质，以及体重变化曲线；点柱子跳到当天。
- **体重**：每天一条，重复记录会覆盖当天数值。
- 日期统一按设备本地时区计算。

## 当前范围

- 每日热量目标固定为 2000 kcal，暂未做个人设置。
- 暂无离线缓存（Service Worker）；iOS 添加到主屏幕不依赖它。

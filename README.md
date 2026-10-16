# 轻食记 · 私人饮食 PWA

为 3–10 位受邀用户设计的移动端饮食与体重记录工具。包含 License 登录、今日饮食汇总、餐食照片上传、营养数据手动修正、体重记录，以及 AI 识图的服务端接入位置。页面适配 iPhone Safari，可添加到主屏幕。

## License 规则

- 管理员打开 `/admin/licenses`，输入手机号和 `LICENSE_ADMIN_SECRET`，由服务端生成 License。
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

已接入 DeepSeek `deepseek-flash`。在服务端设置 `DEEPSEEK_API_KEY` 后，识图会调用 DeepSeek OpenAI 兼容的 Chat Completions API，要求模型返回 JSON，并校验菜名、热量和三大营养素字段。API 会验证当前 Supabase 登录状态和手机号对应 License 是否有效；未登录或授权失效时不发送图片给模型。

识图支持 JPG、PNG、WebP、GIF 和 iPhone HEIC/HEIF。服务端使用 Sharp 自动旋转、缩到最长边 2048 像素并转为 JPEG，再发送给模型。单张图片最大 10 MB。`src/app/api/analyze/route.ts` 中的结果会回填到表单，用户保存前可以修正所有估算值。

照片营养估算是近似值，尤其是份量、酱料和烹饪用油；请把结果作为记录起点，按实际情况修改。API 故障不会阻止手动录入。

预期 JSON 格式：

```json
{
  "title": "鸡胸肉藜麦沙拉",
  "calories": 420,
  "protein_g": 32,
  "carbs_g": 38,
  "fat_g": 14
}
```

要换成其他视觉模型，可在同一路由替换 provider 请求格式，并保留账号授权检查和返回数据校验。

## iPhone 安装

生产环境请用 HTTPS 部署。在 iPhone Safari 打开站点，点分享按钮并选择“添加到主屏幕”。Manifest 使用 standalone 展示模式，并提供 192/512 PNG 图标与 Apple touch icon。

## 当前范围

- 云端项目和真实密钥需要由使用者创建与配置。
- DeepSeek API key 需要在部署环境配置后才能调用视觉识别。
- 体重趋势使用最近记录的轻量可视化；编辑、删除、导出可在后续补充。

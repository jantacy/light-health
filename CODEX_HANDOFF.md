# FoodLog PWA — Codex handoff

请在当前仓库基础上继续实现个人/小圈子使用的饮食记录 PWA。先检查现有代码和 README，再改动；保留已有可用实现，不要重建项目。

## 产品范围

- Next.js / React 移动端优先 PWA，主要给 iPhone Safari 使用，可添加到主屏幕并以 standalone 模式运行。
- 仅 3–10 人私用。不要增加营养师、组队、社交、会员等公开产品功能。
- 核心页面：登录、今日摄入汇总、饮食历史/趋势、体重记录。
- 可拍照或上传饮食照片，识别食物并估算热量、蛋白质、碳水、脂肪；保存前允许用户编辑分析结果。
- Supabase PostgreSQL + Storage，服务端 API 密钥不得暴露给浏览器。

## 已确认的登录规则

- 不用邮箱、不发短信验证码。
- 管理入口由管理员输入手机号，服务端生成 license，再由管理员手动发给用户。
- 用户登录时提交手机号和 license；二者必须严格一一绑定。
- 不需要找回流程。管理员重新签发时，旧 license 失效。
- 普通未获授权用户不得访问应用及数据。

## 识图方案背景

- 当前 `/api/analyze` 中存在 DeepSeek 视觉模型的初步接入，但识图服务尚未最终确定。
- 百度菜品识别是专用 API，适合菜名/卡路里识别；官方说明普通接口面向单菜品图，且其公开结果字段没有蛋白质、碳水、脂肪。
- 可参考开源项目 `https://github.com/koushik-moorthy/south-indian-calorie-tracker`：Next.js + Supabase + PWA + 图片分析 + 可编辑记录，MIT 许可；但其邮箱认证、用户自带 OpenAI key 和南印度食物假设需要调整。
- 可参考开源项目 `https://github.com/RohamAbootorabian/calorie-count` 的 Supabase Edge Function、照片分析及 RLS/存储流程；它是 Expo/React Native 客户端，不要因此改变本项目的 Next.js PWA 方向。
- 不要把数据集误当成可直接接入的 API 或完整应用。营养估算需明确为估算值，用户可修正。

## 当前仓库

- `src/app`：页面和 API 路由
- `src/components/home.tsx`：主界面
- `src/app/api/analyze/route.ts`：当前照片分析实现
- `supabase/schema.sql`：数据库和 Storage/RLS schema
- `.env.example`：环境变量模板
- `README.md`：本地运行及部署说明

## 后续执行要求

1. 先审阅当前代码，列出可复用部分、缺口及尚未验证的风险。
2. 优先保持既定的 Next.js、Supabase 和手机号-license 方案。
3. 将识图服务封装为服务端 provider，避免前端绑定某家 API；再根据成本、中文菜品适配度、营养字段完整度和部署稳定性选择实现。
4. 不要假设百度能直接返回完整三大营养素；如果采用混合方案，要区分识别结果与模型估算结果。
5. 修改后说明改了什么以及实际验证范围；没有运行构建或验证时要明确说明。

# DEPLOY.md

## 项目说明

本项目是一个运行在 Even Hub WebView 插件中的中越实时翻译工具。  
前端运行在手机 WebView 中，通过 Even Hub SDK 与 G2 眼镜桥接；后端运行在云端，负责接收音频流、完成识别/翻译/辅助信息生成，并将结果返回前端显示到 HUD。[file:4][file:5]

当前最终 HUD 输出固定为 5 行：

1. `translatedText`
2. `recognizedText`
3. `autoReply`
4. `meaningText`
5. `pronunciationText` [file:4][file:5]

---

## 项目结构建议

```text
vn-translator/
  frontend/
    src/
    index.html
    package.json
    tsconfig.json
    vite.config.ts
    app.json
    .env.development
    .env.production
  backend/
    server.js
    package.json
    .env.example
  docs/
    DEPLOY.md
    TECHNICAL_NOTES.md
```

前端用于 Even Hub 打包与真机运行，后端用于云部署，文档目录用于保存部署和归档资料。[file:3][file:4]

---

## 一、部署目标

正式发布链路分为三部分：

1. 前端代码上传 GitHub。
2. 后端部署到 Render。
3. 前端切换生产 WebSocket 地址后，再通过 Even Hub 打包 `.ehpk`。[file:3][file:4]

不要在本地地址还未移除时直接打正式包，否则插件会依赖本地网络环境，无法脱离本地运行。[file:4]

---

## 二、后端部署到 Render

### 1. 准备后端目录

后端至少应包含：

- `server.js`
- `package.json`
- `.env.example`
- `.gitignore`

当前后端职责包括：

- HTTP 健康检查接口
- `/audio-stream` WebSocket 服务
- PCM 累积与 WAV 封装
- ASR / 翻译 / 自动回复 / 中文解释 / 辅助发音生成 [file:4]

### 2. 环境变量

Render 上至少需要配置以下环境变量：

```env
OPENAI_API_KEY=your_key_here
PORT=3000
```

实际部署时不要上传真实 `.env`，只在 Render 的 Environment 中填写真实密钥。[file:4]

### 3. 部署步骤

1. 将后端代码推送到 GitHub。
2. 在 Render 新建一个 Web Service。
3. 连接对应 GitHub 仓库。
4. 选择后端目录作为 Root Directory（如果前后端同仓库）。
5. 配置启动命令，例如：

```bash
node server.js
```

6. 在 Render 后台填入环境变量。
7. 部署完成后访问：

```text
https://your-render-domain.com/health
```

如果 `/health` 返回正常，说明服务已成功启动。[file:4]

### 4. 部署成功后需要记录

部署完成后，记录以下信息：

- Render 服务名
- Render 域名
- `/health` 地址
- WebSocket 地址

例如：

```text
HTTPS health:
https://your-render-domain.com/health

WebSocket:
wss://your-render-domain.com/audio-stream
```

前端生产环境将使用这个 WebSocket 地址。[file:4]

---

## 三、前端生产配置

前端运行在 Even Hub WebView 中，负责：

- 连接 `EvenAppBridge`
- 创建固定 TextContainer
- 采集音频事件
- 通过 WebSocket 发送 PCM
- 接收 `final_result`
- 用 `textContainerUpgrade` 更新 HUD [file:4][file:5]

### 1. 环境变量拆分

建议前端至少区分两个环境：

#### `.env.development`

```env
VITE_WS_URL=ws://192.168.x.x:3000/audio-stream
```

#### `.env.production`

```env
VITE_WS_URL=wss://your-render-domain.com/audio-stream
```

不要把局域网 IP 写死在 `main.ts` 里，应统一通过环境变量读取。[file:4]

### 2. 生产前必须确认

- 前端代码已经连接生产 `wss://.../audio-stream`
- 不再依赖本地电脑后端
- 调试日志已适当收敛
- 5 行 HUD 拼接逻辑使用最终正式版 [file:4][file:5]

---

## 四、GitHub 上传规范

在上传 GitHub 前，先确认以下内容：

- 不上传 `.env`
- 上传 `.env.example`
- 不上传 `node_modules`
- 不上传临时构建产物
- 补充 `README.md`
- 补充 `DEPLOY.md` [file:4]

建议 `.gitignore` 至少包含：

```gitignore
node_modules
dist
.env
.env.local
.DS_Store
```

如果前后端同仓库，建议分目录维护，避免部署和打包过程混乱。[file:4]

---

## 五、Even Hub 打包准备

Even Hub 插件不是普通网页应用，正式打包依赖 `app.json` manifest，并要求声明入口、权限、最低版本和网络白名单。[file:3]

### 1. app.json 关键项

正式 `app.json` 至少应包含：

- `package_id`
- `edition`
- `name`
- `version`
- `min_app_version`
- `min_sdk_version`
- `entrypoint`
- `permissions`
- `supported_languages` [file:3]

### 2. 本项目必须检查的权限

本项目至少需要：

- `network`
- `g2-microphone` [file:3]

其中 `network` 需要正确填写生产域名白名单，例如：

```json
{
  "name": "network",
  "desc": "Streams audio to the realtime translation service.",
  "whitelist": ["https://your-render-domain.com"]
}
```

麦克风权限示例：

```json
{
  "name": "g2-microphone",
  "desc": "Captures voice for realtime Vietnamese translation."
}
```

### 3. 语言声明注意事项

`supported_languages` 是应用界面语言声明，不等于业务翻译支持语言。  
当前资料显示 manifest 允许值中不包含 `vi`，因此即使你的业务支持越南语，manifest 中也不要直接写 `vi`。[file:3]

---

## 六、Even Hub 打包流程

开发阶段可使用 CLI 进行本地联调和打包。[file:3]

### 1. 本地联调

```bash
evenhub qr --url "http://你的局域网IP:5173"
```

这适合开发阶段真机联调，但只适用于局域网环境。[file:3]

### 2. 正式打包

当前端已切换到生产地址、`app.json` 已修正、权限白名单已确认后，再执行：

```bash
evenhub pack
```

打出的 `.ehpk` 才是可脱离本地环境的正式测试包。[file:3]

---

## 七、推荐发布顺序

建议严格按下面顺序发布：

1. 固定前端最终代码版本。
2. 固定后端最终代码版本。
3. 补 `.env.example`。
4. 上传 GitHub。
5. 部署 Render。
6. 获取生产域名和 WebSocket 地址。
7. 前端切换生产地址。
8. 修正 `app.json`。
9. 真机回归测试。
10. 执行 `evenhub pack` 打包。[file:3][file:4]

不要同时做“上传 GitHub + 改配置 + 打包 + 云部署”，这样最容易混乱。[file:4]

---

## 八、上线前检查清单

### 后端

- [ ] `server.js` 为最终版本
- [ ] `/health` 可访问
- [ ] `/audio-stream` 可连接
- [ ] `OPENAI_API_KEY` 已配置在 Render
- [ ] `.env.example` 已补齐
- [ ] 生产日志量已控制 [file:4]

### 前端

- [ ] WebSocket 地址已切到生产地址
- [ ] 不再写死局域网 IP
- [ ] `textContainerUpgrade` 路径正常
- [ ] 5 行显示逻辑为正式版
- [ ] 调试 UI 已收敛 [file:4][file:5]

### app.json

- [ ] `entrypoint` 正确
- [ ] `network` 白名单正确
- [ ] `g2-microphone` 权限已声明
- [ ] 最低版本号已填写
- [ ] `supported_languages` 合法 [file:3]

### 发布

- [ ] GitHub 仓库已更新
- [ ] Render 已部署最新 commit
- [ ] 真机已完成一次完整录音 → 返回结果 → HUD 更新验证
- [ ] 已执行正式打包 [file:4][file:5]

---

## 九、故障排查

### 1. 前端打开但没有结果

优先检查：

- WebSocket 地址是否还是本地地址
- Render 服务是否在线
- `/audio-stream` 路径是否正确
- `network` 白名单是否已包含生产域名 [file:3][file:4]

### 2. 有音频但没有最终结果

优先检查：

- Render 环境变量是否缺失
- OpenAI key 是否有效
- 后端 enrich 阶段是否 JSON 解析失败
- 后端日志是否报错 [file:4]

### 3. 有结果但 HUD 不更新

优先检查：

- `textContainerUpgrade` 是否调用成功
- 页面是否先创建过固定 TextContainer
- 前端是否仍在用旧版 payload 结构 [file:4][file:5]

---

## 十、当前维护原则

1. 不再改变“单容器 + 5 行文本 + 持续 upgrade”的核心显示方案。
2. 所有优化优先围绕“更稳、更短、更可读”。
3. 部署和打包前先统一最终代码版本，再动配置。
4. 真实 key 永远只放云端环境变量，不进仓库。[file:4]

---
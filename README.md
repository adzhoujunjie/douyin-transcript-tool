# 抖音视频口播文案提取工具

用于从抖音链接或本地视频/音频中提取口播文案，并提供“手动粘贴字幕/口播文本整理”兜底能力。项目保留现有单条、批量、文件导入、结果表格、复制、CSV 导出和访问密码保护功能。

## 功能概览

- 单个抖音链接识别：支持 `www.douyin.com` 长链、`v.douyin.com` 短链、完整分享口令文本自动提取链接。
- 批量链接识别：每行一条链接或分享口令，单条失败不影响其他链接。
- 上传链接文件：支持 `txt` / `csv` / `xlsx`，其中 `xlsx` 会从所有工作表、所有单元格提取抖音链接或分享口令。
- 上传视频/音频兜底识别：支持 `mp4` / `mp3` / `wav` / `m4a`，最大上传大小由后端限制为 600MB；实际 ASR 服务可能有更低限制，文件过大时请压缩或截短。
- 手动粘贴字幕/口播文本整理：只依赖 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`，不依赖视频下载和 ASR；仅轻度纠错、断句、补标点，不总结、不改写成广告文案、不改变原意。
- 诊断页：访问 `/diagnostics` 查看 ffmpeg、yt-dlp、Cookie、ASR、OpenAI 和目录可写性状态；不会展示 API Key、Cookie 内容；配置 `APP_PASSWORD` 后同样受密码保护。
- 导出 CSV：继续使用 UTF-8 BOM，避免 Excel 打开中文乱码。暂未新增 Excel xlsx 导出，建议先使用 CSV。

## 环境要求

- Node.js 18+
- npm
- ffmpeg：用于从视频中提取音频
- yt-dlp：用于尝试下载抖音视频

### Ubuntu / 阿里云安装系统依赖

```bash
apt update
apt install -y ffmpeg python3-pip
python3 -m pip install -U yt-dlp
```

如果服务器限制系统级 pip，可使用：

```bash
apt install -y pipx
pipx install yt-dlp
pipx ensurepath
```

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

打开：

```text
http://localhost:3001
```

开发模式：

```bash
npm run dev
```

## .env 示例说明

请复制 `.env.example` 到 `.env`，不要提交 `.env`。

```env
PORT=3001
APP_PASSWORD=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
ASR_PROVIDER=openai-compatible
ASR_API_KEY=
ASR_BASE_URL=
ASR_MODEL=
DOUYIN_COOKIES_FILE=/root/douyin-cookies.txt
```

配置说明：

- `PORT`：服务端口，默认 `3001`。
- `APP_PASSWORD`：访问密码。为空时不启用访问保护；存在时页面和 API 都需要密码。
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`：用于文本模型纠错和“手动粘贴字幕/口播文本整理”。
- `ASR_PROVIDER`：支持 `openai-compatible` 和 `disabled`。
- `ASR_API_KEY` / `ASR_BASE_URL` / `ASR_MODEL`：用于 OpenAI 兼容音频转写接口，优先调用 `/audio/transcriptions`。如果 `ASR_API_KEY` 或 `ASR_BASE_URL` 为空，会复用对应的 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。
- `DOUYIN_COOKIES_FILE`：可选。配置后且文件真实存在时，yt-dlp 下载抖音视频会自动附加 `--cookies <文件路径>`；文件不存在时继续按无 Cookie 逻辑尝试下载，不会直接崩溃。

## 抖音 Cookie 配置

当链接下载失败并提示 `Fresh cookies are needed`、`需要登录` 或 Cookie 相关错误时，需要在服务器配置 Cookie：

1. 建议使用专门的小号登录抖音网页后导出 `cookies.txt`。
2. Cookie 文件不要提交到 GitHub。
3. Cookie 文件不要截图、不要公开、不要发到群聊或工单。
4. 服务器路径建议放在 `/root/douyin-cookies.txt`。
5. `.env` 中配置：

```env
DOUYIN_COOKIES_FILE=/root/douyin-cookies.txt
```

配置完成后重启 PM2。若 Cookie 文件存在，后端调用 yt-dlp 时会带上 `--cookies /root/douyin-cookies.txt`。

## ASR 语音识别配置

### openai-compatible

```env
ASR_PROVIDER=openai-compatible
ASR_API_KEY=sk-xxxx
ASR_BASE_URL=https://api.openai.com/v1
ASR_MODEL=whisper-1
```

该模式会调用 OpenAI 兼容的 `/audio/transcriptions` 接口。若接口不支持音频转写，会返回明确中文提示，例如“当前 ASR_MODEL 可能不支持音频转写”或“ASR_BASE_URL 可能不是音频转写接口”。

### disabled

```env
ASR_PROVIDER=disabled
```

上传视频/音频功能仍会提取音频，但不会调用 ASR，页面会提示：

```text
当前未启用 ASR 语音识别，请配置可用的 ASR_PROVIDER / ASR_MODEL，或使用手动粘贴字幕整理功能。
```

## 如何使用

### 单条链接

在“单个链接识别”输入框中粘贴任意一种内容：

```text
https://www.douyin.com/video/7634809294119041935
```

```text
https://v.douyin.com/bDZ191tTDfg/
```

```text
9.23 ZzG:/ q@e.BT 05/20 标题 #话题 https://v.douyin.com/bDZ191tTDfg/ 复制此链接，打开抖音搜索，直接观看视频！
```

### 批量粘贴

在“批量链接识别”文本框中每行粘贴一条链接或一段分享文案，点击“批量提取”。

### 上传 txt / csv / xlsx

在“上传 txt / csv / xlsx 读取链接”区域选择文件并点击“上传文件并处理”。文件内容可以是纯链接，也可以夹杂中文、话题、复制提示。

### 上传视频/音频兜底识别

当链接解析、下载或访问失败时，可上传 `mp4` / `mp3` / `wav` / `m4a`。后端上传大小限制为 600MB；若 ASR 服务报文件过大，请上传更短视频或先压缩音频。

### 手动粘贴字幕/口播文本整理

粘贴抖音字幕、剪映识别字幕、第三方转写文本或人工粗稿，点击“整理文案”。该功能不会总结、不改写成广告文案、不改变原意，只修正明显错别字、语气词重复、标点和断句，并保留原口播语气。输出结果支持“一键复制”。

## 服务器部署

以下示例假设部署目录为 `/root/douyin-transcript-tool`。

```bash
cd /root/douyin-transcript-tool
git pull
npm install
pm2 restart douyin-transcript
```

### 首次启动

```bash
pm2 start src/server.js --name douyin-transcript
pm2 save
```

查看日志：

```bash
pm2 logs douyin-transcript
```

重启：

```bash
pm2 restart douyin-transcript
```

如果 3001 访问不了，请检查 PM2 状态、服务器防火墙、阿里云安全组是否放行 TCP 3001，或检查 Nginx 反向代理配置。

## 诊断与日志

访问：

```text
http://你的服务器:3001/diagnostics
```

诊断内容包括服务状态、端口、ffmpeg、yt-dlp、yt-dlp 版本、Cookie 文件配置/存在性、ASR/OPENAI 配置域名、模型、目录可写性、最近一次链接下载错误摘要和最近一次 ASR 错误摘要。

后端关键步骤会写入 PM2 logs，包括：提取链接、短链解析、yt-dlp 下载、ffmpeg 音频提取、ASR 转写、文本纠错、CSV 导出相关前端日志，以及错误的 `errorType` / `errorMessage`。日志不会打印 API Key、Cookie 内容或完整敏感路径。

## 常见问题

- `Fresh cookies are needed`：抖音需要登录 Cookie，请配置 `DOUYIN_COOKIES_FILE=/root/douyin-cookies.txt`。
- ASR 上游负载饱和：ASR 服务繁忙或模型不稳定，请稍后重试，或更换 `ASR_MODEL` / `ASR_BASE_URL`。
- ASR 模型不支持：当前模型可能不支持音频转写，请更换支持 `/audio/transcriptions` 的模型。
- 鉴权失败：`ASR_API_KEY` 无效或没有权限。
- 接口不存在：`ASR_BASE_URL` 可能不是 OpenAI 兼容音频转写接口。
- 文件过大：请上传更短的视频或先压缩音频。
- 超时：语音识别超时，请稍后重试或上传更短文件。
- yt-dlp 找不到：安装 yt-dlp：`python3 -m pip install -U yt-dlp`。
- ffmpeg 找不到：安装 ffmpeg：`apt install -y ffmpeg`。
- 3001 访问不了：检查 PM2、服务器防火墙和阿里云安全组。

## API 概览

所有接口在配置 `APP_PASSWORD` 后都需要请求头：

```text
x-app-password: <APP_PASSWORD>
```

- `GET /api/auth/status`：查询是否启用密码保护。
- `POST /api/auth/login`：校验密码。
- `GET /api/diagnostics`：环境诊断数据。
- `POST /api/transcribe/single`：单条分享文本/链接识别。
- `POST /api/transcribe/batch`：批量分享文本/链接识别。
- `POST /api/transcript/polish`：手动粘贴字幕/口播文本整理。
- `POST /api/upload/links`：上传 `txt/csv/xlsx` 并处理链接。
- `POST /api/upload/media`：上传 `mp4/mp3/wav/m4a` 兜底识别。
- `POST /api/links/extract`：仅提取文本中的抖音链接。

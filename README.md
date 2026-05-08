# 抖音视频口播文案提取工具

部署端口默认 `3001`。本工具当前先收敛为三条使用路径：

1. **直接粘抖音链接 / 短链 / 完整分享口令**：主流程只走第三方解析 API；API 返回可用 mp4 视频地址后下载并转写，不再兜底到 `yt-dlp` 或 Playwright。
2. **上传视频/音频**：不依赖抖音链接，是当前最稳的兜底路径。
3. **手动粘贴字幕/口播文本整理**：不依赖 ASR，适合已有字幕文本或人工粗稿。

后端流程是：解析抖音链接 → 下载视频到 `tmp/downloads` → 复用上传识别链路提取音频 → 调用 OpenAI 兼容 ASR → 调用文本模型做轻度纠错和断句。文本整理要求是忠于原视频口播，不总结、不扩写、不改写广告文案。

## 环境变量

```env
PORT=3001
APP_PASSWORD=your-password

OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

ASR_PROVIDER=openai-compatible
ASR_API_KEY=sk-xxxx
ASR_BASE_URL=https://api.openai.com/v1
ASR_MODEL=gpt-4o-mini-transcribe

FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe

DOUYIN_COOKIES_FILE=/root/douyin-cookies.txt
DOUYIN_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36
DOUYIN_REFERER=https://www.douyin.com/
DOUYIN_YTDLP_RETRIES=3

DOUYIN_RESOLVER_PROVIDER=api
DOUYIN_RESOLVER_API_URL=https://your-parser-api.com/parse
DOUYIN_RESOLVER_API_KEY=你的解析接口key
DOUYIN_RESOLVER_METHOD=POST
DOUYIN_RESOLVER_URL_FIELD=url
DOUYIN_RESOLVER_RESPONSE_VIDEO_FIELD=data.play_url
```

说明：

- `APP_PASSWORD`：可选。配置后页面和 API 都需要密码。
- `OPENAI_*`：用于文本模型轻度纠错、断句，以及手动粘贴字幕整理。
- `ASR_PROVIDER`：支持 `openai-compatible` 和 `disabled`。
- `ASR_API_KEY` / `ASR_BASE_URL` / `ASR_MODEL`：用于 OpenAI 兼容 `/audio/transcriptions` 接口。未单独配置时会默认复用 `OPENAI_*`。
- `FFMPEG_PATH` / `FFPROBE_PATH`：默认固定为 `/usr/bin/ffmpeg` 和 `/usr/bin/ffprobe`。
- `DOUYIN_COOKIES_FILE`：当前主流程不再使用，仅保留历史配置兼容。Cookie 文件不要提交、不要截图、不要公开。
- `DOUYIN_RESOLVER_*`：第三方抖音解析 API 通道使用。不要把解析 API Key 写进代码，不要提交 `.env`。

## 方式一：直接粘抖音链接（推荐配置第三方解析 API）

输入框支持以下任意内容：

```text
https://www.douyin.com/video/7634809294119041935
```

```text
https://v.douyin.com/xxxx/
```

```text
4.64 01/22 dAg:/ E@h.bN 今天来学# 夏天的风... https://v.douyin.com/xxxx/ 复制此链接，打开Dou音搜索，直接观看视频！
```

### 单条链接解析顺序

1. **第三方抖音解析 API（唯一主链路）**
   - 当 `DOUYIN_RESOLVER_PROVIDER=api` 且 `DOUYIN_RESOLVER_API_URL` 已配置时启用。
   - 支持 `GET` / `POST`。
   - 默认用 `url` 字段传抖音链接，可通过 `DOUYIN_RESOLVER_URL_FIELD` 修改。
   - 配置 `DOUYIN_RESOLVER_API_KEY` 后，会以 `Authorization: Bearer <key>` 和 `x-api-key: <key>` 发送给解析服务。
   - 如果配置 `DOUYIN_RESOLVER_RESPONSE_VIDEO_FIELD=data.play_url`，会按该字段读取视频直链。
   - 未配置返回字段时，会自动尝试：`video_url`、`videoUrl`、`play_url`、`playUrl`、`download_url`、`downloadUrl`、`url`、`data.video_url`、`data.play_url`、`data.url`。
2. **明确失败提示**
   - 如果解析 API 没有返回可用视频地址，页面提示：`解析 API 未返回可用视频地址，请检查解析 API 配置或更换解析服务`。
   - 当前主流程不会继续兜底到 `yt-dlp` 或 Playwright，避免 Cookie 风控问题影响单条链接闭环。

## 方式二：上传视频/音频（当前最稳）

支持：

- `mp4`
- `mp3`
- `wav`
- `m4a`

上传后会自动提取音频并调用 ASR，输出可复制口播文案。该路径不依赖抖音链接，也不依赖第三方解析 API 或 Cookie。

## 方式三：手动粘贴字幕整理

粘贴抖音字幕、剪映识别字幕、第三方转写文本或人工粗稿，点击“整理文案”。该功能只依赖 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`，不依赖 ASR 和抖音解析。

## 批量处理和导出

- 支持单条链接识别。
- 支持批量粘贴多个链接或完整分享口令。
- 支持上传 `txt` / `csv` / `xlsx` 自动读取链接。
- 单条失败不会影响其他条。
- 每条结果包含：视频链接、解析通道（`api` / `failed` / `upload`）、识别状态、口播文案、错误原因。
- 支持一键复制单条口播文案。
- 支持导出 UTF-8 BOM CSV。

## 服务器依赖

```bash
npm install
apt install -y ffmpeg
```

单条链接主流程不再依赖 yt-dlp / Playwright；只需确保 `/usr/bin/ffmpeg -version` 和 `/usr/bin/ffprobe -version` 正常。

## 服务器更新命令

以下示例假设部署目录为 `/root/douyin-transcript-tool`：

```bash
cd /root/douyin-transcript-tool
git pull
npm install
pm2 restart douyin-transcript --update-env
pm2 save
```

如果 `git pull` 失败，可以继续使用 zip 覆盖更新方案：先在本地下载最新代码 zip，上传服务器后覆盖项目目录，再执行 `npm install` 和 PM2 重启命令。覆盖前请备份服务器 `.env`、Cookie 文件和用户上传目录；不要把 `.env` 或 Cookie 放进代码仓库。

### 首次启动

```bash
pm2 start src/server.js --name douyin-transcript
pm2 save
```

查看日志：

```bash
pm2 logs douyin-transcript
```

PM2 重启：

```bash
pm2 restart douyin-transcript --update-env
pm2 save
```

## 诊断与日志

访问：

```text
http://你的服务器:3001/diagnostics
```

诊断页会显示：

- 当前解析通道配置：`DOUYIN_RESOLVER_PROVIDER`、`DOUYIN_RESOLVER_API_URL` 是否配置（只显示域名）、`DOUYIN_RESOLVER_METHOD`。
- yt-dlp 是否安装和版本。
- ffmpeg 是否安装和路径。
- Playwright 是否安装。
- Chromium 是否可用。
- `DOUYIN_COOKIES_FILE` 是否配置和文件是否存在。
- 最近一次链接解析：输入摘要、提取链接、短链最终链接、API/yt-dlp/Playwright 是否成功、最终失败原因。
- 最近一次 ASR 错误摘要。

诊断页和 PM2 日志不会展示 API Key，不会展示 Cookie 内容。

## 如何测试完整链路

1. 配置 `.env` 中的 `ASR_*` 和 `OPENAI_*`。
2. 如需直接粘链接，配置第三方解析 API：

   ```env
   DOUYIN_RESOLVER_PROVIDER=api
   DOUYIN_RESOLVER_API_URL=https://your-parser-api.com/parse
   DOUYIN_RESOLVER_API_KEY=你的解析接口key
   DOUYIN_RESOLVER_METHOD=POST
   DOUYIN_RESOLVER_URL_FIELD=url
   DOUYIN_RESOLVER_RESPONSE_VIDEO_FIELD=data.play_url
   ```

3. 安装依赖并重启：

   ```bash
   npm install
   npx playwright install chromium
   pm2 restart douyin-transcript --update-env
   ```

4. 打开首页，粘贴标准抖音链接、短链或完整分享口令，点击“提取口播文案”。
5. 确认结果区显示解析通道、识别状态和口播文案。
6. 上传一个 `mp4` 或 `mp3`，确认上传识别仍可用。
7. 粘贴已有字幕文本，确认手动整理仍可用。
8. 打开 `/diagnostics`，确认最近一次链接解析链路和最近一次 ASR 错误摘要正常显示且不泄露密钥。

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

# douyin-transcript-tool

抖音视频口播文案提取工具 MVP。该工具是独立的 Node.js + Express 网页应用，默认端口 `3001`，后续服务器路径建议为 `/root/douyin-transcript-tool`，PM2 进程名为 `douyin-transcript`。

> 重要说明：抖音存在反爬、短链跳转、登录限制、视频权限等情况。本工具会尽量解析链接并调用 `yt-dlp` 下载视频，但不能保证所有抖音链接都成功。失败时会返回明确错误原因，并提供上传视频/音频兜底识别能力。

## 功能

- 单个链接识别：支持抖音长链、`v.douyin.com` 短链、完整抖音分享口令文本。
- 批量链接识别：支持每行一个链接或每行一段分享文案，单条失败不影响其他条目。
- 上传文件读取链接：支持 `txt` / `csv` / `xlsx`，自动从文件内容中提取抖音链接。
- 上传视频/音频兜底：支持 `mp4` / `mp3` / `wav`，直接提取音频并调用 ASR。
- 结果表格：展示序号、视频链接、识别状态、口播文案、错误原因。
- 复制与导出：成功结果可复制文案，支持导出带 UTF-8 BOM 的 CSV，避免 Excel 中文乱码。
- 访问密码：配置 `APP_PASSWORD` 后页面和所有后端接口都会校验密码；未配置则本地开发默认不启用访问保护。

## 环境要求

- Node.js 18+
- npm
- ffmpeg：用于从视频中提取音频
- yt-dlp：用于尝试下载抖音视频

### Ubuntu / 阿里云安装系统依赖

```bash
apt update
apt install -y ffmpeg python3 python3-pip
python3 -m pip install -U yt-dlp
```

如果服务器限制了系统级 pip，可使用：

```bash
apt install -y pipx
pipx install yt-dlp
pipx ensurepath
```

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

打开：

```text
http://localhost:3001
```

生产模式：

```bash
npm start
```

## .env 配置

请复制 `.env.example` 到 `.env`，不要提交 `.env`。

```env
PORT=3001
APP_PASSWORD=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
ASR_API_KEY=
ASR_BASE_URL=
ASR_MODEL=
```

配置说明：

- `PORT`：服务端口，默认 `3001`。
- `APP_PASSWORD`：访问密码。为空时不启用访问保护；存在时页面和 API 都需要密码。
- `OPENAI_*`：用于对 ASR 原始转写文本做轻度纠错，只修正明显错别字、断句、标点，不总结、不改写。
- `ASR_*`：用于音频转文字。
- 如果 `ASR_*` 未配置，服务会默认复用 `OPENAI_*`。
- 如果 ASR 接口不支持 `/audio/transcriptions` 或没有正确配置，会返回：`ASR接口不可用`、`ASR接口不可用或不支持音频转写` 或具体接口错误。

示例：

```env
PORT=3001
APP_PASSWORD=your-private-password
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
ASR_API_KEY=sk-xxxx
ASR_BASE_URL=https://api.openai.com/v1
ASR_MODEL=whisper-1
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
9.23 ZzG:/ q@e.BT 05/20 和平南路奢派乔氏球房超神！# 张志超台球直播录屏 https://v.douyin.com/bDZ191tTDfg/ 复制此链接，打开Dou音搜索，直接观看视频！
```

点击“提取口播文案”。工具会自动提取抖音链接、跟随短链跳转、尝试下载视频、提取音频、调用 ASR 并轻度纠错。

### 批量粘贴

在“批量链接识别”文本框中每行粘贴一条链接或一段分享文案：

```text
https://www.douyin.com/video/7634809294119041935
标题 #话题 https://v.douyin.com/bDZ191tTDfg/ 复制此链接，打开Dou音搜索
```

点击“批量提取”。每条会独立处理，某条失败不会影响其他链接。

### 上传 txt / csv / xlsx

在“上传 txt / csv / xlsx 读取链接”区域选择文件并点击“上传文件并处理”。文件内容可以是纯链接，也可以是夹杂中文、话题、复制提示的完整分享文案。后端会自动识别：

- `www.douyin.com/video/xxxx`
- `v.douyin.com/xxxx`
- 文本中夹杂中文、话题、复制提示的情况

### 上传视频/音频兜底识别

当链接解析、下载或访问失败时，可在“上传视频/音频兜底”区域上传：

- `mp4`
- `mp3`
- `wav`

上传后会直接进入音频提取 / ASR 识别流程。

### 复制文案与导出 CSV

- 每条成功结果都有“复制文案”按钮。
- 点击“导出 CSV”可导出全部表格结果。
- CSV 文件带 UTF-8 BOM，Excel 打开中文不乱码。
- 文件名格式：`douyin-transcripts-YYYYMMDD-HHmm.csv`。

## 常见错误提示

- `未识别到抖音链接`：输入内容或上传文件中没有匹配到抖音长链/短链。
- `短链解析失败`：`v.douyin.com` 跳转失败，可能网络不可达、短链失效或被限制。
- `视频页面无法访问`：页面不可访问或无法解析视频 ID。
- `视频下载失败`：`yt-dlp` 未安装、下载失败、需要登录、视频不可见或权限受限。
- `音频提取失败`：`ffmpeg` 未安装或输入文件无法提取音轨。
- `ASR接口不可用`：未配置 ASR/OpenAI 环境变量或接口不可访问。
- `文件格式不支持`：上传文件类型不是当前支持的格式。
- `当前视频可能需要登录或不可访问`：抖音反爬、权限或登录限制导致不能稳定抓取。

## 阿里云部署

以下示例假设部署目录为 `/root/douyin-transcript-tool`。

```bash
cd /root
git clone <your-repo-url> douyin-transcript-tool
cd /root/douyin-transcript-tool
npm install --omit=dev
cp .env.example .env
nano .env
```

安装系统依赖：

```bash
apt update
apt install -y ffmpeg python3 python3-pip
python3 -m pip install -U yt-dlp
```

如使用 PM2：

```bash
npm install -g pm2
pm2 start src/server.js --name douyin-transcript
pm2 save
pm2 startup
```

查看日志：

```bash
pm2 logs douyin-transcript
```

重启：

```bash
pm2 restart douyin-transcript
```

如果使用 Nginx 反向代理，可将域名转发到：

```text
http://127.0.0.1:3001
```

## API 概览

所有接口在配置 `APP_PASSWORD` 后都需要请求头：

```text
x-app-password: <APP_PASSWORD>
```

- `GET /api/auth/status`：查询是否启用密码保护。
- `POST /api/auth/login`：校验密码。
- `POST /api/transcribe/single`：单条分享文本/链接识别。
- `POST /api/transcribe/batch`：批量分享文本/链接识别。
- `POST /api/upload/links`：上传 `txt/csv/xlsx` 并处理链接。
- `POST /api/upload/media`：上传 `mp4/mp3/wav` 兜底识别。
- `POST /api/links/extract`：仅提取文本中的抖音链接。

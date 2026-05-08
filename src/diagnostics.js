import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from './config.js';
import { commandExists, inspectFfmpeg, inspectFfprobe } from './media.js';
import { runtimeState } from './runtime-state.js';

const require = createRequire(import.meta.url);

function configured(value) { return Boolean(String(value || '').trim()); }
function safeDomain(url) {
  if (!url) return '';
  try { return new URL(url).host; } catch { return '已配置（无法解析域名）'; }
}
async function fileExists(filePath) {
  if (!filePath) return false;
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
}
async function writableDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  const test = path.join(dir, `.write-test-${process.pid}`);
  try { await fs.writeFile(test, 'ok'); await fs.unlink(test); return true; } catch { return false; }
}
async function playwrightStatus() {
  try {
    const { chromium } = require('playwright');
    let chromiumUsable = false;
    let chromiumError = '';
    try {
      const browser = await chromium.launch({ headless: true });
      chromiumUsable = true;
      await browser.close();
    } catch (error) {
      chromiumError = error.message || 'Chromium 启动失败';
    }
    return { installed: true, chromiumUsable, chromiumError };
  } catch (error) {
    return { installed: false, chromiumUsable: false, chromiumError: error.message || 'Playwright 未安装' };
  }
}

export async function getDiagnostics() {
  const [ffmpeg, ffprobe, ytdlp, cookiesFileExists, uploadsWritable, downloadsWritable, tmpWritable, playwright] = await Promise.all([
    inspectFfmpeg(),
    inspectFfprobe(),
    commandExists('yt-dlp'),
    fileExists(config.douyin.cookiesFile),
    writableDir('uploads'),
    writableDir('downloads'),
    writableDir('tmp'),
    playwrightStatus()
  ]);

  return {
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    port: config.port,
    env: {
      ASR_PROVIDER: process.env.ASR_PROVIDER || config.asr.provider || '',
      OPENAI_MODEL: process.env.OPENAI_MODEL || config.openai.model || '',
      FFMPEG_PATH: process.env.FFMPEG_PATH || '',
      FFPROBE_PATH: process.env.FFPROBE_PATH || ''
    },
    binaries: {
      ffmpeg: { ok: ffmpeg.ok, path: ffmpeg.path, version: ffmpeg.version, rawSummary: ffmpeg.rawSummary },
      ffprobe: { ok: ffprobe.ok, path: ffprobe.path, version: ffprobe.version, rawSummary: ffprobe.rawSummary },
      ytDlp: { ok: ytdlp.ok, path: ytdlp.path, version: ytdlp.version, rawSummary: ytdlp.rawSummary }
    },
    service: { ok: true, timestamp: new Date().toISOString(), port: config.port, node: process.version, cwd: process.cwd() },
    dependencies: {
      ffmpegInstalled: ffmpeg.ok,
      ffmpegPath: ffmpeg.path,
      ffmpegVersion: ffmpeg.version,
      ffprobeInstalled: ffprobe.ok,
      ffprobePath: ffprobe.path,
      ffprobeVersion: ffprobe.version,
      ytDlpInstalled: ytdlp.ok,
      ytDlpVersion: ytdlp.version,
      playwrightInstalled: playwright.installed,
      chromiumUsable: playwright.chromiumUsable,
      chromiumError: playwright.chromiumError
    },
    resolver: {
      provider: config.douyin.resolver.provider || '未配置',
      apiUrlConfigured: configured(config.douyin.resolver.apiUrl),
      apiUrlDomain: safeDomain(config.douyin.resolver.apiUrl),
      method: config.douyin.resolver.method,
      urlField: config.douyin.resolver.urlField,
      responseVideoFieldConfigured: configured(config.douyin.resolver.responseVideoField)
    },
    douyin: { cookiesFileConfigured: configured(config.douyin.cookiesFile), cookiesFileExists },
    asr: { provider: config.asr.provider, baseUrlConfigured: configured(config.asr.baseUrl), baseUrlDomain: safeDomain(config.asr.baseUrl), model: config.asr.model || '' },
    openai: { baseUrlConfigured: configured(config.openai.baseUrl), baseUrlDomain: safeDomain(config.openai.baseUrl), model: config.openai.model || '' },
    writable: { uploads: uploadsWritable, downloads: downloadsWritable, tmp: tmpWritable, tmpDownloads: await writableDir('tmp/downloads') },
    recentErrors: { lastDownloadError: runtimeState.lastDownloadError, lastAsrError: runtimeState.lastAsrError, lastLinkResolve: runtimeState.lastLinkResolve }
  };
}

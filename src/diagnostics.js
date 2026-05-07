import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { commandExists } from './media.js';
import { runtimeState } from './runtime-state.js';

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

export async function getDiagnostics() {
  const [ffmpeg, ytdlp, cookiesFileExists, uploadsWritable, downloadsWritable, tmpWritable] = await Promise.all([
    commandExists('ffmpeg'),
    commandExists('yt-dlp'),
    fileExists(config.douyin.cookiesFile),
    writableDir('uploads'),
    writableDir('downloads'),
    writableDir('tmp')
  ]);

  return {
    service: { ok: true, timestamp: new Date().toISOString(), port: config.port },
    dependencies: { ffmpegInstalled: ffmpeg.installed, ytDlpInstalled: ytdlp.installed, ytDlpVersion: ytdlp.version },
    douyin: { cookiesFileConfigured: configured(config.douyin.cookiesFile), cookiesFileExists },
    asr: { provider: config.asr.provider, baseUrlConfigured: configured(config.asr.baseUrl), baseUrlDomain: safeDomain(config.asr.baseUrl), model: config.asr.model || '' },
    openai: { baseUrlConfigured: configured(config.openai.baseUrl), baseUrlDomain: safeDomain(config.openai.baseUrl), model: config.openai.model || '' },
    writable: { uploads: uploadsWritable, downloads: downloadsWritable, tmp: tmpWritable },
    recentErrors: { lastDownloadError: runtimeState.lastDownloadError, lastAsrError: runtimeState.lastAsrError }
  };
}

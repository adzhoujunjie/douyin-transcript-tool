import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { logStep, summarizeError } from './logger.js';
import { rememberDownloadError } from './runtime-state.js';

const TMP_DIR = path.resolve('tmp/downloads');

export function classifyYtDlpError(message = '') {
  if (/Fresh cookies are needed|cookies|login|not logged in|需要登录|parse JSON failed/i.test(message)) {
    return {
      type: 'douyin_cookie_required',
      userMessage: '服务器直读抖音链接被拒绝，可能是抖音风控或 yt-dlp 解析失效。系统已尝试备用方案，如仍失败请改用上传视频识别，或配置第三方解析 API。'
    };
  }
  if (/ENOENT|not found|spawn yt-dlp/i.test(message)) {
    return { type: 'ytdlp_not_found', userMessage: '视频下载失败：服务器未安装 yt-dlp。' };
  }
  return { type: 'download_failed', userMessage: `视频下载失败：${summarizeError(message)}` };
}

export async function runCommand(command, args, options = {}) {
  const { timeoutMs = 10 * 60 * 1000 } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr || error.message, exitCode: 127, error, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : (code ?? 0), timedOut });
    });
  });
}

async function existingCookiesFile(cookiesFile) {
  if (!cookiesFile) return '';
  try {
    const stat = await fs.stat(cookiesFile);
    return stat.isFile() ? cookiesFile : '';
  } catch {
    return '';
  }
}

export async function runYtDlpDownload(url, { cookiesFile = config.douyin.cookiesFile, userAgent = config.douyin.userAgent, referer = config.douyin.referer, retries = config.douyin.retries } = {}) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const outputTemplate = path.join(TMP_DIR, `${randomUUID()}.%(ext)s`);
  const args = [
    '--no-playlist',
    '--max-filesize', '500m',
    '--retries', String(retries || 3),
    '--fragment-retries', String(retries || 3),
    '--no-check-certificate',
    '--user-agent', userAgent,
    '--referer', referer,
    '-o', outputTemplate
  ];

  const validCookiesFile = await existingCookiesFile(cookiesFile);
  if (validCookiesFile) args.push('--cookies', validCookiesFile);
  args.push(url);

  logStep('yt-dlp 下载开始', 'start', { hasCookiesFile: Boolean(validCookiesFile), retries, url });
  const result = await runCommand('yt-dlp', args, { timeoutMs: 15 * 60 * 1000 });
  return { ...result, outputTemplate, usedCookiesFile: Boolean(validCookiesFile) };
}

export async function downloadVideo(url) {
  const result = await runYtDlpDownload(url);
  if (result.exitCode !== 0) {
    const raw = result.stderr || result.stdout || `命令退出码 ${result.exitCode}`;
    const classified = classifyYtDlpError(raw);
    rememberDownloadError({ errorType: classified.type, errorMessage: classified.userMessage, rawSummary: summarizeError(raw), exitCode: result.exitCode });
    logStep('yt-dlp 下载失败', 'fail', { errorType: classified.type, errorMessage: classified.userMessage, rawSummary: raw, exitCode: result.exitCode, usedCookiesFile: result.usedCookiesFile });
    throw new Error(classified.userMessage);
  }

  const prefix = result.outputTemplate.replace('%(ext)s', '');
  const files = await fs.readdir(TMP_DIR);
  const downloaded = files.find((file) => path.join(TMP_DIR, file).startsWith(prefix));
  if (!downloaded) {
    const classified = { type: 'download_output_missing', userMessage: '视频下载失败：未找到下载后的视频文件，当前视频可能需要登录或不可访问。' };
    rememberDownloadError({ errorType: classified.type, errorMessage: classified.userMessage, rawSummary: 'downloaded file not found', exitCode: 0 });
    logStep('yt-dlp 下载失败', 'fail', { errorType: classified.type, errorMessage: classified.userMessage });
    throw new Error(classified.userMessage);
  }
  const filePath = path.join(TMP_DIR, downloaded);
  logStep('yt-dlp 下载成功', 'success', { usedCookiesFile: result.usedCookiesFile, fileExt: path.extname(filePath) });
  return filePath;
}

export async function extractAudio(inputPath) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const ext = path.extname(inputPath).toLowerCase();
  if (['.mp3', '.wav', '.m4a'].includes(ext)) {
    logStep('ffmpeg 音频提取成功', 'success', { skipped: true, inputExt: ext });
    return { audioPath: inputPath, generated: false };
  }

  const audioPath = path.join(TMP_DIR, `${randomUUID()}.mp3`);
  logStep('ffmpeg 音频提取开始', 'start', { inputExt: ext });
  const result = await runCommand('ffmpeg', ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', audioPath]);
  if (result.exitCode !== 0 || !fsSync.existsSync(audioPath)) {
    const message = /ENOENT|not found|spawn ffmpeg/i.test(result.stderr) ? '音频提取失败：服务器未安装 ffmpeg。' : `音频提取失败：${summarizeError(result.stderr || `命令退出码 ${result.exitCode}`)}`;
    logStep('ffmpeg 音频提取失败', 'fail', { errorType: 'ffmpeg_failed', errorMessage: message, rawSummary: result.stderr, exitCode: result.exitCode });
    throw new Error(message);
  }

  logStep('ffmpeg 音频提取成功', 'success', { outputExt: '.mp3' });
  return { audioPath, generated: true };
}

export async function commandExists(command, versionArgs = ['--version']) {
  const result = await runCommand(command, versionArgs, { timeoutMs: 8000 });
  return { installed: result.exitCode === 0, version: (result.stdout || result.stderr || '').split('\n')[0]?.trim() || '' };
}

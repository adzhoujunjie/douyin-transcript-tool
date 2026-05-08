import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { logStep, summarizeError } from './logger.js';
import { rememberDownloadError } from './runtime-state.js';

const TMP_DIR = path.resolve('tmp/downloads');
const DEFAULT_FFMPEG_PATH = '/usr/bin/ffmpeg';
const DEFAULT_FFPROBE_PATH = '/usr/bin/ffprobe';

function firstLine(value = '') {
  return String(value || '').split('\n')[0]?.trim() || '';
}

function truncate(value = '', max = 1000) {
  return String(value || '').slice(0, max);
}

async function isExecutable(filePath) {
  try {
    await fs.access(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function preferredBinaryPath(envPath, defaultPath, fallbackName) {
  const configured = String(envPath || '').trim();
  if (configured) return configured;
  if (await isExecutable(defaultPath)) return defaultPath;
  return fallbackName;
}

export async function ffmpegPath() {
  return preferredBinaryPath(process.env.FFMPEG_PATH, DEFAULT_FFMPEG_PATH, 'ffmpeg');
}

export async function ffprobePath() {
  return preferredBinaryPath(process.env.FFPROBE_PATH, DEFAULT_FFPROBE_PATH, 'ffprobe');
}

export async function inspectBinary({ name, envPath = '', defaultPath = '', versionMarker = '' }) {
  const pathToUse = await preferredBinaryPath(envPath, defaultPath, name);
  const versionResult = await runCommand(pathToUse, ['-version'], { timeoutMs: 8000 });
  const raw = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`;
  const hasVersion = raw.toLowerCase().includes(versionMarker.toLowerCase());
  if (hasVersion) {
    return { ok: true, installed: true, path: pathToUse, version: firstLine(raw), rawSummary: summarizeError(raw), exitCode: versionResult.exitCode };
  }

  const commandLookup = await runCommand('/bin/sh', ['-lc', `command -v ${name}`], { timeoutMs: 8000 });
  const lookupPath = commandLookup.stdout.trim();
  const lookupOk = commandLookup.exitCode === 0 && Boolean(lookupPath);
  return {
    ok: lookupOk,
    installed: lookupOk,
    path: lookupOk ? lookupPath : pathToUse,
    version: lookupOk ? lookupPath : firstLine(raw),
    rawSummary: summarizeError(raw || commandLookup.stderr),
    exitCode: versionResult.exitCode
  };
}

export async function inspectFfmpeg() {
  return inspectBinary({ name: 'ffmpeg', envPath: process.env.FFMPEG_PATH, defaultPath: DEFAULT_FFMPEG_PATH, versionMarker: 'ffmpeg version' });
}

export async function inspectFfprobe() {
  return inspectBinary({ name: 'ffprobe', envPath: process.env.FFPROBE_PATH, defaultPath: DEFAULT_FFPROBE_PATH, versionMarker: 'ffprobe version' });
}

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
  const { timeoutMs = 10 * 60 * 1000, shell = false } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell });
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
  const startedAt = Date.now();
  const fail = (errorType, errorMessage, extra = {}) => {
    const error = new Error(errorMessage);
    error.stage = 'extract';
    error.channel = 'ffmpeg';
    error.errorType = errorType;
    error.errorMessage = errorMessage;
    error.diagnostics = { inputPath, ...extra };
    logStep('extract_audio_failed', 'fail', { stage: 'extract', channel: 'ffmpeg', errorType, errorMessage, inputPath, durationMs: Date.now() - startedAt, ...extra });
    return error;
  };

  let inputStat;
  try {
    inputStat = await fs.stat(inputPath);
  } catch {
    throw fail('input_video_missing', '视频文件不存在或下载失败', { fileExists: false });
  }
  if (!inputStat.isFile() || inputStat.size <= 0) {
    throw fail('input_video_missing', '视频文件不存在或下载失败', { fileExists: inputStat.isFile(), inputFileSize: inputStat.size });
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (['.mp3', '.wav', '.m4a'].includes(ext)) {
    logStep('extract_audio_success', 'success', { stage: 'extract', channel: 'ffmpeg', skipped: true, inputPath, inputExt: ext, inputFileSize: inputStat.size, durationMs: Date.now() - startedAt });
    return { audioPath: inputPath, generated: false };
  }

  const binary = await inspectFfmpeg();
  if (!binary.ok) {
    throw fail('ffmpeg_not_found', '音频提取失败：服务器未安装或 ffmpeg 路径不可用。', { ffmpegPath: binary.path, rawSummary: binary.rawSummary, exitCode: binary.exitCode });
  }

  const audioPath = path.join(TMP_DIR, `${randomUUID()}.mp3`);
  logStep('extract_audio_start', 'start', { stage: 'extract', channel: 'ffmpeg', inputPath, outputPath: audioPath, inputExt: ext, inputFileSize: inputStat.size, ffmpegPath: binary.path });
  const result = await runCommand(binary.path, ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
  const stderrPreview = truncate(result.stderr || result.stdout || '', 1000);
  if (result.exitCode !== 0) {
    throw fail('ffmpeg_extract_failed', 'ffmpeg 已安装，但音频提取失败，请查看日志', { ffmpegPath: binary.path, outputPath: audioPath, inputFileSize: inputStat.size, stderr: stderrPreview, exitCode: result.exitCode });
  }

  let outputStat;
  try {
    outputStat = await fs.stat(audioPath);
  } catch {
    throw fail('output_audio_empty', '音频文件生成失败或为空', { ffmpegPath: binary.path, outputPath: audioPath, inputFileSize: inputStat.size, stderr: stderrPreview, exitCode: result.exitCode });
  }
  if (!outputStat.isFile() || outputStat.size <= 0) {
    throw fail('output_audio_empty', '音频文件生成失败或为空', { ffmpegPath: binary.path, outputPath: audioPath, inputFileSize: inputStat.size, outputFileSize: outputStat.size, stderr: stderrPreview, exitCode: result.exitCode });
  }

  logStep('extract_audio_success', 'success', { stage: 'extract', channel: 'ffmpeg', inputPath, outputPath: audioPath, inputFileSize: inputStat.size, outputFileSize: outputStat.size, durationMs: Date.now() - startedAt });
  return { audioPath, generated: true };
}

export async function commandExists(command, versionArgs = ['--version']) {
  const lookup = await runCommand('/bin/sh', ['-lc', `command -v ${command}`], { timeoutMs: 8000 });
  const pathFound = lookup.exitCode === 0 ? lookup.stdout.trim() : '';
  const commandToRun = pathFound || command;
  const result = await runCommand(commandToRun, versionArgs, { timeoutMs: 8000 });
  const raw = result.stdout || result.stderr || '';
  const ok = result.exitCode === 0 || Boolean(pathFound);
  return { installed: ok, ok, path: pathFound || command, version: firstLine(raw) || pathFound, rawSummary: summarizeError(raw || lookup.stderr), exitCode: result.exitCode };
}

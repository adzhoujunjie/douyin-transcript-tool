import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { config } from './config.js';
import { extractDouyinLinks, isShortLink, normalizeUrl, resolveDouyinUrl } from './link-utils.js';
import { classifyYtDlpError, runYtDlpDownload } from './media.js';
import { logStep, summarizeError } from './logger.js';
import { rememberDownloadError, rememberLinkResolve } from './runtime-state.js';

const require = createRequire(import.meta.url);

const DOWNLOAD_DIR = path.resolve('tmp/downloads');
const FALLBACK_FAILED_MESSAGE = '当前链接无法由服务器直接解析，可能是抖音风控或解析接口未配置。请配置第三方解析 API，或下载视频后上传识别。';
const FRESH_COOKIE_MESSAGE = '服务器直读抖音链接被拒绝，可能是抖音风控或 yt-dlp 解析失效。系统已尝试备用方案，如仍失败请改用上传视频识别，或配置第三方解析 API。';
const AUTO_VIDEO_FIELDS = ['video_url', 'videoUrl', 'play_url', 'playUrl', 'download_url', 'downloadUrl', 'url', 'data.video_url', 'data.play_url', 'data.url'];
const VIDEO_RESOURCE_REGEX = /(?:mime_type=video|mime_type=video_mp4|\.mp4(?:\?|$)|playwm|playurl|video_id|aweme|douyinpic|bytecdn|ixigua|snssdk)/i;
const CONTENT_TYPE_EXT = new Map([
  ['video/mp4', '.mp4'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/wav', '.wav']
]);

function createAttemptDiagnostics(channel, success = false, detail = '', extra = {}) {
  return { channel, success, stage: 'resolve', detail: summarizeError(detail || ''), ...extra };
}

function rememberAttemptError(diagnostics, channel, errorType, errorMessage, extra = {}) {
  const entry = { stage: 'resolve', channel, errorType, errorMessage: summarizeError(errorMessage), ...extra };
  diagnostics.errors.push(entry);
  diagnostics[channel === 'yt-dlp' ? 'ytdlp' : channel] = createAttemptDiagnostics(channel, false, errorMessage, entry);
  return entry;
}

function topLevelFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, 80);
}

function getByPath(object, fieldPath = '') {
  if (!fieldPath) return undefined;
  return fieldPath.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

function findUrlInValue(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? normalizeUrl(match[0]) : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlInValue(item);
      if (found) return found;
    }
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findUrlInValue(item);
      if (found) return found;
    }
  }
  return '';
}

function extractVideoUrlFromResponse(data) {
  if (!data || typeof data !== 'object') return findUrlInValue(data);
  const configuredField = config.douyin.resolver.responseVideoField;
  if (configuredField) {
    const configuredValue = getByPath(data, configuredField);
    const configuredUrl = findUrlInValue(configuredValue);
    if (configuredUrl) return configuredUrl;
  }
  for (const field of AUTO_VIDEO_FIELDS) {
    const value = getByPath(data, field);
    const url = findUrlInValue(value);
    if (url) return url;
  }
  return findUrlInValue(data);
}

function guessExtension({ url, contentType }) {
  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (CONTENT_TYPE_EXT.has(normalizedType)) return CONTENT_TYPE_EXT.get(normalizedType);
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(mp4|mp3|wav|m4a|mov|webm)$/i.test(ext)) return ext;
  } catch { /* ignore invalid URL while guessing extension */ }
  return '.mp4';
}

export async function downloadVideoUrl(videoUrl, channel = 'api') {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  logStep('download_start', 'start', { stage: 'download', channel, url: videoUrl });
  try {
    const response = await fetch(videoUrl, {
      headers: {
        'user-agent': config.douyin.userAgent,
        referer: config.douyin.referer
      },
      signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const ext = guessExtension({ url: videoUrl, contentType: response.headers.get('content-type') });
    const filePath = path.join(DOWNLOAD_DIR, `${randomUUID()}${ext}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
    const stat = await fs.stat(filePath);
    logStep('download_success', 'success', { stage: 'download', channel, filePath, fileExt: ext, fileSize: stat.size });
    return filePath;
  } catch (error) {
    const message = error.name === 'AbortError' ? '视频直链下载超时。' : `视频直链下载失败：${summarizeError(error.message)}`;
    logStep('download_failed', 'fail', { stage: 'download', channel, errorType: 'direct_video_download_failed', errorMessage: message });
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

async function tryApiResolver(finalUrl, diagnostics) {
  const resolver = config.douyin.resolver;
  if (resolver.provider !== 'api' || !resolver.apiUrl) {
    rememberAttemptError(diagnostics, 'api', 'api_not_configured', '未配置 DOUYIN_RESOLVER_PROVIDER=api 或 DOUYIN_RESOLVER_API_URL');
    return null;
  }

  const method = resolver.method === 'GET' ? 'GET' : 'POST';
  const field = resolver.urlField || 'url';
  const headers = { accept: 'application/json' };
  if (resolver.apiKey) {
    headers.authorization = `Bearer ${resolver.apiKey}`;
    headers['x-api-key'] = resolver.apiKey;
  }

  let requestUrl = resolver.apiUrl;
  const options = { method, headers };
  if (method === 'GET') {
    const parsed = new URL(requestUrl);
    parsed.searchParams.set(field, finalUrl);
    requestUrl = parsed.toString();
  } else {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify({ [field]: finalUrl });
  }

  logStep('resolve_start', 'start', { stage: 'resolve', channel: 'api', method, apiDomain: new URL(resolver.apiUrl).host, urlField: field, responseVideoFieldConfigured: Boolean(resolver.responseVideoField) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60 * 1000);
  try {
    const response = await fetch(requestUrl, { ...options, signal: controller.signal });
    const text = await response.text();
    const rawTextPreview = text.slice(0, 500);
    const contentType = response.headers.get('content-type') || '';
    logStep('第三方解析 API 原始响应预览', 'info', { stage: 'resolve', channel: 'api', status: response.status, contentType, rawTextPreview });

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const message = '解析接口返回非 JSON 内容';
      rememberAttemptError(diagnostics, 'api', 'api_invalid_response', message, { status: response.status, contentType, rawTextPreview });
      logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'api', errorType: 'api_invalid_response', errorMessage: message, status: response.status, contentType, rawTextPreview });
      return null;
    }

    if (!response.ok) {
      const message = `解析接口 HTTP ${response.status}`;
      rememberAttemptError(diagnostics, 'api', 'api_http_error', message, { status: response.status, contentType, rawTextPreview, fields: topLevelFields(data) });
      logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'api', errorType: 'api_http_error', errorMessage: message, status: response.status, contentType, rawTextPreview });
      return null;
    }

    const videoUrl = extractVideoUrlFromResponse(data);
    if (!videoUrl) {
      const fields = topLevelFields(data);
      const message = '解析接口未返回可用的视频下载地址';
      rememberAttemptError(diagnostics, 'api', 'api_resolver_failed', message, { status: response.status, contentType, rawTextPreview, fields });
      logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'api', errorType: 'api_resolver_failed', errorMessage: message, fields, status: response.status, contentType });
      return null;
    }

    diagnostics.api = createAttemptDiagnostics('api', true, '第三方解析 API 成功返回视频地址');
    logStep('resolve_success', 'success', { stage: 'resolve', channel: 'api', videoUrl });
    const filePath = await downloadVideoUrl(videoUrl, 'api');
    return { channel: 'api', filePath, videoUrl };
  } catch (error) {
    const errorType = error.name === 'AbortError' ? 'api_timeout' : 'api_resolver_failed';
    const message = error.name === 'AbortError' ? '解析接口请求超时' : error.message;
    rememberAttemptError(diagnostics, 'api', errorType, message);
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'api', errorType, errorMessage: message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function findDownloadedFile(outputTemplate) {
  const prefix = outputTemplate.replace('%(ext)s', '');
  const dir = path.dirname(outputTemplate);
  const files = await fs.readdir(dir);
  const downloaded = files.find((file) => path.join(dir, file).startsWith(prefix));
  return downloaded ? path.join(dir, downloaded) : '';
}

async function tryYtDlp(finalUrl, diagnostics) {
  logStep('resolve_start', 'start', { stage: 'resolve', channel: 'yt-dlp', url: finalUrl });
  const result = await runYtDlpDownload(finalUrl);
  if (result.exitCode !== 0) {
    const raw = result.stderr || result.stdout || `命令退出码 ${result.exitCode}`;
    const classified = classifyYtDlpError(raw);
    const userMessage = classified.type === 'douyin_cookie_required' ? FRESH_COOKIE_MESSAGE : classified.userMessage;
    rememberAttemptError(diagnostics, 'yt-dlp', classified.type, userMessage, { stderr: summarizeError(raw), exitCode: result.exitCode, usedCookiesFile: result.usedCookiesFile });
    rememberDownloadError({ errorType: classified.type, errorMessage: userMessage, rawSummary: summarizeError(raw), exitCode: result.exitCode });
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'yt-dlp', errorType: classified.type, errorMessage: userMessage, stderr: String(raw).slice(0, 1000), exitCode: result.exitCode, usedCookiesFile: result.usedCookiesFile });
    return null;
  }

  const filePath = await findDownloadedFile(result.outputTemplate);
  if (!filePath) {
    const message = '视频下载失败：未找到下载后的视频文件，当前视频可能需要登录或不可访问。';
    rememberAttemptError(diagnostics, 'yt-dlp', 'download_output_missing', message);
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'yt-dlp', errorType: 'download_output_missing', errorMessage: message });
    return null;
  }
  diagnostics.ytdlp = createAttemptDiagnostics('yt-dlp', true, 'yt-dlp 下载成功');
  logStep('resolve_success', 'success', { stage: 'resolve', channel: 'yt-dlp', usedCookiesFile: result.usedCookiesFile, fileExt: path.extname(filePath) });
  return { channel: 'yt-dlp', filePath };
}

async function tryPlaywright(finalUrl, diagnostics) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    rememberAttemptError(diagnostics, 'playwright', 'playwright_not_installed', 'Playwright 未安装', { rawSummary: summarizeError(error.message) });
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'playwright', errorType: 'playwright_not_installed', errorMessage: error.message });
    return null;
  }

  let browser;
  let context;
  let page;
  const captured = new Set();
  const pageInfo = {};
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ userAgent: config.douyin.userAgent });
    page = await context.newPage();
    page.on('request', (request) => {
      const url = request.url();
      if (VIDEO_RESOURCE_REGEX.test(url)) captured.add(url);
    });
    page.on('response', (response) => {
      const url = response.url();
      const type = response.headers()['content-type'] || '';
      if (/video|octet-stream/i.test(type) || VIDEO_RESOURCE_REGEX.test(url)) captured.add(url);
    });
    logStep('resolve_start', 'start', { stage: 'resolve', channel: 'playwright', url: finalUrl });
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(6000);
    pageInfo.title = await page.title().catch(() => '');
    pageInfo.textSummary = summarizeError(await page.locator('body').innerText({ timeout: 3000 }).catch(() => ''));
    const videoSrcs = await page.locator('video').evaluateAll((videos) => videos.map((video) => video.currentSrc || video.src).filter(Boolean)).catch(() => []);
    for (const src of videoSrcs) captured.add(src);

    const videoUrl = [...captured].find((url) => /^https?:\/\//i.test(url) && !/\.js(?:\?|$)|\.css(?:\?|$)|\.png(?:\?|$)|\.jpg(?:\?|$)/i.test(url));
    if (!videoUrl) throw new Error(`未捕获到可下载视频资源。页面标题：${pageInfo.title || '空'}`);
    const filePath = await downloadVideoUrl(videoUrl, 'playwright');
    diagnostics.playwright = createAttemptDiagnostics('playwright', true, `捕获视频资源成功；页面标题：${pageInfo.title || '空'}`);
    logStep('resolve_success', 'success', { stage: 'resolve', channel: 'playwright', videoUrl, pageInfo });
    return { channel: 'playwright', filePath, videoUrl, pageInfo };
  } catch (error) {
    rememberAttemptError(diagnostics, 'playwright', 'playwright_resolver_failed', error.message, { pageInfo });
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: 'playwright', errorType: 'playwright_resolver_failed', errorMessage: error.message, pageInfo });
    return null;
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function resolveDouyinVideo(inputText) {
  const diagnostics = {
    inputText: summarizeError(inputText),
    extractedUrl: '',
    finalUrl: '',
    api: createAttemptDiagnostics('api'),
    ytdlp: createAttemptDiagnostics('yt-dlp'),
    playwright: createAttemptDiagnostics('playwright'),
    errors: [],
    finalFailureReason: ''
  };

  try {
    const links = extractDouyinLinks(inputText);
    if (!links.length) throw new Error('未识别到抖音链接，请粘贴抖音链接、短链或完整分享口令。');
    const extractedUrl = normalizeUrl(links[0]);
    diagnostics.extractedUrl = extractedUrl;

    logStep('统一抖音解析开始', 'start', { extractedUrl, isShortLink: isShortLink(extractedUrl) });
    const resolved = await resolveDouyinUrl(extractedUrl);
    diagnostics.finalUrl = resolved.finalUrl;
    logStep('短链解析完成', 'success', { isShortLink: resolved.originalUrl !== resolved.finalUrl, finalUrl: resolved.finalUrl, videoId: resolved.videoId || '' });

    const apiResult = await tryApiResolver(resolved.finalUrl, diagnostics);
    if (apiResult) {
      rememberLinkResolve({ ...diagnostics, apiSuccess: true, ytdlpSuccess: false, playwrightSuccess: false, finalFailureReason: '' });
      return { ...apiResult, originalUrl: extractedUrl, finalUrl: resolved.finalUrl, diagnostics };
    }

    const ytdlpResult = await tryYtDlp(resolved.finalUrl, diagnostics);
    if (ytdlpResult) {
      rememberLinkResolve({ ...diagnostics, apiSuccess: false, ytdlpSuccess: true, playwrightSuccess: false, finalFailureReason: '' });
      return { ...ytdlpResult, originalUrl: extractedUrl, finalUrl: resolved.finalUrl, diagnostics };
    }

    const playwrightResult = await tryPlaywright(resolved.finalUrl, diagnostics);
    if (playwrightResult) {
      rememberLinkResolve({ ...diagnostics, apiSuccess: false, ytdlpSuccess: false, playwrightSuccess: true, finalFailureReason: '' });
      return { ...playwrightResult, originalUrl: extractedUrl, finalUrl: resolved.finalUrl, diagnostics };
    }

    diagnostics.finalFailureReason = FALLBACK_FAILED_MESSAGE;
    rememberLinkResolve({ ...diagnostics, apiSuccess: false, ytdlpSuccess: false, playwrightSuccess: false });
    const error = new Error(FALLBACK_FAILED_MESSAGE);
    error.channel = 'failed';
    error.stage = 'resolve';
    error.errorType = 'douyin_resolve_failed';
    error.errorMessage = FALLBACK_FAILED_MESSAGE;
    error.errors = diagnostics.errors;
    error.diagnostics = diagnostics;
    throw error;
  } catch (error) {
    if (!diagnostics.finalFailureReason) diagnostics.finalFailureReason = error.message || FALLBACK_FAILED_MESSAGE;
    rememberLinkResolve({ ...diagnostics, apiSuccess: diagnostics.api.success, ytdlpSuccess: diagnostics.ytdlp.success, playwrightSuccess: diagnostics.playwright.success });
    logStep('resolve_failed', 'fail', { stage: 'resolve', channel: error.channel || 'failed', errorType: error.errorType || 'douyin_resolve_failed', errorMessage: diagnostics.finalFailureReason, errors: diagnostics.errors, diagnostics });
    error.stage = error.stage || 'resolve';
    error.errorType = error.errorType || 'douyin_resolve_failed';
    error.errorMessage = error.errorMessage || diagnostics.finalFailureReason;
    error.errors = error.errors || diagnostics.errors;
    error.channel = error.channel || 'failed';
    error.diagnostics = diagnostics;
    throw error;
  }
}

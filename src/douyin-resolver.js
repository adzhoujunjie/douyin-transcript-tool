import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { extractDouyinLinks, isShortLink, normalizeUrl, resolveDouyinUrl } from './link-utils.js';
import { logStep, summarizeError } from './logger.js';
import { rememberLinkResolve } from './runtime-state.js';

const DOWNLOAD_DIR = path.resolve('tmp/downloads');
const API_NO_VIDEO_MESSAGE = '解析 API 未返回可用视频地址，请检查解析 API 配置或更换解析服务';
const AUTO_VIDEO_FIELDS = ['video_url', 'videoUrl', 'play_url', 'playUrl', 'download_url', 'downloadUrl', 'url', 'data.video_url', 'data.play_url', 'data.url'];
const CONTENT_TYPE_EXT = new Map([
  ['video/mp4', '.mp4'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/wav', '.wav']
]);

function createAttemptDiagnostics(channel, success = false, detail = '') {
  return { channel, success, detail: summarizeError(detail || '') };
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
  logStep('视频直链下载开始', 'start', { channel, url: videoUrl });
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
    logStep('视频直链下载成功', 'success', { channel, fileExt: ext });
    return filePath;
  } catch (error) {
    const message = error.name === 'AbortError' ? '视频直链下载超时。' : `视频直链下载失败：${summarizeError(error.message)}`;
    logStep('视频直链下载失败', 'fail', { channel, errorType: 'direct_video_download_failed', errorMessage: message });
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

async function tryApiResolver(finalUrl, diagnostics) {
  const resolver = config.douyin.resolver;
  if (resolver.provider !== 'api' || !resolver.apiUrl) {
    diagnostics.api = createAttemptDiagnostics('api', false, '未配置 DOUYIN_RESOLVER_PROVIDER=api 或 DOUYIN_RESOLVER_API_URL');
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

  logStep('第三方解析 API 开始', 'start', { method, apiDomain: new URL(resolver.apiUrl).host, urlField: field, responseVideoFieldConfigured: Boolean(resolver.responseVideoField) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60 * 1000);
  try {
    const response = await fetch(requestUrl, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${summarizeError(text)}`);
    const videoUrl = extractVideoUrlFromResponse(data);
    if (!videoUrl) throw new Error(API_NO_VIDEO_MESSAGE);
    const filePath = await downloadVideoUrl(videoUrl, 'api');
    diagnostics.api = createAttemptDiagnostics('api', true, '第三方解析 API 成功返回视频地址');
    return { channel: 'api', filePath, videoUrl };
  } catch (error) {
    const message = error.name === 'AbortError' ? '解析接口请求超时' : error.message;
    diagnostics.api = createAttemptDiagnostics('api', false, message);
    logStep('第三方解析 API 失败', 'fail', { errorType: 'api_resolver_failed', errorMessage: message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveDouyinVideo(inputText) {
  const diagnostics = {
    inputText: summarizeError(inputText),
    extractedUrl: '',
    finalUrl: '',
    api: createAttemptDiagnostics('api'),
    ytdlp: createAttemptDiagnostics('yt-dlp', false, '主流程已禁用'),
    playwright: createAttemptDiagnostics('playwright', false, '主流程已禁用'),
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

    diagnostics.finalFailureReason = API_NO_VIDEO_MESSAGE;
    rememberLinkResolve({ ...diagnostics, apiSuccess: false, ytdlpSuccess: false, playwrightSuccess: false });
    const error = new Error(API_NO_VIDEO_MESSAGE);
    error.channel = 'failed';
    error.diagnostics = diagnostics;
    throw error;
  } catch (error) {
    if (!diagnostics.finalFailureReason) diagnostics.finalFailureReason = error.message || API_NO_VIDEO_MESSAGE;
    rememberLinkResolve({ ...diagnostics, apiSuccess: diagnostics.api.success, ytdlpSuccess: diagnostics.ytdlp.success, playwrightSuccess: diagnostics.playwright.success });
    logStep('统一抖音解析失败', 'fail', { errorType: 'douyin_resolve_failed', errorMessage: diagnostics.finalFailureReason, diagnostics });
    error.channel = error.channel || 'failed';
    error.diagnostics = diagnostics;
    throw error;
  }
}

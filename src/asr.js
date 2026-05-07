import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { logStep, summarizeError } from './logger.js';
import { rememberAsrError } from './runtime-state.js';

const ASR_DISABLED_MESSAGE = '当前未启用 ASR 语音识别，请配置可用的 ASR_PROVIDER / ASR_MODEL，或使用手动粘贴字幕整理功能。';

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function requestIdFrom(response, data) {
  return response?.headers?.get('x-request-id') || response?.headers?.get('request-id') || data?.request_id || data?.requestId || data?.error?.request_id || '';
}

export function classifyAsrError({ status = 0, message = '', timedOut = false } = {}) {
  const text = String(message || '');
  if (timedOut || /timeout|timed out|ETIMEDOUT|AbortError/i.test(text)) return { type: 'timeout', userMessage: '语音识别超时，请稍后重试或上传更短文件。' };
  if (/overloaded|负载|饱和|unavailable|temporarily unavailable|busy|try again later/i.test(text) || [500, 502, 503, 504].includes(status)) return { type: 'overloaded', userMessage: '语音识别服务繁忙，请稍后重试，或更换 ASR_MODEL / ASR_BASE_URL。' };
  if (status === 429 || /rate limit|too many requests|quota/i.test(text)) return { type: 'rate_limit', userMessage: '语音识别服务触发限流，请稍后重试，或更换 ASR_MODEL / ASR_BASE_URL。' };
  if (status === 401 || status === 403 || /unauthorized|invalid api key|forbidden|permission denied|鉴权|权限/i.test(text)) return { type: 'unauthorized', userMessage: 'ASR_API_KEY 无效或没有权限。' };
  if (/model not found|model not available|does not exist|模型不存在|模型不可用/i.test(text)) return { type: 'model_not_found', userMessage: '当前 ASR_MODEL 可能不支持音频转写，请更换支持音频转写的模型。' };
  if (status === 404 || /not found|endpoint/i.test(text)) return { type: 'endpoint_not_found', userMessage: 'ASR_BASE_URL 可能不是音频转写接口。' };
  if (/unsupported audio|audio transcription|not support|不支持.*音频|不支持.*转写/i.test(text)) return { type: 'unsupported_audio_transcription', userMessage: '当前 ASR_MODEL 可能不支持音频转写，请更换支持音频转写的模型。' };
  if (status === 413 || /file too large|payload too large|maximum.*file|文件.*大/i.test(text)) return { type: 'file_too_large', userMessage: '请上传更短的视频或先压缩音频。' };
  return { type: 'asr_failed', userMessage: `ASR失败：${summarizeError(text) || '接口未返回可用错误信息。'}` };
}

function assertAsrConfig() {
  if (config.asr.provider === 'disabled') {
    const error = new Error(ASR_DISABLED_MESSAGE);
    error.errorType = 'asr_disabled';
    throw error;
  }
  if (config.asr.provider !== 'openai-compatible') {
    const error = new Error(`不支持的 ASR_PROVIDER：${config.asr.provider}。当前支持 openai-compatible / disabled。`);
    error.errorType = 'asr_provider_unsupported';
    throw error;
  }
  if (!config.asr.apiKey || !config.asr.baseUrl || !config.asr.model) {
    const error = new Error('ASR接口不可用：请配置 ASR_API_KEY/ASR_BASE_URL/ASR_MODEL，未配置 ASR_* 时会默认复用 OPENAI_*。');
    error.errorType = 'asr_config_missing';
    throw error;
  }
}

export async function transcribeAudio(audioPath) {
  const stat = await fs.stat(audioPath);
  try {
    assertAsrConfig();
  } catch (error) {
    rememberAsrError({ provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: error.errorType || 'asr_config_error', errorMessage: error.message, rawSummary: error.message });
    logStep('ASR 转写失败', 'fail', { provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: error.errorType || 'asr_config_error', errorMessage: error.message });
    throw error;
  }

  const buffer = await fs.readFile(audioPath);
  const filename = path.basename(audioPath);
  const formData = new FormData();
  formData.append('model', config.asr.model);
  formData.append('file', new Blob([buffer]), filename);
  formData.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  logStep('ASR 转写开始', 'start', { provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size });

  let response;
  let text = '';
  let data = {};
  try {
    response = await fetch(`${normalizeBaseUrl(config.asr.baseUrl)}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.asr.apiKey}` },
      body: formData,
      signal: controller.signal
    });
    text = await response.text();
    try { data = JSON.parse(text); } catch { data = { text }; }
  } catch (error) {
    const classified = classifyAsrError({ message: error.message, timedOut: error.name === 'AbortError' });
    rememberAsrError({ provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: classified.type, errorMessage: classified.userMessage, rawSummary: summarizeError(error.message) });
    logStep('ASR 转写失败', 'fail', { provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: classified.type, errorMessage: classified.userMessage, rawSummary: error.message });
    throw new Error(classified.userMessage);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const rawMessage = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
    const classified = classifyAsrError({ status: response.status, message: rawMessage });
    const requestId = requestIdFrom(response, data);
    rememberAsrError({ requestId, provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: classified.type, errorMessage: classified.userMessage, rawSummary: summarizeError(rawMessage) });
    logStep('ASR 转写失败', 'fail', { requestId, provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: classified.type, errorMessage: classified.userMessage, rawSummary: rawMessage, status: response.status });
    throw new Error(classified.userMessage);
  }

  const transcript = data.text || data.transcript || data.result || '';
  if (!transcript.trim()) {
    const classified = classifyAsrError({ message: '接口未返回可用转写文本，可能不支持音频转写。' });
    rememberAsrError({ requestId: requestIdFrom(response, data), provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: 'empty_transcript', errorMessage: classified.userMessage, rawSummary: 'empty transcript' });
    logStep('ASR 转写失败', 'fail', { provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, errorType: 'empty_transcript', errorMessage: classified.userMessage });
    throw new Error(classified.userMessage);
  }

  logStep('ASR 转写成功', 'success', { provider: config.asr.provider, model: config.asr.model, audioFileSize: stat.size, transcriptLength: transcript.trim().length });
  return transcript.trim();
}

export async function lightlyCorrectTranscript(rawText) {
  if (!rawText.trim()) return rawText;
  if (!config.openai.apiKey || !config.openai.baseUrl || !config.openai.model) {
    return rawText.trim();
  }

  const body = {
    model: config.openai.model,
    messages: [
      { role: 'system', content: '你是中文口播转写校对助手。请尽量忠于原话，不总结、不扩写、不改写成广告文案，不改变原意。只修正明显错别字、语气词重复、断句和标点，保留原口播语气。只输出校对后的口播文案。' },
      { role: 'user', content: rawText }
    ],
    temperature: 0.1
  };

  logStep('文本纠错开始', 'start', { model: config.openai.model, inputLength: rawText.length });
  try {
    const response = await fetch(`${normalizeBaseUrl(config.openai.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      logStep('文本纠错失败', 'fail', { errorType: 'text_correction_failed', errorMessage: data?.error?.message || `HTTP ${response.status}` });
      return rawText.trim();
    }
    const corrected = (data.choices?.[0]?.message?.content || rawText).trim();
    logStep('文本纠错成功', 'success', { model: config.openai.model, outputLength: corrected.length });
    return corrected;
  } catch (error) {
    logStep('文本纠错失败', 'fail', { errorType: 'text_correction_failed', errorMessage: error.message });
    return rawText.trim();
  }
}

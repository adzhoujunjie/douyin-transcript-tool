import { safeUnlink } from './file-utils.js';
import { extractDouyinLinks } from './link-utils.js';
import { extractAudio } from './media.js';
import { resolveDouyinVideo } from './douyin-resolver.js';
import { lightlyCorrectTranscript, transcribeAudio } from './asr.js';
import { logStep } from './logger.js';

function toResultError(error, fallbackStage = 'process', fallbackChannel = 'failed') {
  const errorMessage = error.errorMessage || error.message || '处理失败';
  return {
    stage: error.stage || fallbackStage,
    channel: error.channel || fallbackChannel,
    errorType: error.errorType || `${fallbackStage}_failed`,
    errorMessage,
    diagnostics: error.diagnostics || null,
    errors: error.errors || error.diagnostics?.errors || []
  };
}

async function transcribeMediaFile(filePath) {
  let audioPath = '';
  let generatedAudio = false;
  let audio;
  try {
    logStep('extract_audio_start', 'start', { stage: 'extract', channel: 'ffmpeg', filePath });
    audio = await extractAudio(filePath);
    audioPath = audio.audioPath;
    generatedAudio = audio.generated;
    logStep('asr_start', 'start', { stage: 'asr', channel: 'asr', audioPath });
    const rawTranscript = await transcribeAudio(audioPath);
    const transcript = await lightlyCorrectTranscript(rawTranscript);
    logStep('asr_success', 'success', { stage: 'asr', channel: 'asr', audioPath, transcriptLength: transcript.length });
    return { transcript, audioPath, generatedAudio };
  } catch (error) {
    error.audioPath = audioPath;
    error.generatedAudio = generatedAudio;
    if (!error.stage) error.stage = audio ? 'asr' : 'extract';
    if (!error.channel) error.channel = audio ? 'asr' : 'ffmpeg';
    if (!error.errorType) error.errorType = audio ? 'asr_failed' : 'extract_failed';
    if (!error.errorMessage) error.errorMessage = error.message || '处理失败';
    logStep(error.stage === 'asr' ? 'asr_failed' : 'extract_audio_failed', 'fail', { stage: error.stage, channel: error.channel, errorType: error.errorType, errorMessage: error.errorMessage, audioPath, filePath });
    throw error;
  }
}

export async function processInputText(text) {
  logStep('提取链接开始', 'start', { inputLength: String(text || '').length });
  const links = extractDouyinLinks(text);
  if (!links.length) throw new Error('未识别到抖音链接，请粘贴抖音链接、短链或完整分享口令。');
  return processDouyinLink(text);
}

export async function processDouyinLink(inputText) {
  let videoPath = '';
  let audioPath = '';
  let generatedAudio = false;
  let resolveResult;

  try {
    logStep('start_process_link', 'start', { link: String(inputText || ''), inputLength: String(inputText || '').length });
    logStep('resolve_start', 'start', { stage: 'resolve', channel: 'multi', link: String(inputText || '') });
    resolveResult = await resolveDouyinVideo(inputText);
    videoPath = resolveResult.filePath;
    logStep('resolve_success', 'success', { stage: 'resolve', channel: resolveResult.channel, link: resolveResult.finalUrl || resolveResult.originalUrl || inputText, filePath: videoPath });
    const result = await transcribeMediaFile(videoPath);
    audioPath = result.audioPath;
    generatedAudio = result.generatedAudio;

    return {
      videoLink: resolveResult.finalUrl || resolveResult.originalUrl || inputText,
      channel: resolveResult.channel,
      status: '成功',
      transcript: result.transcript,
      error: '',
      stage: 'done',
      errorType: '',
      errorMessage: '',
      diagnostics: resolveResult.diagnostics || null
    };
  } catch (error) {
    const structured = toResultError(error, error.stage || 'process', error.channel || resolveResult?.channel || 'failed');
    const channel = structured.channel || resolveResult?.channel || 'failed';
    logStep('链接处理失败', 'fail', { ...structured, channel, link: String(inputText || ''), inputLength: String(inputText || '').length });
    return { videoLink: resolveResult?.finalUrl || inputText, channel, status: '失败', transcript: '', error: structured.errorMessage, ...structured };
  } finally {
    await safeUnlink(videoPath);
    if (generatedAudio) await safeUnlink(audioPath);
  }
}

export async function processBatchText(text) {
  logStep('提取链接开始', 'start', { mode: 'batch', inputLength: String(text || '').length });
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const inputs = lines.length ? lines : [text];
  const results = [];

  for (const input of inputs) {
    const links = extractDouyinLinks(input);
    if (!links.length) {
      results.push({ videoLink: input, channel: 'failed', status: '失败', transcript: '', error: '未识别到抖音链接，请粘贴抖音链接、短链或完整分享口令。', stage: 'resolve', errorType: 'link_not_found', errorMessage: '未识别到抖音链接，请粘贴抖音链接、短链或完整分享口令。', diagnostics: null, errors: [] });
      continue;
    }
    if (links.length === 1) results.push(await processDouyinLink(input));
    else for (const link of links) results.push(await processDouyinLink(link));
  }

  return results;
}

export async function processUploadedMedia(filePath) {
  let audioPath = '';
  let generatedAudio = false;
  try {
    const result = await transcribeMediaFile(filePath);
    audioPath = result.audioPath;
    generatedAudio = result.generatedAudio;
    return { videoLink: '上传文件', channel: 'upload', status: '成功', transcript: result.transcript, error: '', stage: 'done', errorType: '', errorMessage: '', diagnostics: null };
  } catch (error) {
    audioPath = error.audioPath || audioPath;
    generatedAudio = error.generatedAudio || generatedAudio;
    const structured = toResultError(error, error.stage || 'process', error.channel || 'upload');
    logStep('上传媒体处理失败', 'fail', { ...structured });
    return { videoLink: '上传文件', channel: structured.channel || 'upload', status: '失败', transcript: '', error: structured.errorMessage, ...structured };
  } finally {
    if (generatedAudio) await safeUnlink(audioPath);
    await safeUnlink(filePath);
  }
}

export async function polishManualTranscript(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('请先粘贴字幕或口播文本。');
  return lightlyCorrectTranscript(raw);
}

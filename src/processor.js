import { safeUnlink } from './file-utils.js';
import { extractDouyinLinks } from './link-utils.js';
import { extractAudio } from './media.js';
import { resolveDouyinVideo } from './douyin-resolver.js';
import { lightlyCorrectTranscript, transcribeAudio } from './asr.js';
import { logStep } from './logger.js';

async function transcribeMediaFile(filePath) {
  let audioPath = '';
  let generatedAudio = false;
  const audio = await extractAudio(filePath);
  audioPath = audio.audioPath;
  generatedAudio = audio.generated;
  try {
    const rawTranscript = await transcribeAudio(audioPath);
    const transcript = await lightlyCorrectTranscript(rawTranscript);
    return { transcript, audioPath, generatedAudio };
  } catch (error) {
    error.audioPath = audioPath;
    error.generatedAudio = generatedAudio;
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
    logStep('链接多通道处理开始', 'start', { inputLength: String(inputText || '').length });
    resolveResult = await resolveDouyinVideo(inputText);
    videoPath = resolveResult.filePath;
    const result = await transcribeMediaFile(videoPath);
    audioPath = result.audioPath;
    generatedAudio = result.generatedAudio;

    return {
      videoLink: resolveResult.finalUrl || resolveResult.originalUrl || inputText,
      channel: resolveResult.channel,
      status: '成功',
      transcript: result.transcript,
      error: ''
    };
  } catch (error) {
    const channel = error.channel || resolveResult?.channel || 'failed';
    logStep('链接处理失败', 'fail', { errorType: error.errorType || 'process_link_failed', errorMessage: error.message || '处理失败', channel, inputLength: String(inputText || '').length });
    return { videoLink: resolveResult?.finalUrl || inputText, channel, status: '失败', transcript: '', error: error.message || '处理失败' };
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
      results.push({ videoLink: input, channel: 'failed', status: '失败', transcript: '', error: '未识别到抖音链接，请粘贴抖音链接、短链或完整分享口令。' });
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
    return { videoLink: '上传文件', channel: 'upload', status: '成功', transcript: result.transcript, error: '' };
  } catch (error) {
    audioPath = error.audioPath || audioPath;
    generatedAudio = error.generatedAudio || generatedAudio;
    logStep('上传媒体处理失败', 'fail', { errorType: error.errorType || 'uploaded_media_failed', errorMessage: error.message || '处理失败' });
    return { videoLink: '上传文件', channel: 'upload', status: '失败', transcript: '', error: error.message || '处理失败' };
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

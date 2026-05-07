import { safeUnlink } from './file-utils.js';
import { extractDouyinLinks, resolveDouyinUrl } from './link-utils.js';
import { downloadVideo, extractAudio } from './media.js';
import { lightlyCorrectTranscript, transcribeAudio } from './asr.js';

export async function processInputText(text) {
  const links = extractDouyinLinks(text);
  if (!links.length) {
    throw new Error('未识别到抖音链接');
  }
  return processDouyinLink(links[0]);
}

export async function processDouyinLink(link) {
  let videoPath = '';
  let audioPath = '';
  let generatedAudio = false;

  try {
    const resolved = await resolveDouyinUrl(link);
    if (!resolved.videoId && /douyin\.com/i.test(resolved.finalUrl) && !/\/video\//i.test(resolved.finalUrl)) {
      throw new Error('视频页面无法访问：未能从链接中解析视频 ID，当前视频可能需要登录或不可访问');
    }

    videoPath = await downloadVideo(resolved.finalUrl);
    const audio = await extractAudio(videoPath);
    audioPath = audio.audioPath;
    generatedAudio = audio.generated;
    const rawTranscript = await transcribeAudio(audioPath);
    const transcript = await lightlyCorrectTranscript(rawTranscript);

    return {
      videoLink: resolved.finalUrl,
      status: '成功',
      transcript,
      error: ''
    };
  } catch (error) {
    return {
      videoLink: link,
      status: '失败',
      transcript: '',
      error: error.message || '处理失败'
    };
  } finally {
    await safeUnlink(videoPath);
    if (generatedAudio) await safeUnlink(audioPath);
  }
}

export async function processBatchText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const inputs = lines.length ? lines : [text];
  const results = [];

  for (const input of inputs) {
    const links = extractDouyinLinks(input);
    if (!links.length) {
      results.push({ videoLink: input, status: '失败', transcript: '', error: '未识别到抖音链接' });
      continue;
    }

    for (const link of links) {
      results.push(await processDouyinLink(link));
    }
  }

  return results;
}

export async function processUploadedMedia(filePath) {
  let audioPath = '';
  let generatedAudio = false;
  try {
    const audio = await extractAudio(filePath);
    audioPath = audio.audioPath;
    generatedAudio = audio.generated;
    const rawTranscript = await transcribeAudio(audioPath);
    const transcript = await lightlyCorrectTranscript(rawTranscript);
    return { videoLink: '上传文件', status: '成功', transcript, error: '' };
  } catch (error) {
    return { videoLink: '上传文件', status: '失败', transcript: '', error: error.message || '处理失败' };
  } finally {
    if (generatedAudio) await safeUnlink(audioPath);
    await safeUnlink(filePath);
  }
}

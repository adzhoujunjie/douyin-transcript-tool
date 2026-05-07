import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const TMP_DIR = path.resolve('tmp');

async function runCommand(command, args, errorPrefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`${errorPrefix}：${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${errorPrefix}：${stderr.trim() || `命令退出码 ${code}`}`));
    });
  });
}

export async function downloadVideo(url) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const outputTemplate = path.join(TMP_DIR, `${randomUUID()}.%(ext)s`);
  const args = [
    '--no-playlist',
    '--max-filesize',
    '500m',
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    '-o',
    outputTemplate,
    url
  ];

  try {
    await runCommand('yt-dlp', args, '视频下载失败');
  } catch (error) {
    if (/ENOENT/.test(error.message)) {
      throw new Error('视频下载失败：服务器未安装 yt-dlp');
    }
    throw error;
  }

  const prefix = outputTemplate.replace('%(ext)s', '');
  const files = await fs.readdir(TMP_DIR);
  const downloaded = files.find((file) => path.join(TMP_DIR, file).startsWith(prefix));
  if (!downloaded) {
    throw new Error('视频下载失败：未找到下载后的视频文件，当前视频可能需要登录或不可访问');
  }
  return path.join(TMP_DIR, downloaded);
}

export async function extractAudio(inputPath) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const ext = path.extname(inputPath).toLowerCase();
  if (['.mp3', '.wav'].includes(ext)) {
    return { audioPath: inputPath, generated: false };
  }

  const audioPath = path.join(TMP_DIR, `${randomUUID()}.mp3`);
  try {
    await runCommand('ffmpeg', ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', audioPath], '音频提取失败');
  } catch (error) {
    if (/ENOENT/.test(error.message)) {
      throw new Error('音频提取失败：服务器未安装 ffmpeg');
    }
    throw error;
  }

  return { audioPath, generated: true };
}

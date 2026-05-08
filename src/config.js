import dotenv from 'dotenv';

dotenv.config();

const trimTrailingSlash = (value) => (value || '').trim().replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3001),
  appPassword: process.env.APP_PASSWORD || '',
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ffprobePath: process.env.FFPROBE_PATH || '',
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    model: process.env.OPENAI_MODEL || ''
  },
  asr: {
    provider: (process.env.ASR_PROVIDER || 'openai-compatible').trim().toLowerCase(),
    apiKey: process.env.ASR_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: trimTrailingSlash(process.env.ASR_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    model: process.env.ASR_MODEL || process.env.OPENAI_MODEL || ''
  },
  douyin: {
    cookiesFile: (process.env.DOUYIN_COOKIES_FILE || '').trim(),
    userAgent: process.env.DOUYIN_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    referer: process.env.DOUYIN_REFERER || 'https://www.douyin.com/',
    retries: Number(process.env.DOUYIN_YTDLP_RETRIES || 3),
    resolver: {
      provider: (process.env.DOUYIN_RESOLVER_PROVIDER || '').trim().toLowerCase(),
      apiUrl: (process.env.DOUYIN_RESOLVER_API_URL || '').trim(),
      apiKey: process.env.DOUYIN_RESOLVER_API_KEY || '',
      method: (process.env.DOUYIN_RESOLVER_METHOD || 'POST').trim().toUpperCase(),
      urlField: (process.env.DOUYIN_RESOLVER_URL_FIELD || 'url').trim() || 'url',
      responseVideoField: (process.env.DOUYIN_RESOLVER_RESPONSE_VIDEO_FIELD || '').trim()
    }
  }
};

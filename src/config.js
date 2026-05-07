import dotenv from 'dotenv';

dotenv.config();

const trimTrailingSlash = (value) => (value || '').trim().replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3001),
  appPassword: process.env.APP_PASSWORD || '',
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    model: process.env.OPENAI_MODEL || ''
  },
  asr: {
    apiKey: process.env.ASR_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: trimTrailingSlash(process.env.ASR_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    model: process.env.ASR_MODEL || process.env.OPENAI_MODEL || ''
  }
};

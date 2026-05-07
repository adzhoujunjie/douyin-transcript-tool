import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

function assertAsrConfig() {
  if (!config.asr.apiKey || !config.asr.baseUrl || !config.asr.model) {
    throw new Error('ASR接口不可用：请配置 ASR_API_KEY/ASR_BASE_URL/ASR_MODEL，未配置 ASR_* 时会默认复用 OPENAI_*');
  }
}

export async function transcribeAudio(audioPath) {
  assertAsrConfig();

  const buffer = await fs.readFile(audioPath);
  const filename = path.basename(audioPath);
  const formData = new FormData();
  formData.append('model', config.asr.model);
  formData.append('file', new Blob([buffer]), filename);
  formData.append('response_format', 'json');

  let response;
  try {
    response = await fetch(`${config.asr.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.asr.apiKey}` },
      body: formData
    });
  } catch (error) {
    throw new Error(`ASR接口不可用或不支持音频转写：${error.message}`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
    throw new Error(`ASR失败：${message}`);
  }

  const transcript = data.text || data.transcript || data.result || '';
  if (!transcript.trim()) {
    throw new Error('ASR失败：接口未返回可用转写文本');
  }

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
      {
        role: 'system',
        content: '你是中文口播转写校对助手。请尽量忠于原话，不总结、不扩写、不改写成广告文案，只修正明显错别字、断句和标点。只输出校对后的口播文案。'
      },
      { role: 'user', content: rawText }
    ],
    temperature: 0.1
  };

  try {
    const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) return rawText.trim();
    return (data.choices?.[0]?.message?.content || rawText).trim();
  } catch {
    return rawText.trim();
  }
}

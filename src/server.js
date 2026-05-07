import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { authStatus, login, requirePassword } from './auth.js';
import { readLinksFromUploadedFile, safeUnlink, ensureAllowedMediaFile } from './file-utils.js';
import { extractDouyinLinks } from './link-utils.js';
import { processBatchText, processDouyinLink, processInputText, processUploadedMedia, polishManualTranscript } from './processor.js';
import { getDiagnostics } from './diagnostics.js';
import { logStep } from './logger.js';

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 600 * 1024 * 1024 } });

await fs.mkdir('uploads', { recursive: true });
await fs.mkdir('downloads', { recursive: true });
await fs.mkdir('tmp', { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve('public')));

app.get('/diagnostics', (_req, res) => res.sendFile(path.resolve('public/diagnostics.html')));
app.get('/api/auth/status', authStatus);
app.post('/api/auth/login', login);

app.get('/api/diagnostics', requirePassword, async (_req, res) => {
  res.json({ ok: true, diagnostics: await getDiagnostics() });
});

app.post('/api/transcribe/single', requirePassword, async (req, res) => {
  try {
    const result = await processInputText(req.body?.text || '');
    res.json({ ok: result.status === '成功', result });
  } catch (error) {
    logStep('单条识别失败', 'fail', { errorType: 'single_transcribe_failed', errorMessage: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/transcribe/batch', requirePassword, async (req, res) => {
  const results = await processBatchText(req.body?.text || '');
  res.json({ ok: true, results });
});

app.post('/api/transcript/polish', requirePassword, async (req, res) => {
  try {
    const transcript = await polishManualTranscript(req.body?.text || '');
    res.json({ ok: true, transcript });
  } catch (error) {
    logStep('文本纠错失败', 'fail', { errorType: 'manual_polish_failed', errorMessage: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/upload/links', requirePassword, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请上传 txt / csv / xlsx 文件');
    const links = await readLinksFromUploadedFile(req.file);
    if (!links.length) return res.json({ ok: true, links: [], results: [{ videoLink: req.file.originalname, status: '失败', transcript: '', error: '未识别到抖音链接' }] });
    const results = [];
    for (const link of links) results.push(await processDouyinLink(link));
    res.json({ ok: true, links, results });
  } catch (error) {
    logStep('上传链接文件失败', 'fail', { errorType: 'link_file_upload_failed', errorMessage: error.message });
    res.status(400).json({ ok: false, error: error.message });
  } finally {
    await safeUnlink(req.file?.path);
  }
});

app.post('/api/upload/media', requirePassword, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请上传 mp4 / mp3 / wav / m4a 文件');
    ensureAllowedMediaFile(req.file);
    const result = await processUploadedMedia(req.file.path);
    res.json({ ok: result.status === '成功', result });
  } catch (error) {
    await safeUnlink(req.file?.path);
    logStep('上传媒体失败', 'fail', { errorType: 'media_upload_failed', errorMessage: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/links/extract', requirePassword, (req, res) => {
  res.json({ ok: true, links: extractDouyinLinks(req.body?.text || '') });
});

app.post('/api/log/csv-export', requirePassword, (req, res) => {
  logStep('CSV 导出成功', 'success', { rowCount: Number(req.body?.rowCount || 0) });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ ok: false, error: `上传失败：${err.message}` });
  logStep('服务器错误', 'fail', { errorType: 'server_error', errorMessage: err.message || '服务器错误' });
  res.status(500).json({ ok: false, error: err.message || '服务器错误' });
});

app.listen(config.port, () => {
  logStep('服务启动', 'success', { port: config.port });
  console.log(`douyin-transcript listening on http://localhost:${config.port}`);
});

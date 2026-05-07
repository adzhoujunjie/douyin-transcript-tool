import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { authStatus, login, requirePassword } from './auth.js';
import { readLinksFromUploadedFile, safeUnlink, ensureAllowedMediaFile } from './file-utils.js';
import { extractDouyinLinks } from './link-utils.js';
import { processBatchText, processDouyinLink, processInputText, processUploadedMedia } from './processor.js';

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 600 * 1024 * 1024 } });

await fs.mkdir('uploads', { recursive: true });
await fs.mkdir('tmp', { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve('public')));

app.get('/api/auth/status', authStatus);
app.post('/api/auth/login', login);

app.post('/api/transcribe/single', requirePassword, async (req, res) => {
  try {
    const result = await processInputText(req.body?.text || '');
    res.json({ ok: result.status === '成功', result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/transcribe/batch', requirePassword, async (req, res) => {
  const results = await processBatchText(req.body?.text || '');
  res.json({ ok: true, results });
});

app.post('/api/upload/links', requirePassword, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请上传 txt / csv / xlsx 文件');
    const links = await readLinksFromUploadedFile(req.file);
    if (!links.length) {
      return res.json({ ok: true, links: [], results: [{ videoLink: req.file.originalname, status: '失败', transcript: '', error: '未识别到抖音链接' }] });
    }

    const results = [];
    for (const link of links) {
      results.push(await processDouyinLink(link));
    }
    res.json({ ok: true, links, results });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  } finally {
    await safeUnlink(req.file?.path);
  }
});

app.post('/api/upload/media', requirePassword, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请上传 mp4 / mp3 / wav 文件');
    ensureAllowedMediaFile(req.file);
    const result = await processUploadedMedia(req.file.path);
    res.json({ ok: result.status === '成功', result });
  } catch (error) {
    await safeUnlink(req.file?.path);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/links/extract', requirePassword, (req, res) => {
  res.json({ ok: true, links: extractDouyinLinks(req.body?.text || '') });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `上传失败：${err.message}` });
  }
  res.status(500).json({ ok: false, error: err.message || '服务器错误' });
});

app.listen(config.port, () => {
  console.log(`douyin-transcript listening on http://localhost:${config.port}`);
});

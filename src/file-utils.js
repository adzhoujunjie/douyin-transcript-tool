import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { extractDouyinLinks } from './link-utils.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.csv']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx']);
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mp3', '.wav', '.m4a']);

export function ensureAllowedTextFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && !SPREADSHEET_EXTENSIONS.has(ext)) throw new Error('文件格式不支持，请上传 txt / csv / xlsx 文件。');
}

export function ensureAllowedMediaFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) throw new Error('文件格式不支持，请上传 mp4 / mp3 / wav / m4a 文件。');
}

export async function readLinksFromUploadedFile(file) {
  ensureAllowedTextFile(file);
  const ext = path.extname(file.originalname || '').toLowerCase();
  let content = '';
  if (TEXT_EXTENSIONS.has(ext)) {
    content = await fs.readFile(file.path, 'utf8');
  } else {
    const workbook = XLSX.readFile(file.path, { cellDates: true });
    const values = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      for (const row of rows) for (const cell of row) values.push(String(cell || ''));
    }
    content = values.join('\n');
  }
  return extractDouyinLinks(content);
}

export async function safeUnlink(filePath) {
  if (!filePath) return;
  try { await fs.unlink(filePath); } catch { /* Ignore cleanup errors. */ }
}

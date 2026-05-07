import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { extractDouyinLinks } from './link-utils.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.csv']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx']);
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mp3', '.wav']);

export function ensureAllowedTextFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && !SPREADSHEET_EXTENSIONS.has(ext)) {
    throw new Error('文件格式不支持，请上传 txt / csv / xlsx 文件');
  }
}

export function ensureAllowedMediaFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) {
    throw new Error('文件格式不支持，请上传 mp4 / mp3 / wav 文件');
  }
}

export async function readLinksFromUploadedFile(file) {
  ensureAllowedTextFile(file);
  const ext = path.extname(file.originalname || '').toLowerCase();
  let content = '';

  if (TEXT_EXTENSIONS.has(ext)) {
    content = await fs.readFile(file.path, 'utf8');
  } else {
    const workbook = XLSX.readFile(file.path);
    content = workbook.SheetNames
      .map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name]))
      .join('\n');
  }

  return extractDouyinLinks(content);
}

export async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

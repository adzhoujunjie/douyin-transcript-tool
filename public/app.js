const state = { password: localStorage.getItem('douyinTranscriptPassword') || '', results: [] };

const $ = (id) => document.getElementById(id);
const appPanel = $('appPanel');
const passwordPanel = $('passwordPanel');
const resultBody = $('resultBody');

function authHeaders() { return state.password ? { 'x-app-password': state.password } : {}; }

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), ...authHeaders() } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.errorMessage || data.error || '请求失败'); error.payload = data; throw error; }
  return data;
}

function setLoading(button, loading, text) {
  if (!button) return;
  button.disabled = loading;
  if (loading) { button.dataset.originalText = button.textContent; button.textContent = text || '处理中...'; }
  else if (button.dataset.originalText) button.textContent = button.dataset.originalText;
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }

function formatDiagnosticsSummary(item = {}) {
  const parts = [];
  if (item.stage) parts.push(`阶段：${item.stage}`);
  if (item.channel) parts.push(`通道：${item.channel}`);
  if (item.errorType) parts.push(`类型：${item.errorType}`);
  const channelErrors = item.errors || item.diagnostics?.errors || [];
  if (channelErrors.length) {
    parts.push('解析链路失败详情：');
    for (const err of channelErrors) parts.push(`- ${err.channel || 'unknown'}: ${err.errorType || 'failed'} - ${err.errorMessage || err.detail || ''}`);
  }
  return parts.join('\n');
}

function displayResultText(item = {}) {
  if (item.status === '成功') return `解析通道：${item.channel || 'unknown'}\n${item.transcript || ''}`;
  return [`解析通道：${item.channel || 'failed'}`, item.errorMessage || item.error || '处理失败', formatDiagnosticsSummary(item)].filter(Boolean).join('\n');
}

function errorMessageWithPayload(error) {
  return [error.message, formatDiagnosticsSummary(error.payload || {})].filter(Boolean).join('\n');
}

function renderResults(results) {
  state.results = results;
  if (!results.length) { resultBody.innerHTML = '<tr><td colspan="7" class="empty">暂无结果</td></tr>'; return; }
  resultBody.innerHTML = results.map((item, index) => `
    <tr><td>${index + 1}</td><td class="url-cell">${escapeHtml(item.videoLink || '')}</td><td><span class="channel-badge">${escapeHtml(item.channel || 'failed')}</span></td><td class="${item.status === '成功' ? 'success' : 'fail'}">${escapeHtml(item.status || '')}</td><td class="transcript-cell">${escapeHtml(item.transcript || '')}</td><td class="fail">${escapeHtml([item.error || '', formatDiagnosticsSummary(item)].filter(Boolean).join('\n'))}</td><td>${item.transcript ? `<button class="copy-btn" data-index="${index}">复制文案</button>` : ''}</td></tr>
  `).join('');
}
function appendResult(result) { renderResults([result, ...state.results]); }
async function copyText(text) { await navigator.clipboard.writeText(text); }
function csvEscape(value = '') { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportCsv() {
  if (!state.results.length) return alert('暂无可导出的结果');
  console.log('[douyin-transcript] CSV 导出开始');
  fetch('/api/log/csv-export', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ rowCount: state.results.length }) }).catch(() => {});
  const header = ['序号', '视频链接', '解析通道', '识别状态', '口播文案', '错误原因'];
  const rows = state.results.map((item, index) => [index + 1, item.videoLink, item.channel || 'failed', item.status, item.transcript, item.error]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const now = new Date(); const pad = (num) => String(num).padStart(2, '0');
  const filename = `douyin-transcripts-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  console.log('[douyin-transcript] CSV 导出成功');
}
function validateMediaFile(file) {
  const ok = /\.(mp4|mp3|wav|m4a)$/i.test(file.name || '');
  if (!ok) throw new Error('文件格式不支持，请上传 mp4 / mp3 / wav / m4a 文件。');
}
async function initAuth() {
  const data = await requestJson('/api/auth/status');
  if (!data.enabled) { appPanel.classList.remove('hidden'); return; }
  passwordPanel.classList.remove('hidden');
  if (state.password) {
    try { await requestJson('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: state.password }) }); passwordPanel.classList.add('hidden'); appPanel.classList.remove('hidden'); }
    catch { localStorage.removeItem('douyinTranscriptPassword'); state.password = ''; }
  }
}

$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const password = $('passwordInput').value; $('passwordError').textContent = '';
  try { state.password = password; await requestJson('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }); localStorage.setItem('douyinTranscriptPassword', password); passwordPanel.classList.add('hidden'); appPanel.classList.remove('hidden'); }
  catch (error) { state.password = ''; $('passwordError').textContent = error.message; }
});

$('singleButton').addEventListener('click', async () => {
  const button = $('singleButton'); setLoading(button, true, '正在提取...'); $('singleResult').textContent = '正在解析链接 → 下载视频 → 提取音频 → 识别口播...';
  try { const data = await requestJson('/api/transcribe/single', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('singleInput').value }) }); appendResult(data.result); $('singleResult').textContent = displayResultText(data.result); }
  catch (error) { $('singleResult').textContent = errorMessageWithPayload(error); }
  finally { setLoading(button, false); }
});

$('batchButton').addEventListener('click', async () => {
  const button = $('batchButton'); setLoading(button, true, '批量处理中...');
  try { const data = await requestJson('/api/transcribe/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('batchInput').value }) }); renderResults(data.results); }
  catch (error) { alert(errorMessageWithPayload(error)); }
  finally { setLoading(button, false); }
});

$('linkFileButton').addEventListener('click', async () => {
  const file = $('linkFile').files[0]; if (!file) return alert('请先选择 txt / csv / xlsx 文件');
  const button = $('linkFileButton'); setLoading(button, true, '文件处理中...'); const formData = new FormData(); formData.append('file', file);
  try { const data = await requestJson('/api/upload/links', { method: 'POST', body: formData }); renderResults(data.results); }
  catch (error) { alert(errorMessageWithPayload(error)); }
  finally { setLoading(button, false); }
});

$('mediaButton').addEventListener('click', async () => {
  const file = $('mediaFile').files[0]; if (!file) return alert('请先选择 mp4 / mp3 / wav / m4a 文件');
  try { validateMediaFile(file); } catch (error) { $('mediaResult').textContent = error.message; return; }
  const button = $('mediaButton'); setLoading(button, true, '上传识别中...'); $('mediaResult').textContent = '正在提取音频并调用 ASR...';
  const formData = new FormData(); formData.append('file', file);
  try { const data = await requestJson('/api/upload/media', { method: 'POST', body: formData }); appendResult(data.result); $('mediaResult').textContent = data.result.status === '成功' ? data.result.transcript : displayResultText(data.result); }
  catch (error) { $('mediaResult').textContent = errorMessageWithPayload(error); }
  finally { setLoading(button, false); }
});

$('manualButton').addEventListener('click', async () => {
  const button = $('manualButton'); setLoading(button, true, '整理中...'); $('manualResult').textContent = '正在调用文本模型整理文案...';
  try { const data = await requestJson('/api/transcript/polish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('manualInput').value }) }); $('manualOutput').value = data.transcript; $('manualResult').textContent = '整理完成，可点击一键复制。'; }
  catch (error) { $('manualResult').textContent = error.message; }
  finally { setLoading(button, false); }
});

$('manualCopyButton').addEventListener('click', async () => {
  if (!$('manualOutput').value.trim()) return alert('暂无可复制的整理结果');
  await copyText($('manualOutput').value); $('manualCopyButton').textContent = '已复制'; setTimeout(() => { $('manualCopyButton').textContent = '一键复制'; }, 1200);
});

resultBody.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-btn'); if (!button) return;
  const item = state.results[Number(button.dataset.index)]; await copyText(item.transcript || ''); button.textContent = '已复制'; setTimeout(() => { button.textContent = '复制文案'; }, 1200);
});
$('exportButton').addEventListener('click', exportCsv);
initAuth().catch((error) => { passwordPanel.classList.remove('hidden'); $('passwordError').textContent = error.message; });

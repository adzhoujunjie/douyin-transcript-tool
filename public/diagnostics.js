const state = { password: localStorage.getItem('douyinTranscriptPassword') || '' };
const $ = (id) => document.getElementById(id);
function authHeaders() { return state.password ? { 'x-app-password': state.password } : {}; }
function escapeHtml(value = '') { return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function boolText(value) { return value ? '是' : '否'; }
function render(diag) {
  const rows = [
    ['服务正常运行', boolText(diag.service.ok)], ['当前端口', diag.service.port], ['ffmpeg 是否安装', boolText(diag.dependencies.ffmpegInstalled)], ['yt-dlp 是否安装', boolText(diag.dependencies.ytDlpInstalled)], ['yt-dlp 版本', diag.dependencies.ytDlpVersion || '未检测到'], ['DOUYIN_COOKIES_FILE 是否配置', boolText(diag.douyin.cookiesFileConfigured)], ['DOUYIN_COOKIES_FILE 文件是否存在', boolText(diag.douyin.cookiesFileExists)], ['ASR_PROVIDER', diag.asr.provider], ['ASR_BASE_URL 是否配置', `${boolText(diag.asr.baseUrlConfigured)} ${diag.asr.baseUrlDomain || ''}`], ['ASR_MODEL', diag.asr.model || '未配置'], ['OPENAI_BASE_URL 是否配置', `${boolText(diag.openai.baseUrlConfigured)} ${diag.openai.baseUrlDomain || ''}`], ['OPENAI_MODEL', diag.openai.model || '未配置'], ['uploads 目录可写', boolText(diag.writable.uploads)], ['downloads 目录可写', boolText(diag.writable.downloads)], ['tmp 目录可写', boolText(diag.writable.tmp)], ['最近一次链接下载错误摘要', JSON.stringify(diag.recentErrors.lastDownloadError || null)], ['最近一次 ASR 错误摘要', JSON.stringify(diag.recentErrors.lastAsrError || null)]
  ];
  $('diagnosticsContent').innerHTML = rows.map(([k, v]) => `<div class="diag-key">${escapeHtml(k)}</div><div class="diag-value">${escapeHtml(v)}</div>`).join('');
}
async function loadDiagnostics() {
  $('diagnosticsStatus').textContent = '正在加载...';
  const res = await fetch('/api/diagnostics', { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { $('passwordBox').classList.remove('hidden'); $('diagnosticsStatus').textContent = data.error || '需要访问密码'; return; }
  if (!res.ok) throw new Error(data.error || '诊断加载失败');
  $('passwordBox').classList.add('hidden'); render(data.diagnostics); $('diagnosticsStatus').textContent = `更新时间：${data.diagnostics.service.timestamp}`;
}
$('diagnosticsPasswordForm').addEventListener('submit', async (e) => { e.preventDefault(); state.password = $('diagnosticsPassword').value; localStorage.setItem('douyinTranscriptPassword', state.password); try { await loadDiagnostics(); } catch (err) { $('diagnosticsPasswordError').textContent = err.message; } });
$('reloadButton').addEventListener('click', () => loadDiagnostics().catch((err) => { $('diagnosticsStatus').textContent = err.message; }));
loadDiagnostics().catch((err) => { $('diagnosticsStatus').textContent = err.message; });

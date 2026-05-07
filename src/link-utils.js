const DOUYIN_URL_REGEX = /https?:\/\/(?:www\.)?(?:douyin\.com|v\.douyin\.com)\/[^\s，。；;、]+/gi;
const VIDEO_ID_REGEXES = [
  /douyin\.com\/video\/(\d+)/i,
  /modal_id=(\d+)/i,
  /aweme_id=(\d+)/i,
  /video_id=(\d+)/i
];

export function normalizeUrl(url) {
  return url.replace(/[)）\]】>》"'“”‘’.,，。；;!！?？]+$/g, '');
}

export function extractDouyinLinks(text = '') {
  const matches = text.match(DOUYIN_URL_REGEX) || [];
  return [...new Set(matches.map(normalizeUrl))];
}

export function extractVideoId(url = '') {
  for (const regex of VIDEO_ID_REGEXES) {
    const match = url.match(regex);
    if (match?.[1]) return match[1];
  }
  return '';
}

export function isShortLink(url = '') {
  return /https?:\/\/v\.douyin\.com\//i.test(url);
}

export async function resolveDouyinUrl(url) {
  const cleanUrl = normalizeUrl(url);
  if (!isShortLink(cleanUrl)) {
    return { originalUrl: cleanUrl, finalUrl: cleanUrl, videoId: extractVideoId(cleanUrl) };
  }

  try {
    const response = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      }
    });
    const finalUrl = response.url || cleanUrl;
    return { originalUrl: cleanUrl, finalUrl, videoId: extractVideoId(finalUrl) };
  } catch (error) {
    throw new Error(`短链解析失败：${error.message}`);
  }
}

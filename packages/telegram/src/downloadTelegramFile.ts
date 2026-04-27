import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/** Telegram CDN / api.telegram.org; default global fetch (undici) uses ~10s connect — too short on slow networks. */
const TELEGRAM_FILE_DOWNLOAD_MS = 120_000;

type HttpModule = typeof https;

function getBuffer(u: URL, transport: HttpModule | typeof http): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = transport.request(
      u,
      {
        method: 'GET',
        timeout: TELEGRAM_FILE_DOWNLOAD_MS,
        headers: { 'User-Agent': 'Enzo-Telegram/1' },
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Telegram file download failed: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.setTimeout(TELEGRAM_FILE_DOWNLOAD_MS, () => {
      req.destroy();
      reject(new Error('Telegram file download timeout (socket idle)'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Download a file from Telegram’s file URL (api.telegram.org or DC hosts).
 * Uses Node’s http(s).request with a 120s cap instead of undici’s default ~10s connect timeout.
 */
export async function downloadUrlToBuffer(fileUrl: string): Promise<Buffer> {
  const u = new URL(fileUrl);
  if (u.protocol === 'https:') {
    return getBuffer(u, https);
  }
  if (u.protocol === 'http:') {
    return getBuffer(u, http);
  }
  throw new Error(`Unsupported file URL protocol: ${u.protocol}`);
}

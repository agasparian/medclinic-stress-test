/**
 * api/_lib/utils.js — общие утилиты для serverless-хэндлеров
 * Верификация Telegram initData + Google Service Account auth с кэшем токена
 */

import { createHmac, createSign } from 'node:crypto';

// ─── Спам-защита ──────────────────────────────────────────────────────────────

export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return expectedHash === hash;
}

// ─── Google Service Account auth (с кэшем на 1 час) ──────────────────────────

let _tokenCache = { token: null, expiresAt: 0 };

export async function getGoogleAccessToken() {
  // Возвращаем кэшированный токен, если он актуален (с запасом 60 сек)
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(sa.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  `${header}.${payload}.${signature}`,
    }),
  });

  const data = await res.json();
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + 3_600_000 };
  return data.access_token;
}

// ─── Shared constants ─────────────────────────────────────────────────────────

export const SHEET_ID = () => process.env.GOOGLE_SHEET_ID;

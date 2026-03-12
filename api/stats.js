/**
 * api/stats.js
 * Возвращает количество прохождений теста из Google Sheets.
 * Результат кэшируется в памяти на 5 минут.
 */

import { getGoogleAccessToken, SHEET_ID } from './_lib/utils.js';

const ORIGIN = 'https://medclinic-stress-test.vercel.app';

// Кэш: обновляем не чаще раза в 5 минут
let _cache = { count: null, expiresAt: 0 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    process.env.NODE_ENV === 'development' ? '*' : ORIGIN);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Отдаём кэш если актуален
  if (_cache.count !== null && Date.now() < _cache.expiresAt) {
    return res.status(200).json({ count: _cache.count });
  }

  try {
    const token = await getGoogleAccessToken();
    const range = encodeURIComponent('Прохождения!A:A');
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}`;
    const r     = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data  = await r.json();

    // Минус 1 строка заголовка
    const count = Math.max(0, (data.values?.length ?? 1) - 1);
    _cache = { count, expiresAt: Date.now() + 5 * 60_000 };

    return res.status(200).json({ count });
  } catch (err) {
    console.error('[stats] error:', err.message);
    // Не ломаем фронт — возвращаем null, фронт использует fallback
    return res.status(200).json({ count: null });
  }
}

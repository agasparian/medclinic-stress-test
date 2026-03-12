/**
 * api/lead.js
 * Стадия 2: пользователь заполнил форму (имя, телефон, клиника) → «Отправить».
 *
 * Если N8N_WEBHOOK_URL настроен (основной путь):
 *   - Личные данные (имя, телефон, клиника) отправляются только в n8n
 *   - n8n создаёт сделку в amoCRM (серверы РФ) и уведомляет команду в Telegram
 *   - В Google Sheets записывается только метка времени заявки (без личных данных)
 *
 * Если N8N_WEBHOOK_URL не настроен (fallback):
 *   - Старый путь: имя/телефон/клиника → Google Sheets столбцы N–Q
 *   - Уведомление команды в Telegram напрямую
 */

import { verifyTelegramInitData, getGoogleAccessToken, SHEET_ID } from './_lib/utils.js';

const SHEET_NAME = 'Прохождения';

// ─── Google Sheets helpers ────────────────────────────────────────────────────

async function findRowByUserId(userId, accessToken) {
  if (!userId) return null;
  const range = encodeURIComponent(`${SHEET_NAME}!B:B`);
  const res   = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(userId)) return i + 1;
  }
  return null;
}

/** Основной путь: записывает только метку времени в столбец N (без личных данных). */
async function markLeadSubmitted(rowNum, timestamp, accessToken) {
  const range = encodeURIComponent(`${SHEET_NAME}!N${rowNum}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}?valueInputOption=RAW`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [[timestamp]] }),
    }
  );
  if (!res.ok) throw new Error(`Sheets update failed: ${await res.text()}`);
}

/** Fallback: обновляет столбцы N–Q (дата, имя, телефон, клиника). */
async function updateLeadColumns(rowNum, values, accessToken) {
  const range = encodeURIComponent(`${SHEET_NAME}!N${rowNum}:Q${rowNum}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}?valueInputOption=RAW`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [values] }),
    }
  );
  if (!res.ok) throw new Error(`Sheets update failed: ${await res.text()}`);
}

/** Fallback: создаёт полную строку (edge case — пользователь не проходил тест). */
async function appendFullRow(values, accessToken) {
  const range = encodeURIComponent(`${SHEET_NAME}!A:A`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [values] }),
    }
  );
  if (!res.ok) throw new Error(`Sheets append failed: ${await res.text()}`);
}

// ─── Telegram (fallback) ──────────────────────────────────────────────────────

const LEVEL_EMOJI = { good: '🟢', moderate: '🟡', high: '🔴', critical: '⛔' };
const LEVEL_TEXT  = { good: 'ХОРОШИЙ УРОВЕНЬ', moderate: 'УМЕРЕННЫЙ РИСК', high: 'ВЫСОКИЙ РИСК', critical: 'КРИТИЧЕСКИЙ РИСК' };
const BLOCK_ICONS = { channels: '📡', budget: '💰', seo: '🔍', geo: '📍', base: '👥', analytics: '📊' };
const BLOCK_NAMES = { channels: 'Каналы', budget: 'Бюджет', seo: 'SEO', geo: 'Карты', base: 'База пациентов', analytics: 'Аналитика' };
const BLOCK_MAX   = { channels: 20, budget: 20, seo: 20, geo: 15, base: 15, analytics: 10 };

function buildLeadNotification(d) {
  const emoji = LEVEL_EMOJI[d.level] || '⚪';
  const title = LEVEL_TEXT[d.level]  || d.level;
  const tgRef = d.tg_username
    ? `@${d.tg_username}`
    : d.tg_user_id ? `<a href="tg://user?id=${d.tg_user_id}">${d.name || 'пользователь'}</a>` : '—';
  const blockLines = Object.entries(d.blocks || {})
    .map(([k, v]) => `  ${BLOCK_ICONS[k] || '•'} ${BLOCK_NAMES[k] || k}: ${v}/${BLOCK_MAX[k] || '?'}`)
    .join('\n');
  const ts = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  return `🔥 <b>ТЁПЛЫЙ ЛИД</b>

👤 ${d.name || '—'} / ${tgRef}
📞 ${d.phone || '—'}
${d.clinic ? `🏥 ${d.clinic}` : ''}
📊 Балл: <b>${d.score ?? '?'}/100</b> — ${emoji} ${title}
🚩 Флаги: ${(d.flags || []).join(', ') || '—'}

<b>Детали:</b>
${blockLines}

🕐 ${ts}`;
}

async function sendTgMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    process.env.NODE_ENV === 'development' ? '*' : 'https://medclinic-stress-test.vercel.app');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const initData = req.headers['x-telegram-init-data'] || '';
  if (process.env.NODE_ENV !== 'development' && !verifyTelegramInitData(initData, process.env.BOT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const d = req.body;
  if (!d || !d.phone) return res.status(400).json({ error: 'Missing phone' });

  const now    = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
  const n8nUrl = process.env.N8N_WEBHOOK_URL;

  if (n8nUrl) {
    // ─── Основной путь: личные данные только в n8n → amoCRM (РФ) ────────────
    const tasks = [

      // 1. Отправить лид в n8n (amoCRM + Telegram уведомление на стороне n8n)
      fetch(n8nUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        d.name        ?? '',
          phone:       d.phone       ?? '',
          clinic:      d.clinic      ?? '',
          score:       d.score       ?? null,
          level:       d.level       ?? '',
          flags:       d.flags       ?? [],
          blocks:      d.blocks      ?? {},
          tg_user_id:  d.tg_user_id  ?? null,
          tg_username: d.tg_username ?? '',
          timestamp:   now,
        }),
      }).then(r => { if (!r.ok) throw new Error(`n8n webhook failed: ${r.status}`); }),

      // 2. Пометить строку в Sheets: только дата заявки, без личных данных
      getGoogleAccessToken().then(async token => {
        const rowNum = await findRowByUserId(d.tg_user_id, token);
        if (rowNum) await markLeadSubmitted(rowNum, now, token);
        // edge case (нет строки): не пишем ничего, личные данные за рубеж не уходят
      }),
    ];

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[lead/n8n] ${['n8n webhook', 'Sheets mark'][i]} failed:`, r.reason);
      }
    });

  } else {
    // ─── Fallback: старый путь без n8n (Sheets + Telegram напрямую) ──────────
    const leadValues = [now, d.name ?? '', d.phone ?? '', d.clinic ?? ''];

    const tasks = [
      getGoogleAccessToken().then(async token => {
        const rowNum = await findRowByUserId(d.tg_user_id, token);
        if (rowNum) {
          await updateLeadColumns(rowNum, leadValues, token);
        } else {
          const b = d.blocks || {};
          await appendFullRow([
            now,
            d.tg_user_id  ?? '',
            d.tg_username ?? '',
            '',
            d.score       ?? '',
            d.level       ?? '',
            (d.flags || []).join(', '),
            b.channels  ?? '',
            b.budget    ?? '',
            b.seo       ?? '',
            b.geo       ?? '',
            b.base      ?? '',
            b.analytics ?? '',
            ...leadValues,
          ], token);
        }
      }),

      process.env.LEADS_CHAT_ID && process.env.BOT_TOKEN
        ? sendTgMessage(
            process.env.LEADS_CHAT_ID,
            buildLeadNotification(d),
            d.tg_user_id ? {
              inline_keyboard: [[{ text: '💬 Написать в Telegram', url: `tg://user?id=${d.tg_user_id}` }]],
            } : null,
          )
        : Promise.resolve(),
    ];

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[lead] ${['Sheets', 'TG notify'][i]} failed:`, r.reason);
      }
    });
  }

  return res.status(200).json({ ok: true });
}

/**
 * api/lead.js
 * Стадия 2: пользователь заполнил форму (имя, телефон, клиника) → «Отправить».
 * Находит строку пользователя в Sheets по tg_user_id и дописывает столбцы N–Q.
 * Если строка не найдена — добавляет новую (edge case: открыл форму без теста).
 * Уведомляет команду в Telegram-группу.
 * Zapier видит заполненный столбец P (Телефон) → создаёт сделку в amoCRM.
 */

import { verifyTelegramInitData, getGoogleAccessToken, SHEET_ID } from './_lib/utils.js';

// ─── Google Sheets helpers ────────────────────────────────────────────────────

const SHEET_NAME = 'Прохождения';

/**
 * Находит номер строки (1-based) по значению tg_user_id в столбце B.
 * Возвращает null если не найдено.
 */
async function findRowByUserId(userId, accessToken) {
  if (!userId) return null;
  const range = encodeURIComponent(`${SHEET_NAME}!B:B`);
  const res   = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const rows = data.values || [];
  // rows[0] = заголовок, пропускаем. Ищем с конца — берём ПОСЛЕДНИЙ результат пользователя
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(userId)) {
      return i + 1;  // Sheets использует 1-based индекс
    }
  }
  return null;
}

/**
 * Обновляет столбцы N–Q в найденной строке (дата заявки, имя, телефон, клиника).
 */
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

/**
 * Добавляет полную строку (edge case: пользователь не проходил тест или не авторизован).
 */
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

// ─── Telegram ────────────────────────────────────────────────────────────────

const LEVEL_EMOJI = { good: '🟢', moderate: '🟡', high: '🔴', critical: '⛔' };
const LEVEL_TEXT  = { good: 'ХОРОШИЙ УРОВЕНЬ', moderate: 'УМЕРЕННЫЙ РИСК', high: 'ВЫСОКИЙ РИСК', critical: 'КРИТИЧЕСКИЙ РИСК' };
const BLOCK_ICONS = { channels: '📡', budget: '💰', seo: '🔍', geo: '📍', base: '👥', analytics: '📊' };
const BLOCK_MAX   = { channels: 20, budget: 20, seo: 20, geo: 15, base: 15, analytics: 10 };

function buildLeadNotification(d) {
  const emoji = LEVEL_EMOJI[d.level] || '⚪';
  const title = LEVEL_TEXT[d.level]  || d.level;
  const tgRef = d.tg_username
    ? `@${d.tg_username}`
    : d.tg_user_id ? `<a href="tg://user?id=${d.tg_user_id}">${d.name || 'пользователь'}</a>` : '—';
  const blockLines = Object.entries(d.blocks || {})
    .map(([k, v]) => `  ${BLOCK_ICONS[k] || '•'} ${k}: ${v}/${BLOCK_MAX[k] || '?'}`)
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

  const now        = new Date().toISOString();
  const leadValues = [now, d.name ?? '', d.phone ?? '', d.clinic ?? ''];  // N, O, P, Q

  const results = await Promise.allSettled([

    // 1. Google Sheets: найти строку → дописать N–Q, или создать новую
    getGoogleAccessToken().then(async (token) => {
      const rowNum = await findRowByUserId(d.tg_user_id, token);
      if (rowNum) {
        // Нашли строку Стадии 1 — дописываем поля лида
        await updateLeadColumns(rowNum, leadValues, token);
      } else {
        // Не нашли (edge case) — создаём полную строку
        const blocksObj = d.blocks || {};
        const fullRow = [
          now,
          d.tg_user_id   ?? '',
          d.tg_username  ?? '',
          '',  // first_name неизвестен
          d.score        ?? '',
          d.level        ?? '',
          (d.flags || []).join(', '),
          blocksObj.channels  ?? '',
          blocksObj.budget    ?? '',
          blocksObj.seo       ?? '',
          blocksObj.geo       ?? '',
          blocksObj.base      ?? '',
          blocksObj.analytics ?? '',
          ...leadValues,  // N–Q сразу
        ];
        await appendFullRow(fullRow, token);
      }
    }),

    // 2. Уведомление команды в Telegram-группу (с кнопкой «Написать» лиду)
    process.env.LEADS_CHAT_ID && process.env.BOT_TOKEN
      ? sendTgMessage(
          process.env.LEADS_CHAT_ID,
          buildLeadNotification(d),
          d.tg_user_id ? {
            inline_keyboard: [[{
              text: '💬 Написать в Telegram',
              url: `tg://user?id=${d.tg_user_id}`,
            }]],
          } : null,
        )
      : Promise.resolve(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[lead] ${['Sheets', 'TG notify'][i]} failed:`, r.reason);
    }
  });

  return res.status(200).json({ ok: true });
}

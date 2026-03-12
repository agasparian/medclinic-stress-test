/**
 * api/lead.js
 * Стадия 2: пользователь заполнил форму (имя, телефон, клиника) → «Отправить».
 *
 * Если AMO_TOKEN + AMO_DOMAIN настроены:
 *   - Создаёт контакт и сделку в amoCRM (хранение в РФ)
 *   - В Google Sheets записывается только метка времени (без личных данных)
 *
 * Если AMO_TOKEN не настроен (fallback):
 *   - Старый путь: имя/телефон/клиника → Google Sheets столбцы N–Q
 *
 * В обоих случаях: уведомление команды в Telegram.
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

/** Основной путь: только метка времени в столбец N, без личных данных. */
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

/** Fallback: создаёт полную строку (edge case). */
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

// ─── amoCRM helpers ───────────────────────────────────────────────────────────

const AMO_LEVEL_TEXT = {
  good:     'Хороший уровень',
  moderate: 'Умеренный риск',
  high:     'Высокий риск',
  critical: 'Критический риск',
};

async function amoRequest(path, body, token, domain) {
  const res = await fetch(`https://${domain}.amocrm.ru${path}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`amoCRM ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function createAmoContactAndLead(d, token, domain) {
  // 1. Создать контакт
  const contactData = await amoRequest('/api/v4/contacts', [{
    name: d.name || 'Без имени',
    custom_fields_values: [{
      field_code: 'PHONE',
      values: [{ value: d.phone, enum_code: 'WORK' }],
    }],
  }], token, domain);
  const contactId = contactData._embedded?.contacts?.[0]?.id;

  // 2. Создать сделку, привязанную к контакту
  const leadName  = `Стресс-тест: ${d.clinic || d.name || 'клиника'}`;
  const levelText = AMO_LEVEL_TEXT[d.level] || d.level || '';
  const leadBody  = [{
    name: leadName,
    _embedded: {
      contacts: contactId ? [{ id: contactId }] : [],
      tags:     levelText ? [{ name: levelText }] : [],
    },
  }];
  const leadData = await amoRequest('/api/v4/leads', leadBody, token, domain);
  const leadId   = leadData._embedded?.leads?.[0]?.id;

  // 3. Добавить примечание со всеми данными теста
  if (leadId) {
    const b = d.blocks || {};
    const noteText = [
      `Балл: ${d.score ?? '—'}/100 · ${levelText}`,
      `Флаги: ${(d.flags || []).join(', ') || '—'}`,
      `Каналы: ${b.channels ?? '—'}/20 · Бюджет: ${b.budget ?? '—'}/20 · SEO: ${b.seo ?? '—'}/20`,
      `Карты: ${b.geo ?? '—'}/15 · База: ${b.base ?? '—'}/15 · Аналитика: ${b.analytics ?? '—'}/10`,
      `Telegram: ${d.tg_username ? '@' + d.tg_username : (d.tg_user_id || '—')}`,
      d.clinic ? `Клиника: ${d.clinic}` : '',
    ].filter(Boolean).join('\n');

    await amoRequest(`/api/v4/leads/${leadId}/notes`, [{
      note_type: 'common',
      params:    { text: noteText },
    }], token, domain).catch(err => {
      console.warn('[lead/amo] note failed (non-critical):', err.message);
    });
  }

  return { contactId, leadId };
}

// ─── Telegram notification ────────────────────────────────────────────────────

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

  const now      = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
  const amoToken = process.env.AMO_TOKEN;
  const amoDomain = process.env.AMO_DOMAIN;

  const tasks = [];

  if (amoToken && amoDomain) {
    // ─── Основной путь: личные данные только в amoCRM (РФ) ───────────────────

    // 1. amoCRM: контакт + сделка
    tasks.push(
      createAmoContactAndLead(d, amoToken, amoDomain)
        .then(({ contactId, leadId }) => {
          console.log(`[lead/amo] contact=${contactId} lead=${leadId}`);
        })
    );

    // 2. Google Sheets: только метка времени, без личных данных
    tasks.push(
      getGoogleAccessToken().then(async token => {
        const rowNum = await findRowByUserId(d.tg_user_id, token);
        if (rowNum) await markLeadSubmitted(rowNum, now, token);
      })
    );

  } else {
    // ─── Fallback: старый путь (личные данные в Sheets) ──────────────────────
    const leadValues = [now, d.name ?? '', d.phone ?? '', d.clinic ?? ''];
    tasks.push(
      getGoogleAccessToken().then(async token => {
        const rowNum = await findRowByUserId(d.tg_user_id, token);
        if (rowNum) {
          await updateLeadColumns(rowNum, leadValues, token);
        } else {
          const b = d.blocks || {};
          await appendFullRow([
            now, d.tg_user_id ?? '', d.tg_username ?? '', '',
            d.score ?? '', d.level ?? '', (d.flags || []).join(', '),
            b.channels ?? '', b.budget ?? '', b.seo ?? '',
            b.geo ?? '', b.base ?? '', b.analytics ?? '',
            ...leadValues,
          ], token);
        }
      })
    );
  }

  // 3. Telegram уведомление команде (всегда, если настроено)
  if (process.env.LEADS_CHAT_ID && process.env.BOT_TOKEN) {
    tasks.push(
      sendTgMessage(
        process.env.LEADS_CHAT_ID,
        buildLeadNotification(d),
        d.tg_user_id ? {
          inline_keyboard: [[{ text: '💬 Написать в Telegram', url: `tg://user?id=${d.tg_user_id}` }]],
        } : null,
      )
    );
  }

  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[lead] task[${i}] failed:`, r.reason?.message || r.reason);
    }
  });

  return res.status(200).json({ ok: true });
}

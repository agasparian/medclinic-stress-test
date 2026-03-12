/**
 * api/save-result.js
 * Стадия 1: срабатывает когда экран результата загрузился.
 * Сохраняет прохождение в Google Sheets + отправляет результат пользователю в Telegram.
 */

import { verifyTelegramInitData, getGoogleAccessToken, SHEET_ID } from './_lib/utils.js';

// ─── Google Sheets helpers ────────────────────────────────────────────────────

async function appendToSheet(sheetName, values, accessToken) {
  const range = encodeURIComponent(`${sheetName}!A:A`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ values: [values] }),
    }
  );
  if (!res.ok) throw new Error(`Sheets append failed: ${await res.text()}`);
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

const LEVEL_EMOJI = { good: '🟢', moderate: '🟡', high: '🔴', critical: '⛔' };
const LEVEL_TEXT  = { good: 'ХОРОШИЙ УРОВЕНЬ', moderate: 'УМЕРЕННЫЙ РИСК', high: 'ВЫСОКИЙ РИСК', critical: 'КРИТИЧЕСКИЙ РИСК' };
const BLOCK_ICONS = { channels: '📡', budget: '💰', seo: '🔍', geo: '📍', base: '👥', analytics: '📊' };
const BLOCK_NAMES = { channels: 'Каналы', budget: 'Бюджет', seo: 'SEO', geo: 'Карты', base: 'База пациентов', analytics: 'Аналитика' };
const BLOCK_MAX   = { channels: 20, budget: 20, seo: 20, geo: 15, base: 15, analytics: 10 };
const PROBLEM_TEXTS = {
  channels:  'Вы зависите от 1–2 каналов. Если один закроется — поток пациентов рухнет',
  budget:    'Весь бюджет в платной рекламе. При росте ставок ещё на 30% — CPL вырастет пропорционально',
  seo:       'Агрегаторы занимают вашу выдачу. Вы платите за трафик, который мог быть бесплатным',
  geo:       'Яндекс.Карты — канал №1 по звонкам. Неактивный профиль = потеря бесплатных обращений',
  base:      'База пациентов не работает. Повторный визит стоит в 5–7× дешевле нового привлечения',
  analytics: 'Без call-tracking вы не видите 40–60% обращений. Решения принимаются вслепую',
};

function buildUserResultMessage(d) {
  const emoji = LEVEL_EMOJI[d.level] || '⚪';
  const title = LEVEL_TEXT[d.level]  || d.level;

  const riskLines = Object.entries(d.blocks || {}).map(([key, score]) => {
    const max = BLOCK_MAX[key] || '?';
    const pct = max ? (score / max) * 100 : 0;
    const flag = pct === 0 ? ' 🔴' : pct < 50 ? ' ⚠️' : '';
    return `${BLOCK_ICONS[key] || '•'} ${BLOCK_NAMES[key] || key}: ${score}/${max}${flag}`;
  }).join('\n');

  const topProblems = Object.entries(d.blocks || {})
    .map(([key, score]) => ({ key, gap: (BLOCK_MAX[key] || 0) - score }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .filter(p => p.gap > 0)
    .map((p, i) => `${i + 1}. ${PROBLEM_TEXTS[p.key] || p.key}`)
    .join('\n');

  return `📊 <b>Ваш результат стресс-теста маркетинга</b>

<b>${d.score ?? '?'} / 100</b> — ${emoji} ${title}
Средний по нише: 61/100 · Callibri, 605 клиник

<b>Карта рисков:</b>
${riskLines}

${topProblems ? `<b>⚡ Что исправить в первую очередь:</b>\n${topProblems}\n` : ''}Чтобы получить детальный план усиления — нажмите кнопку ниже 👇`;
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

  // Спам-защита: проверяем initData только в продакшене
  const initData = req.headers['x-telegram-init-data'] || '';
  if (process.env.NODE_ENV !== 'development' && !verifyTelegramInitData(initData, process.env.BOT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const d = req.body;
  if (!d || typeof d.score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const blocksObj = d.blocks || {};
  const now = new Date().toISOString();

  // Строка для листа «Прохождения»
  const sheetsRow = [
    now,
    d.tg_user_id   ?? '',
    d.tg_username  ?? '',
    d.first_name   ?? '',
    d.score        ?? '',
    d.level        ?? '',
    (d.flags || []).join(', '),
    blocksObj.channels  ?? '',
    blocksObj.budget    ?? '',
    blocksObj.seo       ?? '',
    blocksObj.geo       ?? '',
    blocksObj.base      ?? '',
    blocksObj.analytics ?? '',
  ];

  const results = await Promise.allSettled([
    // 1. Сохранить в Google Sheets
    getGoogleAccessToken().then(token => appendToSheet('Прохождения', sheetsRow, token)),

    // 2. Отправить результат пользователю в Telegram (с кнопкой возврата в приложение)
    d.tg_user_id && process.env.BOT_TOKEN
      ? sendTgMessage(d.tg_user_id, buildUserResultMessage(d), {
          inline_keyboard: [[{
            text: '📱 Открыть приложение',
            web_app: { url: process.env.WEBAPP_URL || 'https://medclinic-stress-test.vercel.app' },
          }]],
        })
      : Promise.resolve(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[save-result] ${['Sheets', 'TG message'][i]} failed:`, r.reason);
    }
  });

  return res.status(200).json({ ok: true });
}

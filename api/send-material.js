/**
 * api/send-material.js
 * Отправляет PDF-материал пользователю в Telegram после проверки подписки на канал.
 */

import { verifyTelegramInitData } from './_lib/utils.js';

const CHANNEL = '@medsprint';

async function getChatMemberStatus(userId) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember` +
              `?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${userId}`;
  const r    = await fetch(url);
  const data = await r.json();
  if (!data.ok) throw new Error(data.description);
  return data.result?.status;
}

async function sendDocument(chatId, fileId, caption) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:  chatId,
      document: fileId,
      caption,
      parse_mode: 'HTML',
    }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    process.env.NODE_ENV === 'development' ? '*' : 'https://medclinic-stress-test.vercel.app');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const initData = req.headers['x-telegram-init-data'] || '';
  const isDev    = process.env.NODE_ENV === 'development';

  if (!isDev && !verifyTelegramInitData(initData, process.env.BOT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tg_user_id } = req.body;
  if (!tg_user_id) return res.status(400).json({ error: 'Missing tg_user_id' });

  const fileId = process.env.MATERIAL_FILE_ID;
  if (!fileId) return res.status(500).json({ error: 'MATERIAL_FILE_ID not configured' });

  // Dev-режим: просто подтверждаем без реальной отправки
  if (isDev && !process.env.BOT_TOKEN) {
    return res.status(200).json({ ok: true, dev: true });
  }

  // Повторно проверяем подписку на сервере (защита от обхода на клиенте)
  const status     = await getChatMemberStatus(tg_user_id);
  const subscribed = ['member', 'administrator', 'creator'].includes(status);
  if (!subscribed) {
    return res.status(403).json({ error: 'Not subscribed' });
  }

  await sendDocument(
    tg_user_id,
    fileId,
    '🗺️ <b>Карта каналов привлечения пациентов 2025</b>\n\nДанные 605 клиник — МедСпринт',
  );

  return res.status(200).json({ ok: true });
}

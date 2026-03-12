/**
 * api/check-sub.js
 * Проверяет, подписан ли пользователь на канал @medsprint.
 * Бот должен быть администратором канала — иначе getChatMember вернёт ошибку.
 */

import { verifyTelegramInitData } from './_lib/utils.js';

const CHANNEL = '@medsprint';

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

  // В dev-режиме без реального Telegram — сразу возвращаем subscribed
  if (isDev && !process.env.BOT_TOKEN) {
    return res.status(200).json({ subscribed: true, dev: true });
  }

  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember` +
              `?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${tg_user_id}`;

  const r    = await fetch(url);
  const data = await r.json();

  if (!data.ok) {
    console.error('[check-sub] getChatMember error:', data.description);
    return res.status(200).json({ subscribed: false, error: data.description });
  }

  const status     = data.result?.status;
  const subscribed = ['member', 'administrator', 'creator'].includes(status);

  return res.status(200).json({ subscribed });
}

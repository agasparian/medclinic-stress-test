# BACKEND-PLAN.md — Backend под ключ (v2)
## Стресс-тест маркетинга клиники / МедСпринт

**Дата:** 2026-03-11
**Стек:** Vercel Serverless (Node.js 20), Telegram Bot API, Google Sheets API v4
**amoCRM:** через Zapier (Google Sheets → amoCRM) — без прямой интеграции по API

---

## 0. Почему Google Sheets, а не amoCRM напрямую

| | Google Sheets + Zapier | amoCRM API v4 напрямую |
|---|---|---|
| Токен | Service Account — вечный | Access token 24ч, нужен refresh |
| Хранение токена | Env var, не меняется | Нужен Vercel KV или Redis |
| Дедупликация | Не нужна (Zapier делает) | Нужна кастомная логика |
| Стоимость | Бесплатно | Vercel KV ~$0, Zapier $20/мес |
| Сложность | Низкая | Высокая |

**Решение:** Google Sheets — основное хранилище. amoCRM получает лиды через Zapier-триггер на обновление строки в листе «Прохождения» — без единой строки кода.

---

## 1. Архитектура: два события, два endpoint

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
СТАДИЯ 1 — Автоматически при загрузке экрана результата
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[screen-result загружается]
         │
         │ POST /api/save-result
         │ Header: X-Telegram-Init-Data: {tg.initData}
         │ Body: { tg_user_id, tg_username, first_name, score, level, flags, blocks }
         ▼
[Vercel: api/save-result.js]
         │ ① Проверка HMAC initData (спам-защита)
         │
    ┌────┴──────────────────────────┐
    ▼                               ▼
[Google Sheets]              [Telegram Bot API]
Лист «Прохождения»           sendMessage(tg_user_id)
Все прошедшие тест           Результат + карта рисков
(TG данные + скор)           в чат пользователя


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
СТАДИЯ 2 — Форма: имя + телефон + клиника → Submit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Пользователь нажимает «Отправить»]
         │
         │ POST /api/lead
         │ Header: X-Telegram-Init-Data: {tg.initData}
         │ Body: { name, phone, clinic, tg_user_id, score, level, flags, blocks }
         ▼
[Vercel: api/lead.js]
         │ ① Проверка HMAC initData (спам-защита)
         │
    ┌────┴──────────────────────────────────────┐
    │                                           │
    ▼                                           ▼
[Google Sheets]                        [Telegram Bot API]
Лист «Прохождения»                     sendMessage(LEADS_CHAT_ID)
Дописывает поля N–Q (телефон, имя…)    Карточка лида в группу команды
         │
         ▼
    [Zapier]  ← триггер: обновление строки, фильтр «Телефон не пуст»
         │
         ▼
    [amoCRM]  ← создаёт сделку + контакт
```

---

## 2. Google Sheets — структура данных

**Один лист «Прохождения».** Стадия 1 создаёт строку. Стадия 2 находит её по TG User ID и дописывает столбцы N–Q.

| Столбец | Заполняется | Источник | Пример |
|---|---|---|---|
| A: Дата теста | Стадия 1 | server timestamp | 2026-03-11T12:00:00Z |
| B: TG User ID | Стадия 1 | `tg.initDataUnsafe.user.id` | 123456789 |
| C: TG Username | Стадия 1 | `tg.initDataUnsafe.user.username` | anna_clinic |
| D: Имя (TG) | Стадия 1 | `tg.initDataUnsafe.user.first_name` | Анна |
| E: Балл | Стадия 1 | `scoreResult.total` | 38 |
| F: Уровень | Стадия 1 | `scoreResult.level` | high |
| G: Флаги | Стадия 1 | `scoreResult.flags.join(', ')` | BUDGET_RISK, MONOCHANNEL |
| H: Каналы | Стадия 1 | `blocks.channels` | 6 |
| I: Бюджет | Стадия 1 | `blocks.budget` | 0 |
| J: SEO | Стадия 1 | `blocks.seo` | 8 |
| K: GEO | Стадия 1 | `blocks.geo` | 8 |
| L: База | Стадия 1 | `blocks.base` | 3 |
| M: Аналитика | Стадия 1 | `blocks.analytics` | 2 |
| N: Дата заявки | Стадия 2 | server timestamp | 2026-03-11T12:05:00Z |
| O: Имя (форма) | Стадия 2 | `input-name` | Анна Петрова |
| P: Телефон | Стадия 2 | `input-phone` | +7 (999) 123-45-67 |
| Q: Клиника | Стадия 2 | `input-clinic` | Клиника Здоровье |

**Как читать таблицу:**
- Строки с пустыми N–Q = прошли тест, форму не заполнили (холодный контакт)
- Строки с заполненными N–Q = тёплые лиды (на них настраивать Zapier → amoCRM)
- Фильтр «Телефон не пусто» = ваша воронка

**Логика Стадии 2 в `api/lead.js`:**
1. Получить значения столбца B (`GET /values/Прохождения!B:B`)
2. Найти строку где `B = tg_user_id`
3. Если нашли → `PUT /values/Прохождения!N{row}:Q{row}` (дописать 4 поля)
4. Если не нашли (пользователь открыл форму в браузере без теста) → `append` полной строки

---

## 3. Переменные окружения (Vercel Dashboard)

| Переменная | Что это | Где взять |
|---|---|---|
| `BOT_TOKEN` | Уже есть | — |
| `LEADS_CHAT_ID` | ID Telegram-группы команды | Добавить бота в группу → `/getUpdates` → `chat.id` |
| `GOOGLE_SHEET_ID` | ID таблицы из URL | `docs.google.com/spreadsheets/d/**{ID}**/edit` |
| `GOOGLE_SERVICE_ACCOUNT` | JSON ключ Service Account | Google Cloud Console (см. раздел 5) |
| `WEBAPP_URL` | URL Mini App для кнопки в боте | `https://medclinic-stress-test.vercel.app/tg-app/index.html` |

**Итого: 5 переменных.** `GOOGLE_SERVICE_ACCOUNT` — JSON строка целиком (без переносов строк).

---

## 4. Спам-защита: верификация Telegram initData (HMAC)

Telegram подписывает `initData` при каждом открытии Mini App с помощью `BOT_TOKEN`.
Никакой сторонний бот или скрипт не может подделать валидную подпись без знания токена.

**Алгоритм проверки (официальная документация Telegram):**

```javascript
import { createHmac } from 'node:crypto';

/**
 * Проверяет подпись initData от Telegram.
 * @param {string} initData — строка tg.initData из Mini App
 * @param {string} botToken — BOT_TOKEN
 * @returns {boolean}
 */
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  // Строим строку для проверки: все параметры кроме hash, отсортированные
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // Секретный ключ = HMAC-SHA256("WebAppData", botToken)
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Ожидаемый хэш
  const expectedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return expectedHash === hash;
}
```

Использование в каждом endpoint:

```javascript
export default async function handler(req, res) {
  const initData = req.headers['x-telegram-init-data'] || '';

  // В dev (vercel dev локально) — проверка отключена, в остальных случаях — активна
  if (process.env.NODE_ENV !== 'development' && !verifyTelegramInitData(initData, process.env.BOT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ... основная логика
}
```

**Фронтенд (app.js) — добавить заголовок к обоим запросам:**
```javascript
headers: {
  'Content-Type': 'application/json',
  'X-Telegram-Init-Data': tg.initData || '',
}
```

---

## 5. Google Sheets API — настройка (один раз)

### Шаг 1: Google Cloud Console

1. Зайти на [console.cloud.google.com](https://console.cloud.google.com)
2. Создать проект (или использовать существующий)
3. Включить: **APIs & Services → Enable APIs → Google Sheets API**
4. Перейти в **IAM & Admin → Service Accounts → Create Service Account**
5. Имя: `medclinic-sheets-writer`, роль не назначать
6. Нажать на созданный аккаунт → **Keys → Add Key → JSON** → скачать файл

### Шаг 2: Google Sheets

1. Создать таблицу [sheets.google.com](https://sheets.google.com)
2. Переименовать лист: «Прохождения»
3. Добавить заголовки строк (A1:Q1 по таблице из раздела 2)
4. **Share → добавить email Service Account** (вида `name@project.iam.gserviceaccount.com`) с правами «Редактор»
5. Скопировать ID из URL таблицы → в `GOOGLE_SHEET_ID`

### Шаг 3: Vercel env var

Взять содержимое скачанного JSON файла, убрать переносы строк:
```bash
# В терминале (macOS/Linux):
cat service-account.json | tr -d '\n'
```
Скопировать результат → вставить как значение переменной `GOOGLE_SERVICE_ACCOUNT`.

---

## 5.5. Общие утилиты: `api/_lib/utils.js`

Обе функции нужны в двух файлах — выносим в один модуль. Кэш токена здесь особенно важен: при повторных вызовах (тёплый инстанс Vercel) токен возвращается из памяти без HTTP-запроса к Google.

```javascript
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

// ID таблицы — единая точка для всех Sheets-запросов
export const SHEET_ID = () => process.env.GOOGLE_SHEET_ID;
```

---

## 6. Реализация: `api/save-result.js` (Стадия 1)

```javascript
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
    return `${BLOCK_ICONS[key] || '•'} ${key}: ${score}/${max}${flag}`;
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

${topProblems ? `<b>⚡ Что исправить в первую очередь:</b>\n${topProblems}\n` : ''}
Чтобы получить детальный план усиления — нажмите кнопку ниже 👇`;
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
      ? sendTgMessage(d.tg_user_id, buildUserResultMessage(d),
          process.env.WEBAPP_URL ? {
            inline_keyboard: [[{
              text: '📱 Открыть приложение',
              web_app: { url: process.env.WEBAPP_URL },
            }]],
          } : null)
      : Promise.resolve(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[save-result] ${['Sheets', 'TG message'][i]} failed:`, r.reason);
    }
  });

  return res.status(200).json({ ok: true });
}
```

---

## 7. Реализация: `api/lead.js` (Стадия 2)

```javascript
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
```

---

## 8. Изменения во фронтенде

### `tg-app/app.js` — 2 изменения

**Изменение 1:** В функции `goToResult()` — добавить авто-сохранение после перехода на экран результата:

```javascript
function goToResult() {
  goTo('screen-result');
  hideBackBtn();
  renderResult(state.scoreResult);

  // НОВОЕ: Стадия 1 — сохранить прохождение, отправить результат в Telegram
  // Fire-and-forget: не блокирует UI, ошибки не видны пользователю
  if (tg.initData && !state.resultSaved) {  // только один раз внутри Telegram
    state.resultSaved = true;  // предотвращаем дубли при возврате на экран результата
    const r = state.scoreResult;
    fetch('/api/save-result', {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Telegram-Init-Data':   tg.initData,
      },
      body: JSON.stringify({
        tg_user_id:  tg.initDataUnsafe?.user?.id       ?? null,
        tg_username: tg.initDataUnsafe?.user?.username  ?? null,
        first_name:  tg.initDataUnsafe?.user?.first_name ?? null,
        score:       r.total,
        level:       r.level,
        flags:       r.flags,
        blocks:      Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => [k, v.score])),
      }),
    }).catch(() => {});  // игнорируем ошибки — UX не должен страдать
  }

  setMainBtn('Получить план усиления — бесплатно', () => {
    goTo('screen-contacts');
    initContactForm();
  });
}
```

**Изменение 2:** В функции `submitForm()` — добавить заголовок и поле clinic:

```javascript
async function submitForm() {
  const phone = document.getElementById('input-phone').value.replace(/\D/g, '');
  if (phone.length < 11 || !state.consentChecked) return;

  tg.MainButton.showProgress?.();
  tg.MainButton.disable();
  disableFallbackBtn();

  try {
    const r = state.scoreResult;
    const payload = {
      name:        document.getElementById('input-name').value.trim(),
      phone:       document.getElementById('input-phone').value.trim(),
      clinic:      document.getElementById('input-clinic')?.value.trim() || null,
      score:       r?.total    ?? null,
      level:       r?.level    ?? null,
      flags:       r?.flags    ?? [],
      blocks:      r?.blocks ? Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => [k, v.score])) : {},
      tg_user_id:  tg.initDataUnsafe?.user?.id       ?? null,
      tg_username: tg.initDataUnsafe?.user?.username ?? null,
    };

    if (CONFIG.webhookUrl) {
      await fetch(CONFIG.webhookUrl, {
        method:  'POST',
        headers: {
          'Content-Type':         'application/json',
          'X-Telegram-Init-Data': tg.initData || '',  // НОВОЕ: для HMAC-проверки
        },
        body: JSON.stringify(payload),
      });
    }
  } catch (e) {
    console.warn('Submit error:', e);
  }

  tg.MainButton.hideProgress?.();
  goTo('screen-done');
  initDoneScreen();
}
```

### `tg-app/data.js` — одна строка

```javascript
// БЫЛО:
webhookUrl: '',

// СТАЛО:
webhookUrl: '/api/lead',
```

### `tg-app/index.html` — добавить поле «Название клиники»

В форму контактов (`#screen-contacts`) добавить перед полем телефона:

```html
<div class="form-group">
  <label class="form-label" for="input-clinic">Название клиники</label>
  <input
    id="input-clinic"
    type="text"
    class="form-input"
    placeholder="Клиника Здоровье"
    autocomplete="organization"
  />
</div>
```

---

## 9. Zapier: Google Sheets → amoCRM (без кода)

Поскольку одна таблица, нужен фильтр — реагировать только на строки со заполненным телефоном.

1. [zapier.com](https://zapier.com) → Create Zap
2. **Trigger:** Google Sheets → «New or Updated Spreadsheet Row» → таблица → лист «Прохождения»
   _(Важно: именно «New or Updated», а не «Updated» — иначе edge case с `appendFullRow` не поймается)_
3. **Filter (обязательно):** добавить шаг Filter → «Столбец P (Телефон) существует и не пустой»
   Без фильтра Zapier будет срабатывать на каждое прохождение теста (Stage 1), не только на лидов
4. **Action:** amoCRM → «Create or Update Contact» → Имя → столбец O, Телефон → столбец P
5. **Action 2:** amoCRM → «Create Lead» → Название → `Стресс-тест — {столбец Q}`, привязать к контакту
6. Включить Zap → тест: пройти тест, заполнить форму → проверить amoCRM

**Тариф Zapier:** Starter ~$20/мес для 750 задач/мес. При 100 лидах/мес — хватит с запасом.

**Альтернатива без Zapier:** настроить триггер прямо в Google Apps Script:
```javascript
// В редакторе скрипта таблицы: Triggers → onEdit
function onEdit(e) {
  const col = e.range.getColumn();
  const row = e.range.getRow();
  if (col !== 16 || row < 2) return;  // столбец P = 16
  const phone = e.value;
  if (!phone) return;
  // Здесь HTTP POST в amoCRM или webhook
}
```
Бесплатно, но требует написания кода.

---

## 10. Порядок деплоя (пошаговый)

```
Шаг 1. Google Cloud: создать Service Account, скачать JSON ключ (раздел 5)

Шаг 2. Google Sheets: создать таблицу, лист назвать «Прохождения»,
        добавить заголовки (A1:Q1 по таблице из раздела 2), дать доступ Service Account

Шаг 3. Vercel → Environment Variables:
        LEADS_CHAT_ID, GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT
        (BOT_TOKEN уже есть)

Шаг 3.5. Убедиться что в корневом `package.json` есть `"type": "module"`:
          без этого `import` в .js-файлах не работает в Node.js
          Если строки нет — добавить: { ... "type": "module", ... }
          (api/webhook.js уже использует export default — проверить что деплой работал)

Шаг 4. Создать файлы:
        api/_lib/utils.js    (код из раздела 5.5)
        api/save-result.js   (код из раздела 6)
        api/lead.js          (код из раздела 7)

Шаг 5. Обновить frontend:
        tg-app/app.js  — goToResult() + submitForm() (раздел 8)
        tg-app/data.js — webhookUrl: '/api/lead'
        tg-app/index.html — поле input-clinic

Шаг 6. git add . && git commit -m "feat: two-stage leads — Sheets + TG notify + HMAC"
        git push origin master  (Vercel деплоит автоматически)

Шаг 7. Тест Стадии 1 (в Telegram):
        Пройти тест → дойти до экрана результата
        ✅ В листе «Прохождения» появилась строка
        ✅ Бот прислал результат в чат

Шаг 8. Тест Стадии 2:
        Заполнить форму → нажать «Отправить»
        ✅ В листе «Прохождения» обновились столбцы N–Q (имя, телефон, клиника)
        ✅ В Telegram-группе появилось уведомление с карточкой лида
        ✅ goTo('screen-done') отработал

Шаг 9. Настроить Zapier: Sheets «Прохождения» (фильтр: телефон не пуст) → amoCRM (раздел 9)

Шаг 10. Тест со спам-защитой:
         curl -X POST https://medclinic-stress-test.vercel.app/api/lead \
           -H "Content-Type: application/json" \
           -d '{"phone": "79991234567"}'
         Ожидается: 401 Unauthorized
```

---

## 11. Тест endpoint без Telegram (разработка)

**Важно:** на production-URL (`medclinic-stress-test.vercel.app`) HMAC-проверка всегда активна — curl без валидного `initData` вернёт `401`. Для локального тестирования нужен `vercel dev`, который устанавливает `NODE_ENV=development` и отключает проверку.

```bash
# 1. Установить Vercel CLI, привязать проект, скачать переменные (один раз):
npm i -g vercel
vercel link              # привязать к существующему Vercel-проекту
vercel env pull .env.local   # скачать все env vars в .env.local (не коммитить!)
vercel dev               # поднимает функции на http://localhost:3000

# 2. Тест Стадии 1 (локально)
curl -X POST http://localhost:3000/api/save-result \
  -H "Content-Type: application/json" \
  -d '{
    "tg_user_id": 123456789,
    "tg_username": "test_user",
    "first_name": "Тест",
    "score": 38,
    "level": "high",
    "flags": ["BUDGET_RISK"],
    "blocks": {"channels": 6, "budget": 0, "seo": 8, "geo": 8, "base": 3, "analytics": 2}
  }'
# Ожидается: {"ok":true} + строка в Sheets + сообщение боту

# 3. Тест Стадии 2 (локально)
curl -X POST http://localhost:3000/api/lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Анна Петрова",
    "phone": "+7 (999) 123-45-67",
    "clinic": "Клиника Здоровье",
    "tg_user_id": 123456789,
    "tg_username": "test_user",
    "score": 38,
    "level": "high",
    "flags": ["BUDGET_RISK"],
    "blocks": {"channels": 6, "budget": 0, "seo": 8, "geo": 8, "base": 3, "analytics": 2}
  }'
# Ожидается: {"ok":true} + обновление строки в Sheets + уведомление в TG-группу

# 4. Тест спам-защиты (на prod — должен вернуть 401)
curl -X POST https://medclinic-stress-test.vercel.app/api/lead \
  -H "Content-Type: application/json" \
  -d '{"phone": "79991234567"}'
# Ожидается: 401 Unauthorized
```

Ошибки смотреть: локально — в терминале `vercel dev`; на prod — Vercel Dashboard → Functions → Logs

---

## 12. Что отложено на v2

| Фича | Причина |
|---|---|
| Гонка Stage 1 / Stage 2 (очень быстрый submit) | `appendFullRow` отрабатывает корректно, но Stage 1 позже добавит лишнюю строку холодного контакта. При низком трафике некритично. Решение — atomic upsert через БД. |
| Follow-up через 24 часа | Требует Vercel Cron Jobs |
| Vercel timeout при медленном Sheets | Добавить AbortController(5000мс) + retry |
| Дедупликация в Sheets | Сначала накопить данные, потом решать |
| amoCRM прямая интеграция без Zapier | Нужен Vercel KV для refresh token |
| PDF-отчёт | v2 по research.md |
| Поле «Уровень риска» как список в amoCRM | После настройки Zapier |

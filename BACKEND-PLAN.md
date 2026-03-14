# BACKEND-PLAN.md — Архитектура бэкенда
## Стресс-тест маркетинга клиники / МедСпринт

**Дата:** 2026-03-14 (актуальная версия)
**Стек:** Vercel Serverless (Node.js 20, ESM), Telegram Bot API, Google Sheets API v4, amoCRM API v4

---

## 1. Архитектура: четыре endpoint

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
    ┌────┴──────────────────────────┐
    ▼                               ▼
[Google Sheets]              [Telegram Bot API]
Лист «Прохождения»           sendMessage(tg_user_id)
Строки A–M                   Результат + карта рисков
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
         │
    ┌────┴──────────────────────────────────────────────┐           │
    │                                                   │           │
    ▼  если AMO_TOKEN + AMO_DOMAIN заданы               ▼           ▼
[amoCRM API v4]                              [Google Sheets]  [Telegram Bot API]
Создаёт контакт (PHONE)                      Только метка     sendMessage(LEADS_CHAT_ID)
Создаёт сделку с тегом уровня               времени в N       Карточка лида в группу команды
Добавляет примечание с деталями теста        (без личных       с кнопкой «Написать»
                                             данных)

    ▼  если AMO_TOKEN не задан (fallback)
[Google Sheets]  +  [Telegram Bot API]
Дата + имя + телефон + клиника в N–Q         Уведомление команде (то же)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ЛИДМАГНИТ — Подписка на канал → PDF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Кнопка «Подписаться и получить» на экране результата]
         │
         │ POST /api/check-sub  (тихая проверка)
         ├──── если subscribed → сразу к отправке
         └──── если нет → открыть t.me/medsprint → «Я подписался»
                                │
                                │ POST /api/check-sub  (повторная)
                                ├──── subscribed: false → «Подписка не найдена»
                                └──── subscribed: true
                                          │
                                          │ POST /api/send-material
                                          ├──── серверная проверка getChatMember (защита)
                                          └──── sendDocument(tg_user_id, MATERIAL_FILE_ID)
                                               PDF приходит в Telegram пользователю
```

---

## 2. Google Sheets — структура данных

**Один лист «Прохождения».** Стадия 1 создаёт строку. Стадия 2 находит её по TG User ID и дописывает столбец N (при amoCRM) или N–Q (fallback).

| Столбец | Заполняется | Источник | Пример |
|---|---|---|---|
| A: Дата теста | Стадия 1 | server timestamp МСК | 14.03.2026, 10:00:00 |
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
| N: Дата заявки | Стадия 2 | server timestamp МСК | 14.03.2026, 10:05:00 |
| O: Имя (форма) | Стадия 2 (fallback) | `input-name` | Анна Петрова |
| P: Телефон | Стадия 2 (fallback) | `input-phone` | +7 (999) 123-45-67 |
| Q: Клиника | Стадия 2 (fallback) | `input-clinic` | Клиника Здоровье |

**Как читать:**
- N пустая = прошли тест, форму не заполнили (холодный контакт)
- N заполнена = лид отправлен
- При активном amoCRM: личные данные (O–Q) в Sheets не попадают — хранятся только в amoCRM (соответствие 152-ФЗ)

---

## 3. Переменные окружения (Vercel Dashboard)

| Переменная | Что это | Обязательная |
|---|---|---|
| `BOT_TOKEN` | Токен бота (@BotFather) | ✅ |
| `LEADS_CHAT_ID` | ID Telegram-группы команды для уведомлений | ✅ |
| `GOOGLE_SHEET_ID` | ID таблицы из URL (docs.google.com/spreadsheets/d/**{ID}**/edit) | ✅ |
| `GOOGLE_SERVICE_ACCOUNT` | JSON ключ Service Account (одной строкой, без переносов) | ✅ |
| `WEBAPP_URL` | URL Mini App для кнопки бота | ✅ |
| `AMO_TOKEN` | Long-lived токен amoCRM (Настройки → Интеграции → API) | Рекомендуется |
| `AMO_DOMAIN` | Поддомен аккаунта amoCRM (например `medsprint`) | Рекомендуется |
| `AMO_PIPELINE_ID` | ID воронки в amoCRM (число) | Опционально |
| `AMO_STATUS_ID` | ID этапа воронки в amoCRM (число) | Опционально |
| `MATERIAL_FILE_ID` | file_id PDF-документа в Telegram (получить через curl — см. раздел 7) | ✅ |

**Итого: 10 переменных.** `GOOGLE_SERVICE_ACCOUNT` — JSON строка целиком без переносов.
Если `AMO_TOKEN`/`AMO_DOMAIN` не заданы — `api/lead.js` автоматически использует fallback: личные данные записываются в Sheets (столбцы O–Q).

---

## 4. Спам-защита: верификация Telegram initData (HMAC)

Telegram подписывает `initData` при каждом открытии Mini App с помощью `BOT_TOKEN`.

```javascript
// api/_lib/utils.js
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
```

В dev-режиме (`NODE_ENV=development`) проверка отключена — позволяет тестировать через `vercel dev`.
Проверка применяется во всех четырёх endpoint: `save-result`, `lead`, `check-sub`, `send-material`.

---

## 5. Google Sheets API — настройка (один раз)

### Шаг 1: Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) → включить **Google Sheets API**
2. **IAM & Admin → Service Accounts → Create** → имя `medclinic-sheets-writer`
3. Нажать на аккаунт → **Keys → Add Key → JSON** → скачать файл

### Шаг 2: Google Sheets

1. Создать таблицу, переименовать лист: «Прохождения»
2. Добавить заголовки A1:Q1 по таблице из раздела 2
3. **Share** → добавить email Service Account с правами «Редактор»
4. Скопировать ID из URL → `GOOGLE_SHEET_ID`

### Шаг 3: Vercel

```bash
# macOS/Linux — убрать переносы строк из JSON ключа:
cat service-account.json | tr -d '\n'
# Скопировать результат → вставить как значение GOOGLE_SERVICE_ACCOUNT
```

---

## 5.5. Общие утилиты: `api/_lib/utils.js`

Кэш токена Google особенно важен: при повторных вызовах (тёплый инстанс Vercel) токен возвращается из памяти без HTTP-запроса.

```javascript
import { createHmac, createSign } from 'node:crypto';

export function verifyTelegramInitData(initData, botToken) { ... }

let _tokenCache = { token: null, expiresAt: 0 };
export async function getGoogleAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) return _tokenCache.token;
  // JWT → OAuth2 → access token (1 час)
  ...
}

export const SHEET_ID = () => process.env.GOOGLE_SHEET_ID;
```

---

## 6. Endpoint: `api/save-result.js` (Стадия 1)

Вызывается автоматически при переходе на `screen-result`. Срабатывает один раз (флаг `state.resultSaved`).

**Что делает параллельно:**
1. Записывает строку в лист «Прохождения» (столбцы A–M)
2. Отправляет пользователю в Telegram персональное сообщение с результатом и картой рисков + кнопку «📱 Открыть приложение»

**Payload от фронтенда:**
```json
{
  "tg_user_id": 123456789,
  "tg_username": "anna_clinic",
  "first_name": "Анна",
  "score": 38,
  "level": "high",
  "flags": ["BUDGET_RISK", "MONOCHANNEL"],
  "blocks": { "channels": 6, "budget": 0, "seo": 8, "geo": 8, "base": 3, "analytics": 2 }
}
```

---

## 7. Endpoint: `api/lead.js` (Стадия 2)

Вызывается при нажатии «Отправить» в форме контактов.

**Dual-path логика:**

```
AMO_TOKEN + AMO_DOMAIN заданы?
    ├── ДА → amoCRM:
    │         createContact(name, phone)
    │         createLead(name, clinic, level_tag, pipeline_id, status_id)
    │         addNote(score, flags, blocks, tg_username)
    │       + Sheets: только метка времени в столбец N (личных данных нет)
    │
    └── НЕТ → Sheets fallback:
              updateLeadColumns(N:Q) = [дата, имя, телефон, клиника]
              или appendFullRow если строка Стадии 1 не найдена

В обоих случаях: sendMessage(LEADS_CHAT_ID) — карточка лида команде
```

**amoCRM env vars:**
- `AMO_TOKEN` — долгосрочный токен (Настройки → Интеграции → API)
- `AMO_DOMAIN` — только поддомен, без `.amocrm.ru` (например `medsprint`)
- `AMO_PIPELINE_ID` — ID воронки (число из URL воронки в amoCRM). Если не задан — сделка попадает в воронку по умолчанию
- `AMO_STATUS_ID` — ID этапа. Если не задан — первый этап воронки

**Payload от фронтенда:**
```json
{
  "name": "Анна Петрова",
  "phone": "+7 (999) 123-45-67",
  "clinic": "Клиника Здоровье",
  "tg_user_id": 123456789,
  "tg_username": "anna_clinic",
  "score": 38,
  "level": "high",
  "flags": ["BUDGET_RISK", "MONOCHANNEL"],
  "blocks": { "channels": 6, "budget": 0, "seo": 8, "geo": 8, "base": 3, "analytics": 2 }
}
```

---

## 8. Endpoint: `api/check-sub.js`

Проверяет, подписан ли пользователь на канал `@medsprint`.

**Важно:** бот должен быть **администратором** канала — иначе `getChatMember` вернёт ошибку для приватных каналов.

**Запрос:**
```json
POST /api/check-sub
Header: X-Telegram-Init-Data: ...
Body: { "tg_user_id": 123456789 }
```

**Ответ:**
```json
{ "subscribed": true }
// или
{ "subscribed": false }
// или (при ошибке Telegram API)
{ "subscribed": false, "error": "описание" }
```

Статусы, считающиеся подписанным: `member`, `administrator`, `creator`.

---

## 9. Endpoint: `api/send-material.js`

Отправляет PDF-карту каналов пользователю через бота. Повторно проверяет подписку на сервере (защита от обхода на клиенте).

**Запрос:**
```json
POST /api/send-material
Header: X-Telegram-Init-Data: ...
Body: { "tg_user_id": 123456789 }
```

**Логика:**
1. Проверить initData (HMAC)
2. Получить `MATERIAL_FILE_ID` из env
3. Вызвать `getChatMember` — убедиться, что подписан (403 если нет)
4. `sendDocument(tg_user_id, file_id)` с подписью к документу

**Как получить `MATERIAL_FILE_ID`:**

Webhook должен быть активен, поэтому `getUpdates` не работает. Получение через прямую загрузку:

```bash
# Загрузить PDF напрямую через sendDocument (один раз)
curl.exe -F "chat_id=ВАШ_TG_USER_ID" `
  -F "document=@channels-map.pdf" `
  "https://api.telegram.org/botВАШ_BOT_TOKEN/sendDocument"

# В JSON-ответе найти: result.document.file_id
# Это значение сохранить в Vercel env как MATERIAL_FILE_ID
# file_id стабилен — повторно загружать PDF не нужно
```

---

## 10. Изменения во фронтенде

### `tg-app/data.js`
```javascript
webhookUrl: '/api/lead',   // POST при отправке формы контактов
privacyUrl: 'https://medclinic-stress-test.vercel.app/privacy.html',
totalAudited: 146,
offer: {
  channelUsername: 'medsprint',  // без @
  // ...
}
```

### `tg-app/app.js` — ключевые точки

**Стадия 1** (fire-and-forget, при переходе на результат):
```javascript
if (tg.initData && !state.resultSaved) {
  state.resultSaved = true;
  fetch('/api/save-result', { method: 'POST', headers: { 'X-Telegram-Init-Data': tg.initData }, body: JSON.stringify({...}) })
    .catch(() => {});
}
```

**Стадия 2** (при нажатии «Отправить» в форме):
```javascript
await fetch('/api/lead', {
  headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData || '' },
  body: JSON.stringify({ name, phone, clinic, score, level, flags, blocks, tg_user_id, tg_username }),
});
goTo('screen-done');
```

**Лидмагнит** — `renderOfferCard()` + `checkSubscription()`:
- Тихая pre-check через `/api/check-sub` перед открытием канала
- После «Я подписался» — повторный `/api/check-sub` → `/api/send-material`
- При успехе: кнопка меняется на `offer-inline-btn--sent` (серый бейдж, `pointer-events: none`)

---

## 11. Тест endpoint без Telegram (локальная разработка)

```bash
# 1. Установить Vercel CLI и скачать переменные
npm i -g vercel
vercel link
vercel env pull .env.local   # не коммитить!
vercel dev                   # http://localhost:3000

# 2. Тест Стадии 1
curl -X POST http://localhost:3000/api/save-result \
  -H "Content-Type: application/json" \
  -d '{"tg_user_id":123456789,"tg_username":"test","first_name":"Тест","score":38,"level":"high","flags":["BUDGET_RISK"],"blocks":{"channels":6,"budget":0,"seo":8,"geo":8,"base":3,"analytics":2}}'

# 3. Тест Стадии 2
curl -X POST http://localhost:3000/api/lead \
  -H "Content-Type: application/json" \
  -d '{"name":"Анна","phone":"+7 (999) 123-45-67","clinic":"Клиника","tg_user_id":123456789,"tg_username":"test","score":38,"level":"high","flags":[],"blocks":{"channels":6,"budget":0,"seo":8,"geo":8,"base":3,"analytics":2}}'

# 4. Тест check-sub
curl -X POST http://localhost:3000/api/check-sub \
  -H "Content-Type: application/json" \
  -d '{"tg_user_id":123456789}'

# 5. Тест спам-защиты (на prod — должен вернуть 401)
curl -X POST https://medclinic-stress-test.vercel.app/api/lead \
  -H "Content-Type: application/json" \
  -d '{"phone":"79991234567"}'
# Ожидается: 401 Unauthorized
```

Ошибки: локально — в терминале `vercel dev`; на prod — Vercel Dashboard → Functions → Logs.

---

## 12. Что отложено на v2

| Фича | Причина |
|---|---|
| Гонка Stage 1 / Stage 2 (очень быстрый submit) | `appendFullRow` отрабатывает корректно, но Stage 1 позже добавит лишнюю холодную строку. При низком трафике некритично. Решение — atomic upsert через БД. |
| Follow-up через 24 часа | Требует Vercel Cron Jobs |
| Vercel timeout при медленном Sheets | Добавить AbortController(5000мс) + retry |
| amoCRM refresh token (вместо long-lived) | Нужен Vercel KV для хранения токена |
| Персонализированный PDF-отчёт | v2 по research.md |
| Аналитика воронки (PostHog) | Отложена в MVP |

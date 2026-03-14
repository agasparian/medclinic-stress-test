# DEPLOYMENT.md — Пошаговый деплой
## Стресс-тест маркетинга клиники / МедСпринт

**Актуально на:** 2026-03-14
**Хостинг:** Vercel (автодеплой из git, ветка `master`)
**Прод-URL:** https://medclinic-stress-test.vercel.app

---

## Быстрый старт: уже задеплоено

Проект задеплоен. При `git push origin master` Vercel автоматически запускает новый деплой. Ручной редеплой нужен только при изменении env-переменных.

---

## 1. Переменные окружения (текущее состояние)

Управление: Vercel Dashboard → проект `medclinic-stress-test` → Settings → Environment Variables.

**После добавления или изменения любой переменной — нажать Redeploy.**

| Переменная | Назначение | Статус |
|---|---|---|
| `BOT_TOKEN` | Токен бота @clinic_marketing_stress_test_bot | ✅ задана |
| `LEADS_CHAT_ID` | ID Telegram-группы команды (уведомления о лидах) | ✅ задана |
| `GOOGLE_SHEET_ID` | ID Google-таблицы «Прохождения» | ✅ задана |
| `GOOGLE_SERVICE_ACCOUNT` | JSON ключ Service Account (одной строкой) | ✅ задана |
| `WEBAPP_URL` | https://medclinic-stress-test.vercel.app | ✅ задана |
| `MATERIAL_FILE_ID` | file_id PDF-карты каналов в Telegram | ✅ задана |
| `AMO_TOKEN` | Long-lived токен amoCRM | ✅ задана |
| `AMO_DOMAIN` | Поддомен amoCRM (без .amocrm.ru) | ✅ задана |
| `AMO_PIPELINE_ID` | ID воронки amoCRM | Проверить |
| `AMO_STATUS_ID` | ID этапа воронки amoCRM | Проверить |

---

## 2. Как обновить переменную окружения

1. Vercel Dashboard → Settings → Environment Variables
2. Найти переменную → Edit → сохранить новое значение
3. Deployments → три точки у последнего деплоя → **Redeploy** (без изменений кода)

---

## 3. Как обновить PDF (MATERIAL_FILE_ID)

Если нужно заменить карту каналов на новый PDF:

```bash
# Убедитесь, что BOT_TOKEN известен (из Vercel env или .env.local)
# ВАЖНО: webhook активен, поэтому getUpdates не работает — используем прямую загрузку

curl.exe -F "chat_id=ВАШ_TELEGRAM_USER_ID" `
  -F "document=@новый-файл.pdf" `
  "https://api.telegram.org/bot$BOT_TOKEN/sendDocument"

# В ответе найдите: result.document.file_id
# Сохраните значение в Vercel env: MATERIAL_FILE_ID = полученный_file_id
# Redeploy
```

`file_id` стабилен — при повторной отправке того же файла у всех пользователей будет работать старый `file_id`.

---

## 4. Структура API (все Serverless Functions)

| URL | Файл | Назначение |
|---|---|---|
| `POST /api/webhook` | `api/webhook.js` | Telegram Bot: /start, /help, /contact, любой текст |
| `POST /api/save-result` | `api/save-result.js` | Сохранить прохождение + TG-сообщение пользователю |
| `POST /api/lead` | `api/lead.js` | Лид из формы → amoCRM + Sheets + TG-уведомление |
| `POST /api/check-sub` | `api/check-sub.js` | Проверить подписку на @medsprint |
| `POST /api/send-material` | `api/send-material.js` | Отправить PDF пользователю через бота |

Все endpoint требуют заголовок `X-Telegram-Init-Data` (проверяется HMAC в продакшене).
CORS разрешён только для `https://medclinic-stress-test.vercel.app`.

---

## 5. Бот: настройка webhook

Webhook уже настроен. Если бот перестал отвечать — проверить:

```bash
# Проверить статус webhook
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"

# Переустановить webhook (если сломался)
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://medclinic-stress-test.vercel.app/api/webhook"}'
```

**Важно:** пока webhook активен, `getUpdates` не работает (409 Conflict).

---

## 6. Telegram Bot: бот должен быть администратором канала

`api/check-sub.js` и `api/send-material.js` вызывают `getChatMember` для `@medsprint`.
Если бот **не является администратором** публичного канала — `getChatMember` для обычных участников вернёт ошибку.

Проверка: @clinic_marketing_stress_test_bot → @medsprint → Администраторы.

---

## 7. Настройка amoCRM (если не настроено)

1. Войти в amoCRM → Настройки → Интеграции → API
2. Создать интеграцию → скопировать **Long-lived access token**
3. Поддомен аккаунта из URL: `https://**medsprint**.amocrm.ru` → `AMO_DOMAIN=medsprint`
4. Создать воронку для лидов → скопировать ID из URL → `AMO_PIPELINE_ID`
5. Выбрать начальный этап → `AMO_STATUS_ID`
6. Добавить все 4 переменные в Vercel → Redeploy
7. Проверить: пройти тест, заполнить форму → убедиться что сделка появилась в amoCRM

**Без amoCRM:** удалить `AMO_TOKEN` и `AMO_DOMAIN` из Vercel env (или оставить пустыми) — `api/lead.js` автоматически переключится на fallback (данные пишутся в Google Sheets).

---

## 8. Локальная разработка

```bash
npm i -g vercel
vercel link          # привязать к проекту (один раз)
vercel env pull .env.local   # скачать все env vars локально (не коммитить!)
vercel dev           # http://localhost:3000 — все функции работают локально
```

В `vercel dev` проверка HMAC отключена (`NODE_ENV=development`) — можно тестировать curl-ами без initData.

---

## 9. Типичные проблемы

| Симптом | Вероятная причина | Решение |
|---|---|---|
| Бот молчит на /start | `BOT_TOKEN` не задан или неверный | Проверить Vercel env → Redeploy |
| PDF не приходит | `MATERIAL_FILE_ID` неверный или бот не admin | Проверить file_id, проверить права бота в канале |
| «Подписка не найдена» хотя подписан | Бот не admin канала — getChatMember возвращает ошибку | Добавить бота как admin в @medsprint |
| Лид не попадает в amoCRM | Неверный `AMO_TOKEN` или `AMO_DOMAIN` | Проверить Vercel Logs → Functions → api/lead |
| 401 Unauthorized в API | Запрос без заголовка X-Telegram-Init-Data | Только в браузере вне Telegram — норма |
| Vercel env не подхватился | Redeploy не был выполнен после изменения env | Deployments → Redeploy |

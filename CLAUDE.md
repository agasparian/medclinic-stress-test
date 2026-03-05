# CLAUDE.md — Гид разработчика: Стресс-тест маркетинга клиники

## Структура проекта

```
telegram-app/
├── tg-app/             ← Весь фронтенд Mini App
│   ├── index.html      ← Точка входа. HTML-скелет всех 6 экранов
│   ├── style.css       ← Все стили. Использует CSS-переменные Telegram
│   ├── data.js         ← КОНТЕНТ: вопросы, ответы, тексты (менять здесь)
│   ├── scoring.js      ← Логика подсчёта баллов и флагов риска
│   └── app.js          ← Главная логика: навигация, рендер, форма, webhook
├── research.md         ← Исходное исследование рынка и конкурентов
├── brief.md            ← Детальный бриф продукта (экраны, элементы, логика)
└── CLAUDE.md           ← Этот файл
```

---

## Как это работает: поток пользователя

```
Telegram Bot → кнопка «Пройти стресс-тест» → открывает index.html
    ↓
[screen-welcome]    Стартовый экран (статичный)
    ↓
[screen-question]   Вопросы Q1–Q6 (один динамический экран, контент меняется)
    ↓
[screen-loading]    Анимация загрузки 2.8 сек (расчёт скора)
    ↓
[screen-result]     Результат: балл, карта рисков, топ-3 проблемы
    ↓
[screen-contacts]   Форма: имя (автозаполнение) + телефон + согласие
    ↓
[screen-done]       Подтверждение + кнопка «Канал агентства»
```

**Ветвление:** если в Q1 выбрано «Не отслеживаем» → Q2 пропускается автоматически.

---

## Что и где менять

### Название агентства, менеджер, webhook
Файл: `tg-app/data.js`, объект `CONFIG`:

```javascript
const CONFIG = {
  agencyName:   'МедСпринт',       // отображается в шапке и экране done
  managerName:  'Алексей Громов',   // экран подтверждения
  managerRole:  'Ведущий маркетолог',
  channelUrl:   'https://t.me/...',  // кнопка «Канал агентства»
  webhookUrl:   '',                  // POST JSON с данными лида (оставьте '' если нет)
  privacyUrl:   'https://...',       // политика конфиденциальности (152-ФЗ)
  totalAudited: 1247,                // счётчик на стартовом экране
  avgScore:     61,                  // средний балл по нише (Callibri)
  avgSource:    'Callibri, 605 клиник',
};
```

### Вопросы квиза
Файл: `tg-app/data.js`, массив `QUESTIONS`.

Каждый вопрос:
```javascript
{
  id:      'q1',           // не менять — используется в scoring.js
  type:    'multi',        // 'multi' (чекбоксы) | 'single' (радио)
  step:    1,              // номер для отображения
  title:   'Текст вопроса',
  hint:    'Подсказка под вопросом или null',
  options: [
    { id: 'direct', emoji: '📢', text: 'Текст варианта', exclusive: false }
    // exclusive: true — при выборе снимает все остальные варианты
  ],
}
```

### Тексты результатов и проблем
Файл: `tg-app/data.js`:
- `RESULT_LEVELS` — тексты и цвета для каждого уровня (good/moderate/high/critical)
- `PROBLEM_TEXTS` — тексты проблем по блокам (channels, budget, seo, geo, base, analytics)
- `LOADING_MESSAGES` — тексты на экране загрузки

### Логика скоринга
Файл: `tg-app/scoring.js`, функция `calculateScore(answers)`.

Баллы по блокам:
| Блок | Макс. | За что начисляется |
|------|:-----:|--------------------|
| channels (Q1) | 20 | 5+ каналов → 20, 3–4 → 12, 2 → 6, 1 → 0 |
| budget (Q2) | 20 | <30% → 20, 30–50% → 15, 50–70% → 8, >70% → 0 |
| seo (Q3) | 20 | Топ-5 → 20, Топ-10 → 12, Реклама → 4, Нет → 0 |
| geo (Q4) | 15 | Активно → 15, Частично → 8, Базово → 4, Нет → 0 |
| base (Q5) | 15 | МИС+маркетинг → 15, База → 7, Список → 3, Нет → 0 |
| analytics (Q6) | 10 | Сквозная → 10, Метрика → 5, Кабинеты → 2, Нет → 0 |

Флаги (влияют на контент результата):
- `CRITICAL` — 1 канал или «не отслеживаем»
- `BUDGET_RISK` — >70% бюджета в платном или «не считали»
- `MONOCHANNEL` — только Директ без SEO/Карт/Агрегаторов
- `NO_ANALYTICS` — нет аналитики или «не отслеживаем»

### Стили
Файл: `tg-app/style.css`.

CSS-переменные Telegram применяются через `applyTheme()` в `app.js`. Для кастомизации меняйте `:root` в начале файла.

Главный цвет акцента: `--accent: #2AABEE` (можно заменить на корпоративный цвет).

---

## Навигация между экранами

Функция `goTo(screenId, direction)` в `app.js`:
- `direction = 'forward'` — слайд вправо→влево (по умолчанию)
- `direction = 'back'` — слайд влево→вправо

Экраны и их ID:
| ID | Экран |
|----|-------|
| `screen-welcome` | Стартовый |
| `screen-question` | Вопросы (динамический) |
| `screen-loading` | Загрузка |
| `screen-result` | Результат |
| `screen-contacts` | Форма контактов |
| `screen-done` | Подтверждение |

MainButton управляется через `setMainBtn(text, handler, enabled)` и `hideMainBtn()`.

---

## Webhook — формат данных лида

При отправке формы на `CONFIG.webhookUrl` отправляется POST с JSON:

```json
{
  "name":       "Анна",
  "phone":      "+79001234567",
  "clinic":     "Клиника Здоровье",
  "score":      38,
  "level":      "high",
  "flags":      ["BUDGET_RISK", "MONOCHANNEL"],
  "blocks": {
    "channels":  2,
    "budget":    0,
    "seo":       8,
    "geo":       8,
    "base":      3,
    "analytics": 2
  },
  "tg_user_id":  123456789,
  "tg_username": "anna_clinic",
  "timestamp":   "2026-03-06T10:00:00.000Z"
}
```

Если `webhookUrl` пустой — данные не отправляются, UX не ломается.

---

## Деплой

### Frontend (tg-app/)
1. Загрузить папку `tg-app/` на хостинг с HTTPS (Vercel, Netlify, GitHub Pages)
2. URL вида `https://your-domain.com/tg-app/index.html` — это и есть WebApp URL

### Telegram Bot
1. Создать бота через @BotFather
2. Настроить Menu Button: `/setmenubutton` → указать WebApp URL
3. Или отправлять InlineKeyboard с WebApp кнопкой:

```python
# Python / aiogram
from aiogram.types import InlineKeyboardButton, WebAppInfo

btn = InlineKeyboardButton(
    text="Пройти стресс-тест",
    web_app=WebAppInfo(url="https://your-domain.com/tg-app/index.html")
)
```

### Тестирование в браузере (без Telegram)
Просто откройте `tg-app/index.html` в браузере. Все Telegram API замокированы,
внизу экрана появится синяя кнопка вместо нативной MainButton.

---

## Что в v2 (не реализовано в MVP)

- Ввод URL сайта → автоматический SEO-краулинг
- API Яндекс.Карты → автопроверка профиля
- PDF-отчёт с логотипом
- Сравнение с конкурентами по городу
- Кабинет с историей аудитов
- A/B тест двух версий бота

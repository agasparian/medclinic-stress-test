/**
 * api/webhook.js — Vercel Serverless Function
 * Telegram Bot webhook: обрабатывает команды /start, /help, /contact
 */

const TOKEN    = process.env.BOT_TOKEN;
const BASE_URL = 'https://api.telegram.org/bot' + TOKEN;
const APP_URL  = 'https://medclinic-stress-test.vercel.app';

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function apiCall(method, body) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

function sendMessage(chatId, text, extra = {}) {
  return apiCall('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

// Кнопка «Открыть Mini App» — встроена в клавиатуру сообщения
function webAppKeyboard(buttonText) {
  return {
    inline_keyboard: [[
      { text: buttonText, web_app: { url: APP_URL } },
    ]],
  };
}

// ─── Тексты сообщений ─────────────────────────────────────────────────────────

const MSG_START = `👋 <b>Привет!</b>

Я помогу узнать, насколько маркетинг вашей клиники защищён от роста цен на рекламу.

<b>Стресс-тест включает:</b>
📡 Каналы привлечения пациентов
💰 Зависимость от платной рекламы
🔍 Позиции в SEO и органике
📍 Работу с Яндекс.Картами
👥 Использование базы пациентов
📊 Систему аналитики

Всего 6 вопросов — результат сразу, без звонка.

Нажмите кнопку ниже 👇`;

const MSG_MATERIALS = `🎁 <b>Ваши бесплатные материалы:</b>

📊 <b>Карта каналов 2025</b> — откуда приходят пациенты (данные 605 клиник, Callibri):
${APP_URL}/materials/channels-map.html

📍 <b>Чеклист: 10 минут в Яндекс.Картах</b> — канал №1 по звонкам:
${APP_URL}/materials/yandex-maps-checklist.html

Сохраните ссылки — они всегда доступны 👌`;

const MSG_HELP = `📖 <b>Как пользоваться ботом</b>

1. Нажмите кнопку <b>«Начать стресс-тест»</b> — откроется мини-приложение
2. Ответьте на 6 вопросов о маркетинге клиники (3 минуты)
3. Получите оценку по 6 направлениям и карту рисков
4. Оставьте номер телефона — эксперт МедСпринт свяжется в течение 2 часов

<b>Команды:</b>
/start — открыть стресс-тест
/help — эта справка
/contact — связаться с нами

❓ Если что-то не работает — напишите нам: /contact`;

const MSG_CONTACT = `📞 <b>Связаться с МедСпринт</b>

<b>Алексей Громов</b>, ведущий маркетолог

Чтобы оставить заявку — пройдите стресс-тест и оставьте номер телефона.
Эксперт свяжется в течение 2 часов.

Или напишите напрямую через канал агентства 👇`;

const MSG_CONTACT_KEYBOARD = {
  inline_keyboard: [[
    { text: '✈️ Канал МедСпринт', url: 'https://t.me/medmarket_agency' },
  ]],
};

// ─── Обработчик webhook ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Принимаем только POST от Telegram
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const update = req.body;

  try {
    const msg = update?.message;
    if (!msg) return res.status(200).json({ ok: true }); // игнорируем не-сообщения

    const chatId = msg.chat.id;
    const text   = msg.text || '';

    if (text.startsWith('/start')) {
      const param = text.replace('/start', '').trim();

      // Шаг 1: приветственное сообщение с кнопкой открытия Mini App
      await sendMessage(chatId, MSG_START, {
        reply_markup: webAppKeyboard('🚀 Начать стресс-тест'),
      });

      // Шаг 2: если пришёл из оффер-модалки — отправляем материалы
      if (param === 'from_app') {
        await sendMessage(chatId, MSG_MATERIALS, {
          disable_web_page_preview: true,
        });
      }

    } else if (text === '/help') {
      await sendMessage(chatId, MSG_HELP, {
        reply_markup: webAppKeyboard('🚀 Открыть стресс-тест'),
      });

    } else if (text === '/contact') {
      await sendMessage(chatId, MSG_CONTACT, {
        reply_markup: MSG_CONTACT_KEYBOARD,
      });

    } else {
      // Любое другое сообщение — мягко направляем к тесту
      await sendMessage(chatId,
        'Нажмите кнопку ниже, чтобы пройти стресс-тест маркетинга вашей клиники 👇',
        { reply_markup: webAppKeyboard('🚀 Начать стресс-тест') }
      );
    }

  } catch (err) {
    console.error('Webhook error:', err);
  }

  // Всегда возвращаем 200 — иначе Telegram будет повторять запрос
  return res.status(200).json({ ok: true });
}

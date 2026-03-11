/**
 * ВРЕМЕННЫЙ диагностический эндпоинт — удалить после отладки
 * GET /api/debug-env
 * Возвращает список имён переменных окружения (БЕЗ значений)
 */
export default function handler(req, res) {
  const keys = Object.keys(process.env).sort();
  const relevant = {
    has_GOOGLE_SERVICE_ACCOUNT: 'GOOGLE_SERVICE_ACCOUNT' in process.env,
    has_GOOGLE_SHEET_ID:        'GOOGLE_SHEET_ID' in process.env,
    has_BOT_TOKEN:              'BOT_TOKEN' in process.env,
    has_LEADS_CHAT_ID:          'LEADS_CHAT_ID' in process.env,
    has_WEBAPP_URL:             'WEBAPP_URL' in process.env,
    NODE_ENV:                   process.env.NODE_ENV,
    total_env_keys:             keys.length,
    all_keys:                   keys,
  };
  res.status(200).json(relevant);
}

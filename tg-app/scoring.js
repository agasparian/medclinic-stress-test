/**
 * scoring.js — Логика подсчёта баллов стресс-теста.
 * Принимает объект answers, возвращает полный результат.
 *
 * Входные данные (answers):
 *   q1: string[]  — массив id выбранных каналов (multi-select)
 *   q2: string|null — id ответа по бюджету (null если вопрос пропущен)
 *   q3: string    — id ответа по SEO
 *   q4: string    — id ответа по GEO
 *   q5: string    — id ответа по базе пациентов
 *   q6: string    — id ответа по аналитике
 */

function calculateScore(answers) {
  const blocks = {};
  const flags = new Set();

  // ── Q1: Диверсификация каналов (max 20) ──────────────────────────────────
  const q1 = answers.q1 || [];
  const q1HasUnknown = q1.includes('unknown');

  // Флаг MONOCHANNEL: только Директ, ни одного из бесплатных/независимых каналов
  const q1PaidOnly = q1.includes('direct') &&
    !q1.some(c => ['seo', 'maps', 'aggregators', 'tg'].includes(c));

  let channelScore;
  if (q1HasUnknown) {
    channelScore = 0;
    flags.add('CRITICAL');
    flags.add('NO_ANALYTICS'); // не знают откуда пациенты = нет аналитики
  } else {
    const count = q1.length;
    if (count >= 5)      channelScore = 20;
    else if (count >= 3) channelScore = 12;
    else if (count === 2) channelScore = 6;
    else                 { channelScore = 0; flags.add('CRITICAL'); }
  }
  if (q1PaidOnly && !q1HasUnknown) flags.add('MONOCHANNEL');

  blocks.channels = {
    score: channelScore, max: 20,
    label: 'Диверсификация', icon: '📡',
  };

  // ── Q2: Бюджетная зависимость (max 20) ────────────────────────────────────
  // q2 может быть null если вопрос был пропущен (q1 = unknown)
  const q2 = answers.q2;
  let budgetScore;
  if      (q2 === 'lt30')  budgetScore = 20;
  else if (q2 === '30-50') budgetScore = 15;
  else if (q2 === '50-70') budgetScore = 8;
  else {
    // 'gt70', 'unknown', или null (пропущен)
    budgetScore = 0;
    flags.add('BUDGET_RISK');
  }
  blocks.budget = {
    score: budgetScore, max: 20,
    label: 'Бюджет', icon: '💰',
  };

  // ── Q3: SEO / органика (max 20) ───────────────────────────────────────────
  const q3 = answers.q3;
  let seoScore;
  if      (q3 === 'top5')        seoScore = 20;
  else if (q3 === 'top10')       seoScore = 12;
  else if (q3 === 'ads-only')    seoScore = 4;
  else                           seoScore = 0; // 'not-visible' или null
  blocks.seo = {
    score: seoScore, max: 20,
    label: 'SEO / органика', icon: '🔍',
  };

  // ── Q4: GEO — Карты / 2GIS (max 15) ──────────────────────────────────────
  const q4 = answers.q4;
  let geoScore;
  if      (q4 === 'active')  geoScore = 15;
  else if (q4 === 'partial') geoScore = 8;
  else if (q4 === 'basic')   geoScore = 4;
  else                       geoScore = 0; // 'none' или null
  blocks.geo = {
    score: geoScore, max: 15,
    label: 'GEO (Карты)', icon: '📍',
  };

  // ── Q5: База пациентов (max 15) ───────────────────────────────────────────
  const q5 = answers.q5;
  let baseScore;
  if      (q5 === 'crm-full')    baseScore = 15;
  else if (q5 === 'crm-passive') baseScore = 7;
  else if (q5 === 'list')        baseScore = 3;
  else                           baseScore = 0; // 'none' или null
  blocks.base = {
    score: baseScore, max: 15,
    label: 'База пациентов', icon: '👥',
  };

  // ── Q6: Аналитика (max 10) ────────────────────────────────────────────────
  const q6 = answers.q6;
  let analyticsScore;
  if      (q6 === 'full')     analyticsScore = 10;
  else if (q6 === 'metrika')  analyticsScore = 5;
  else if (q6 === 'cabinets') analyticsScore = 2;
  else {
    analyticsScore = 0; // 'none' или null
    flags.add('NO_ANALYTICS');
  }
  blocks.analytics = {
    score: analyticsScore, max: 10,
    label: 'Аналитика', icon: '📊',
  };

  // ── Итоговый балл ─────────────────────────────────────────────────────────
  const total = Object.values(blocks).reduce((sum, b) => sum + b.score, 0);

  // ── Уровень риска ─────────────────────────────────────────────────────────
  let level;
  if      (total >= 75) level = 'good';
  else if (total >= 50) level = 'moderate';
  else if (total >= 25) level = 'high';
  else                  level = 'critical';

  // ── Топ-3 проблемы: блоки с наибольшим gap от максимума ──────────────────
  const topProblems = Object.entries(blocks)
    .map(([key, b]) => ({ key, gap: b.max - b.score, ...b }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .filter(b => b.gap > 0) // не показываем блоки с максимальным баллом
    .map(b => ({
      key: b.key,
      icon: b.icon,
      label: b.label,
      text: PROBLEM_TEXTS[b.key],
    }));

  // ── Сценарий риска (показывается если флаг BUDGET_RISK + использует Директ) ─
  const usesDirect = q1.includes('direct') || !q1HasUnknown;
  const riskScenario = flags.has('BUDGET_RISK') && usesDirect
    ? { cplFrom: 2400, cplTo: 3100, pctGrowth: 30 }
    : null;

  return {
    total,
    blocks,
    flags: [...flags],
    level,
    levelData: RESULT_LEVELS[level],
    topProblems,
    riskScenario,
  };
}

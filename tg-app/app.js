/**
 * app.js — Главная логика приложения «Стресс-тест маркетинга клиники»
 */

// ─── Telegram WebApp API ──────────────────────────────────────────────────────
// Используем реальный SDK если доступен, иначе заглушки
const tg = window.Telegram?.WebApp ?? {
  ready:            () => {},
  expand:           () => {},
  close:            () => window.close(),
  openTelegramLink: (url) => window.open(url, '_blank'),
  themeParams:      {},
  colorScheme:      'light',
  initDataUnsafe:   { user: {} },
  MainButton:  { setText:()=>{}, show:()=>{}, hide:()=>{}, enable:()=>{}, disable:()=>{}, showProgress:()=>{}, hideProgress:()=>{}, onClick:()=>{}, offClick:()=>{} },
  BackButton:  { show:()=>{}, hide:()=>{}, onClick:()=>{}, offClick:()=>{} },
  HapticFeedback: { selectionChanged:()=>{}, impactOccurred:()=>{} },
};

// Запущено ли внутри реального Telegram (не в браузере)
const isInTelegram = !!(window.Telegram?.WebApp?.initDataUnsafe?.user?.id);

// ─── Состояние приложения ─────────────────────────────────────────────────────
const state = {
  currentScreen:  'screen-welcome',
  questionOrder:  [],   // ['q1','q2',...] — может пропускать q2
  questionIndex:  0,
  answers: { q1: [], q2: null, q3: null, q4: null, q5: null, q6: null },
  scoreResult:    null,
  consentChecked: false,
  resultSaved:    false, // предотвращает повторный вызов Stage 1 при возврате на результат
  mainBtnHandler: null, // текущий обработчик главной кнопки
  backBtnHandler: null, // текущий обработчик кнопки назад
};

// ─── Вспомогательная DOM-кнопка (браузерный fallback) ────────────────────────
function showFallbackBtn(text) {
  if (isInTelegram) return; // в Telegram кнопка нативная

  let btn = document.getElementById('fallback-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'fallback-btn';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      height: '52px', background: 'var(--accent)', color: '#fff',
      border: 'none', fontSize: '15px', fontWeight: '600',
      cursor: 'pointer', zIndex: '9999', fontFamily: 'inherit',
      transition: 'opacity 0.2s',
    });
    document.body.appendChild(btn);
    // Всегда читаем state.mainBtnHandler — актуальный на момент клика
    btn.addEventListener('click', () => {
      if (state.mainBtnHandler) state.mainBtnHandler();
    });
  }
  btn.textContent = text;
  btn.style.display = 'block';
  btn.style.opacity = '1';
  btn.disabled = false;
}

function hideFallbackBtn() {
  const btn = document.getElementById('fallback-btn');
  if (btn) btn.style.display = 'none';
}

function disableFallbackBtn() {
  const btn = document.getElementById('fallback-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
}

function enableFallbackBtn() {
  const btn = document.getElementById('fallback-btn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

// ─── Вспомогательная DOM-кнопка "Назад" (браузерный fallback) ────────────────
function showFallbackBackBtn() {
  if (isInTelegram) return;

  let btn = document.getElementById('fallback-back-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'fallback-back-btn';
    btn.textContent = '←';
    Object.assign(btn.style, {
      position: 'fixed', top: '12px', left: '12px',
      width: '36px', height: '36px', borderRadius: '50%',
      background: 'var(--tg-secondary)', border: '1px solid rgba(0,0,0,0.1)',
      fontSize: '18px', cursor: 'pointer', zIndex: '9999',
      fontFamily: 'inherit', lineHeight: '1',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
      if (state.backBtnHandler) state.backBtnHandler();
    });
  }
  btn.style.display = 'flex';
}

function hideFallbackBackBtn() {
  const btn = document.getElementById('fallback-back-btn');
  if (btn) btn.style.display = 'none';
}

// ─── Управление кнопкой "Назад" ───────────────────────────────────────────────
function showBackBtn(handler) {
  if (state.backBtnHandler) tg.BackButton.offClick(state.backBtnHandler);
  state.backBtnHandler = handler;
  tg.BackButton.onClick(handler);
  tg.BackButton.show();
  showFallbackBackBtn();
}

function hideBackBtn() {
  if (state.backBtnHandler) tg.BackButton.offClick(state.backBtnHandler);
  state.backBtnHandler = null;
  tg.BackButton.hide();
  hideFallbackBackBtn();
}

// ─── Управление главной кнопкой ───────────────────────────────────────────────
function setMainBtn(text, handler, enabled = true) {
  // Снимаем предыдущий обработчик из Telegram SDK
  if (state.mainBtnHandler) tg.MainButton.offClick(state.mainBtnHandler);

  // Сохраняем новый
  state.mainBtnHandler = handler;

  // Telegram SDK
  tg.MainButton.setText(text);
  tg.MainButton.onClick(handler);
  tg.MainButton.show();
  if (enabled) tg.MainButton.enable(); else tg.MainButton.disable();

  // DOM fallback
  showFallbackBtn(text);
  if (enabled) enableFallbackBtn(); else disableFallbackBtn();
}

function hideMainBtn() {
  if (state.mainBtnHandler) tg.MainButton.offClick(state.mainBtnHandler);
  state.mainBtnHandler = null;
  tg.MainButton.hide();
  hideFallbackBtn();
}

// ─── Навигация между экранами (slide-анимация) ────────────────────────────────
function goTo(screenId, direction = 'forward') {
  const fromEl = document.getElementById(state.currentScreen);
  const toEl   = document.getElementById(screenId);
  if (!toEl || fromEl === toEl) return;

  // Начальное положение входящего экрана
  toEl.style.transition = 'none';
  toEl.style.transform  = direction === 'forward' ? 'translateX(40%)' : 'translateX(-40%)';
  toEl.style.opacity    = '0';
  toEl.classList.add('active');

  // Форсируем перерисовку
  void toEl.offsetHeight;

  // Анимируем вход
  toEl.style.transition = '';
  toEl.style.transform  = 'translateX(0)';
  toEl.style.opacity    = '1';

  // Анимируем уход текущего экрана
  if (fromEl) {
    fromEl.style.transform = direction === 'forward' ? 'translateX(-40%)' : 'translateX(40%)';
    fromEl.style.opacity   = '0';
    setTimeout(() => {
      fromEl.classList.remove('active');
      fromEl.style.transform = '';
      fromEl.style.opacity   = '';
    }, 300);
  }

  state.currentScreen = screenId;
}

// ─── Тема Telegram ────────────────────────────────────────────────────────────
function applyTheme() {
  const p = tg.themeParams || {};
  const r = document.documentElement;
  if (p.bg_color)           r.style.setProperty('--tg-bg',        p.bg_color);
  if (p.secondary_bg_color) r.style.setProperty('--tg-secondary',  p.secondary_bg_color);
  if (p.text_color)         r.style.setProperty('--tg-text',       p.text_color);
  if (p.hint_color)         r.style.setProperty('--tg-hint',       p.hint_color);
  if (p.button_color)       r.style.setProperty('--accent',        p.button_color);
  if (tg.colorScheme === 'dark') document.body.setAttribute('data-theme', 'dark');
}

// ─── ЛИДМАГНИТ (встроенная карточка с проверкой подписки) ────────────────────

function renderOfferCard() {
  const o = CONFIG.offer;
  if (!o) return;

  // Начальное состояние
  document.getElementById('offer-inline-emoji').textContent    = o.emoji;
  document.getElementById('offer-inline-title').textContent    = o.title;
  document.getElementById('offer-inline-subtitle').textContent = 'Подпишитесь на канал МедСпринт — получите бесплатно';

  const ul = document.getElementById('offer-inline-bullets');
  ul.innerHTML = '';
  o.bullets.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  });

  const btn = document.getElementById('offer-inline-btn');
  btn.textContent = '📲 Подписаться и получить';
  btn.disabled = false;
  btn.className = 'offer-inline-btn';
  btn.onclick = () => {
    tg.HapticFeedback.selectionChanged();
    try { tg.openTelegramLink(`https://t.me/${o.channelUsername}`); }
    catch (_) { window.open(`https://t.me/${o.channelUsername}`, '_blank'); }
    // После открытия канала меняем кнопку
    setTimeout(() => {
      btn.textContent = '✅ Я подписался — проверить';
      btn.onclick = () => checkSubscription();
    }, 1200);
  };
}

async function checkSubscription() {
  const o   = CONFIG.offer;
  const btn = document.getElementById('offer-inline-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Проверяем подписку...';

  try {
    const userId = tg.initDataUnsafe?.user?.id;
    const r = await fetch('/api/check-sub', {
      method:  'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-Telegram-Init-Data': tg.initData || '',
      },
      body: JSON.stringify({ tg_user_id: userId }),
    });
    const data = await r.json();

    if (data.subscribed) {
      // Разблокируем карту
      document.getElementById('offer-inline-emoji').textContent    = '✅';
      document.getElementById('offer-inline-title').textContent    = 'Подписка подтверждена!';
      document.getElementById('offer-inline-subtitle').textContent = 'Карта каналов привлечения пациентов готова';
      document.getElementById('offer-inline-bullets').innerHTML    = '';
      btn.textContent  = '🗺️ Открыть карту каналов';
      btn.disabled     = false;
      btn.className    = 'offer-inline-btn offer-inline-btn--success';
      btn.onclick      = () => {
        tg.HapticFeedback.notificationOccurred('success');
        const url = window.location.origin + o.materialPath;
        try { tg.openLink(url); } catch (_) { window.open(url, '_blank'); }
      };
    } else {
      btn.disabled    = false;
      btn.textContent = '🔄 Подписка не найдена — попробовать снова';
      btn.onclick     = () => checkSubscription();
    }
  } catch (_) {
    btn.disabled    = false;
    btn.textContent = '🔄 Ошибка — попробовать снова';
    btn.onclick     = () => checkSubscription();
  }
}

// ─── ЭКРАН 1: СТАРТ ───────────────────────────────────────────────────────────
let _counterAnimGen = 0; // версия анимации — отменяет предыдущую при новом вызове
function animateCounter(el, target, duration = 1200) {
  const gen = ++_counterAnimGen;
  const start = performance.now();
  const update = (now) => {
    if (_counterAnimGen !== gen) return; // отменена новой анимацией
    const progress = Math.min((now - start) / duration, 1);
    // easeOutExpo
    const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const value = Math.round(ease * target);
    el.textContent = `${value.toLocaleString('ru')} — столько клиник уже прошли тест`;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function initWelcome() {
  const counter = document.getElementById('welcome-counter');
  if (counter) {
    counter.textContent = 'Уже прошли 0 клиник';
    // Ждём API до 1000ms, потом одна анимация до итоговой цифры
    const apiFetch = fetch('/api/stats', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const timeout  = new Promise(resolve => setTimeout(() => resolve(null), 1000));
    Promise.race([apiFetch, timeout]).then(data => {
      const real   = data?.count;
      const target = real != null ? CONFIG.totalAudited + real : CONFIG.totalAudited;
      setTimeout(() => animateCounter(counter, target), 400);
    });
  }

  // Персональное приветствие по имени из Telegram
  const greeting = document.getElementById('welcome-greeting');
  if (greeting) {
    const firstName = tg.initDataUnsafe?.user?.first_name;
    greeting.textContent = firstName ? `Привет, ${firstName}! 👋` : '';
  }

  hideBackBtn();

  // Проверяем незавершённый прогресс
  const savedAnswers = localStorage.getItem('stress_test_answers');
  const savedStep    = localStorage.getItem('stress_test_step');
  if (savedAnswers && savedStep) showContinueBanner(savedStep);

  setMainBtn('Начать стресс-тест', () => {
    localStorage.removeItem('stress_test_answers');
    localStorage.removeItem('stress_test_step');
    // Убираем баннер продолжения если был
    document.getElementById('continue-banner')?.remove();
    startQuiz();
  });
}

function showContinueBanner(step) {
  if (document.getElementById('continue-banner')) return;
  const content = document.querySelector('#screen-welcome .screen-content');
  const banner  = document.createElement('div');
  banner.id = 'continue-banner';
  banner.style.cssText = `
    margin-top: 20px; padding: 12px 14px; border-radius: 10px;
    background: var(--accent-light); border: 1px solid var(--accent);
    font-size: 13px; color: var(--tg-text); text-align: center; width: 100%;
  `;
  banner.innerHTML = `
    Есть незавершённый тест (шаг ${parseInt(step) + 1}).<br>
    <a id="continue-link" style="color:var(--accent);font-weight:600;cursor:pointer;">Продолжить</a>
    &nbsp;·&nbsp;
    <a id="restart-link" style="color:var(--tg-hint);cursor:pointer;">Начать заново</a>
  `;
  content.appendChild(banner);

  document.getElementById('continue-link')?.addEventListener('click', () => {
    const ans = JSON.parse(localStorage.getItem('stress_test_answers') || '{}');
    state.answers = { q1: [], q2: null, q3: null, q4: null, q5: null, q6: null, ...ans };
    state.questionIndex = parseInt(localStorage.getItem('stress_test_step') || '0');
    buildQuestionOrder();
    goTo('screen-question');
    renderQuestion();
  });

  document.getElementById('restart-link')?.addEventListener('click', () => {
    localStorage.removeItem('stress_test_answers');
    localStorage.removeItem('stress_test_step');
    banner.remove();
  });
}

// ─── КВИЗ ─────────────────────────────────────────────────────────────────────
function buildQuestionOrder() {
  state.questionOrder = state.answers.q1.includes('unknown')
    ? ['q1', 'q3', 'q4', 'q5', 'q6']
    : ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
}

function startQuiz() {
  state.answers      = { q1: [], q2: null, q3: null, q4: null, q5: null, q6: null };
  state.questionIndex = 0;
  state.resultSaved   = false; // сбросить при повторном прохождении
  buildQuestionOrder();
  goTo('screen-question');
  renderQuestion();
}

function renderQuestion() {
  const qId = state.questionOrder[state.questionIndex];
  const q   = QUESTIONS.find(q => q.id === qId);
  if (!q) return;

  const total   = state.questionOrder.length;
  const current = state.questionIndex + 1;

  // Прогресс-бар
  document.getElementById('progress-fill').style.width =
    ((state.questionIndex / total) * 100) + '%';
  document.getElementById('progress-text').textContent =
    `Вопрос ${current} из ${total}`;

  // Заголовок и подсказка
  document.getElementById('question-title').textContent = q.title;
  const hintEl = document.getElementById('question-hint');
  hintEl.textContent = q.hint || '';
  hintEl.style.display = q.hint ? 'block' : 'none';

  // Варианты ответов
  const list = document.getElementById('options-list');
  list.innerHTML = '';
  q.options.forEach(opt => renderOption(list, q, opt));

  // BackButton
  showBackBtn(handleBack);

  updateQuizMainBtn(q);
}

function renderOption(list, q, opt) {
  const card = document.createElement('div');
  card.className = 'option-card';
  card.dataset.id = opt.id;

  const indicator = document.createElement('div');
  indicator.className = q.type === 'multi' ? 'option-check' : 'option-radio';

  card.innerHTML = `<span class="option-emoji">${opt.emoji}</span><span class="option-text">${opt.text}</span>`;
  card.appendChild(indicator);

  // Восстановить выбранное состояние
  const saved = state.answers[q.id];
  const isSelected = q.type === 'multi'
    ? Array.isArray(saved) && saved.includes(opt.id)
    : saved === opt.id;
  if (isSelected) card.classList.add('selected');

  card.addEventListener('click', () => handleOptionClick(q, opt, card));
  list.appendChild(card);
}

function handleOptionClick(q, opt, card) {
  tg.HapticFeedback.selectionChanged();
  const cards = document.querySelectorAll('#options-list .option-card');

  if (q.type === 'single') {
    cards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.answers[q.id] = opt.id;

  } else {
    // Multi-select
    if (opt.exclusive) {
      const wasSelected = card.classList.contains('selected');
      cards.forEach(c => c.classList.remove('selected'));
      state.answers[q.id] = wasSelected ? [] : [opt.id];
      if (!wasSelected) card.classList.add('selected');
    } else {
      // Снимаем exclusive-вариант
      const excl = q.options.find(o => o.exclusive);
      if (excl) {
        document.querySelector(`[data-id="${excl.id}"]`)?.classList.remove('selected');
        state.answers[q.id] = (state.answers[q.id] || []).filter(id => id !== excl.id);
      }
      if (card.classList.contains('selected')) {
        card.classList.remove('selected');
        state.answers[q.id] = (state.answers[q.id] || []).filter(id => id !== opt.id);
      } else {
        card.classList.add('selected');
        state.answers[q.id] = [...(state.answers[q.id] || []), opt.id];
      }
    }
  }

  if (q.id === 'q1') buildQuestionOrder();
  updateQuizMainBtn(q);
  saveProgress();
}

function updateQuizMainBtn(q) {
  const answer   = state.answers[q.id];
  const hasAnswer = q.type === 'multi'
    ? Array.isArray(answer) && answer.length > 0
    : answer !== null;

  const isLast = state.questionIndex === state.questionOrder.length - 1;
  setMainBtn(isLast ? 'Узнать результат' : 'Далее', handleNextQuestion, hasAnswer);
}

function handleNextQuestion() {
  const isLast = state.questionIndex === state.questionOrder.length - 1;
  if (isLast) {
    goToLoading();
  } else {
    state.questionIndex++;
    goTo('screen-question');
    renderQuestion();
  }
}

function handleBack() {
  tg.HapticFeedback.selectionChanged();
  if (state.questionIndex === 0) {
    tg.BackButton.hide();
    goTo('screen-welcome', 'back');
    initWelcome();
  } else {
    state.questionIndex--;
    goTo('screen-question', 'back');
    renderQuestion();
  }
}

function saveProgress() {
  localStorage.setItem('stress_test_answers', JSON.stringify(state.answers));
  localStorage.setItem('stress_test_step', String(state.questionIndex));
}

// ─── ЭКРАН ЗАГРУЗКИ ───────────────────────────────────────────────────────────
function goToLoading() {
  hideMainBtn();
  hideBackBtn();
  goTo('screen-loading');

  const textEl = document.getElementById('loader-text');
  let i = 0;
  textEl.textContent = LOADING_MESSAGES[0];

  const interval = setInterval(() => {
    i++;
    if (i < LOADING_MESSAGES.length) {
      textEl.style.opacity = '0';
      setTimeout(() => {
        textEl.textContent = LOADING_MESSAGES[i];
        textEl.style.opacity = '1';
      }, 250);
    }
  }, 700);

  setTimeout(() => {
    clearInterval(interval);
    state.scoreResult = calculateScore(state.answers);
    localStorage.removeItem('stress_test_answers');
    localStorage.removeItem('stress_test_step');
    goToResult();
  }, 2800);
}

// ─── ЭКРАН РЕЗУЛЬТАТА ─────────────────────────────────────────────────────────

function goToResult() {
  goTo('screen-result');
  hideBackBtn();
  renderResult(state.scoreResult);

  // Стадия 1: сохранить прохождение в Google Sheets + отправить результат в Telegram
  // Fire-and-forget: не блокирует UI, ошибки не видны пользователю
  if (tg.initData && !state.resultSaved) {
    state.resultSaved = true;
    const r = state.scoreResult;
    fetch('/api/save-result', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-Telegram-Init-Data': tg.initData,
      },
      body: JSON.stringify({
        tg_user_id:  tg.initDataUnsafe?.user?.id        ?? null,
        tg_username: tg.initDataUnsafe?.user?.username  ?? null,
        first_name:  tg.initDataUnsafe?.user?.first_name ?? null,
        score:       r.total,
        level:       r.level,
        flags:       r.flags,
        blocks:      Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => [k, v.score])),
      }),
    }).catch(() => {});
  }

  // Встроенная карточка лидмагнита
  renderOfferCard();

  // Прямой контакт для высокого/критического риска
  const expertContact = document.getElementById('expert-contact');
  if (expertContact) {
    const level = state.scoreResult?.level;
    if (level === 'high' || level === 'critical') {
      expertContact.classList.remove('hidden');
      const btn = document.getElementById('btn-expert-contact');
      if (btn) btn.onclick = () => {
        tg.HapticFeedback.selectionChanged();
        try { tg.openTelegramLink(`https://t.me/${CONFIG.managerUsername}`); }
        catch (_) { window.open(`https://t.me/${CONFIG.managerUsername}`, '_blank'); }
      };
    } else {
      expertContact.classList.add('hidden');
    }
  }

  setMainBtn('Получить план усиления — бесплатно', () => {
    goTo('screen-contacts');
    initContactForm();
  });
}

function renderResult(r) {
  document.getElementById('result-score').textContent = `${r.total} / 100`;

  // Прогресс-бар итога
  const scoreFill = document.getElementById('score-fill');
  scoreFill.style.background = r.levelData.color;
  setTimeout(() => { scoreFill.style.width = r.total + '%'; }, 150);

  // Бейдж уровня
  const badge = document.getElementById('level-badge');
  badge.style.background = r.levelData.bgColor;
  badge.style.color      = r.levelData.color;
  document.getElementById('level-emoji').textContent = r.levelData.emoji;
  document.getElementById('level-text').textContent  = r.levelData.badge;

  // Сравнение и сообщение
  document.getElementById('score-avg').textContent =
    `Средний по нише: ${CONFIG.avgScore}/100 · ${CONFIG.avgSource}`;
  document.getElementById('score-message').textContent = r.levelData.message;

  // Карта рисков
  const riskMap = document.getElementById('risk-map');
  riskMap.innerHTML = '';
  Object.values(r.blocks).forEach(block => {
    const pct   = (block.score / block.max) * 100;
    const color = pct >= 70 ? '#43A047' : pct >= 40 ? '#FB8C00' : '#E53935';
    const flag  = pct === 0 ? '🔴' : pct < 50 ? '⚠️' : '';
    const row   = document.createElement('div');
    row.className = 'risk-row';
    row.innerHTML = `
      <span class="risk-row-icon">${block.icon}</span>
      <span class="risk-row-label">${block.label}</span>
      <div class="risk-bar-wrap"><div class="risk-bar-fill" style="background:${color}"></div></div>
      <span class="risk-row-score">${block.score}/${block.max}</span>
      <span class="risk-row-flag">${flag}</span>`;
    riskMap.appendChild(row);
    setTimeout(() => {
      row.querySelector('.risk-bar-fill').style.width = pct + '%';
    }, 200);
  });

  // Сценарий риска
  if (r.riskScenario) {
    const el = document.getElementById('risk-scenario');
    el.classList.remove('hidden');
    document.getElementById('risk-scenario-text').textContent =
      `Директ подорожал на ${r.riskScenario.pctGrowth}% → ` +
      `CPL: ~${r.riskScenario.cplFrom.toLocaleString('ru')} → ` +
      `~${r.riskScenario.cplTo.toLocaleString('ru')} ₽`;
  }

  // Топ-3 проблемы
  const problemsList = document.getElementById('problems-list');
  problemsList.innerHTML = '';
  if (!r.topProblems?.length) {
    problemsList.innerHTML = '<div style="font-size:14px;color:var(--tg-hint)">Серьёзных проблем не выявлено 👍</div>';
  } else {
    r.topProblems.forEach(p => {
      const card = document.createElement('div');
      card.className = 'problem-card';
      card.innerHTML = `<span class="problem-icon">⚡</span><span class="problem-text">${p.text}</span>`;
      problemsList.appendChild(card);
    });
  }

  // Кнопка «Поделиться»
  document.getElementById('btn-share').onclick = () => {
    tg.HapticFeedback.selectionChanged();
    const botUrl = `https://t.me/${CONFIG.botUsername}`;
    let shareText;
    if (r.level === 'good' || r.level === 'moderate') {
      // Хороший результат — показываем балл и уровень
      shareText = `Прошёл стресс-тест маркетинга клиники — ${r.total}/100 (${r.levelData.badge}).\nПроверьте свою клинику:\n${botUrl}`;
    } else {
      // Высокий/критический — не публикуем уровень, но показываем реальные проблемы
      const problems = (r.topProblems || []).slice(0, 3).map(p => `⚡ ${p.text}`).join('\n');
      shareText = `Прошёл стресс-тест маркетинга клиники — нашёл слабые места:\n${problems}\n\nПроверьте свою клинику:\n${botUrl}`;
    }
    const text = encodeURIComponent(shareText);
    try { tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${text}`); }
    catch (_) {}
  };
}

// ─── ЭКРАН ФОРМЫ КОНТАКТОВ ────────────────────────────────────────────────────
function initContactForm() {
  const user = tg.initDataUnsafe?.user || {};
  const nameInput = document.getElementById('input-name');
  if (user.first_name) {
    nameInput.value = [user.first_name, user.last_name].filter(Boolean).join(' ');
  }

  state.consentChecked = false;
  document.getElementById('consent-checkbox').classList.remove('checked');

  // Ссылка на политику — открываем экран внутри приложения
  const consentLink = document.getElementById('consent-link');
  consentLink.href = '#';
  const openPrivacy = (e) => {
    e.preventDefault();
    e.stopPropagation();
    goTo('screen-privacy');
    showBackBtn(() => {
      goTo('screen-contacts', 'back');
      showBackBtn(handleContactBack);
    });
  };
  consentLink.onclick = openPrivacy;

  // Чекбокс
  const consentWrap = document.getElementById('consent-wrap');
  // Убираем старый listener (клонированием)
  const newConsentWrap = consentWrap.cloneNode(true);
  consentWrap.parentNode.replaceChild(newConsentWrap, consentWrap);
  newConsentWrap.querySelector('#consent-link').onclick = openPrivacy;
  newConsentWrap.addEventListener('click', (e) => {
    if (e.target.id === 'consent-link') return;
    state.consentChecked = !state.consentChecked;
    newConsentWrap.querySelector('#consent-checkbox').classList.toggle('checked', state.consentChecked);
    tg.HapticFeedback.selectionChanged();
    validateForm();
  });

  // Телефон
  const phoneInput = document.getElementById('input-phone');
  phoneInput.value = '';
  phoneInput.oninput = () => { formatPhone(phoneInput); validateForm(); };

  // BackButton
  showBackBtn(handleContactBack);

  setMainBtn('Отправить', submitForm, false);
  validateForm();
}

function handleContactBack() {
  goTo('screen-result', 'back');
  hideBackBtn();
  setMainBtn('Получить план усиления — бесплатно', () => {
    goTo('screen-contacts');
    initContactForm();
  });
}

function formatPhone(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.startsWith('8')) v = '7' + v.slice(1);
  if (!v.startsWith('7')) v = '7' + v;
  v = v.slice(0, 11);
  let out = '+7';
  if (v.length > 1)  out += ` (${v.slice(1, 4)}`;
  if (v.length > 4)  out += `) ${v.slice(4, 7)}`;
  if (v.length > 7)  out += `-${v.slice(7, 9)}`;
  if (v.length > 9)  out += `-${v.slice(9, 11)}`;
  input.value = out;
}

function validateForm() {
  const phone = document.getElementById('input-phone').value.replace(/\D/g, '');
  const valid = phone.length >= 11 && state.consentChecked;
  if (valid) {
    tg.MainButton.enable();
    enableFallbackBtn();
  } else {
    tg.MainButton.disable();
    disableFallbackBtn();
  }
}

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
      blocks:      r?.blocks ? Object.fromEntries(Object.entries(r.blocks).map(([k,v]) => [k, v.score])) : {},
      tg_user_id:  tg.initDataUnsafe?.user?.id       ?? null,
      tg_username: tg.initDataUnsafe?.user?.username ?? null,
      timestamp:   new Date().toISOString(),
    };

    if (CONFIG.webhookUrl) {
      await fetch(CONFIG.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type':         'application/json',
          'X-Telegram-Init-Data': tg.initData || '',
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

// ─── ЭКРАН ПОДТВЕРЖДЕНИЯ ──────────────────────────────────────────────────────
function initDoneScreen() {
  hideMainBtn();
  hideBackBtn();

  document.getElementById('manager-name').textContent = CONFIG.managerName;
  document.getElementById('manager-role').textContent = CONFIG.managerRole;
  document.getElementById('manager-avatar').textContent = CONFIG.managerName[0];

  const btnChannel = document.getElementById('btn-channel');
  btnChannel.querySelector('span:last-child').textContent = `Канал ${CONFIG.agencyName}`;
  btnChannel.onclick = () => tg.openTelegramLink(CONFIG.channelUrl);

  // Кнопка прямого сообщения менеджеру
  const btnManagerTg = document.getElementById('btn-manager-tg');
  if (btnManagerTg && CONFIG.managerUsername) {
    btnManagerTg.onclick = () => {
      tg.HapticFeedback.selectionChanged();
      try { tg.openTelegramLink(`https://t.me/${CONFIG.managerUsername}`); }
      catch (_) { window.open(`https://t.me/${CONFIG.managerUsername}`, '_blank'); }
    };
  }

  document.getElementById('btn-close').onclick = () => {
    if (isInTelegram) tg.close();
    else window.close();
  };
}

// ─── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────────────────────────
function init() {
  tg.ready();
  tg.expand();
  applyTheme();
  initWelcome();
  // initOffer вызывается из goToResult() с задержкой 1.5 сек
}

document.addEventListener('DOMContentLoaded', init);

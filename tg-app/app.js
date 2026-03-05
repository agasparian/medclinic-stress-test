/**
 * app.js — Главная логика приложения «Маркетинговый стресс-тест клиники»
 *
 * Порядок работы:
 *   1. Инициализация Telegram WebApp
 *   2. Показ экрана welcome
 *   3. Квиз: последовательный показ вопросов (screen-question, динамический контент)
 *   4. Экран загрузки → расчёт скора → экран результата
 *   5. Форма контактов → подтверждение
 */

// ─── Telegram WebApp (с fallback для тестирования в браузере) ─────────────────
const tg = window.Telegram?.WebApp || {
  ready:           () => {},
  expand:          () => {},
  close:           () => {},
  openTelegramLink:(url) => window.open(url, '_blank'),
  sendData:        (data) => console.log('sendData:', data),
  themeParams:     {},
  colorScheme:     'light',
  initDataUnsafe:  { user: {} },
  MainButton: {
    text: '',
    isVisible: false,
    setText:  (t) => { tg.MainButton.text = t; },
    show:     () => { tg.MainButton.isVisible = true; renderFallbackBtn(); },
    hide:     () => { tg.MainButton.isVisible = false; removeFallbackBtn(); },
    enable:   () => {},
    disable:  () => {},
    showProgress: () => {},
    hideProgress: () => {},
    onClick:  (fn) => { tg.MainButton._handler = fn; },
    offClick: (fn) => { tg.MainButton._handler = null; },
    _handler: null,
  },
  BackButton: {
    isVisible: false,
    show:    () => { tg.BackButton.isVisible = true; },
    hide:    () => { tg.BackButton.isVisible = false; },
    onClick: (fn) => { tg.BackButton._handler = fn; },
    offClick:(fn) => { tg.BackButton._handler = null; },
    _handler: null,
  },
  HapticFeedback: {
    selectionChanged:    () => {},
    impactOccurred:      () => {},
    notificationOccurred:() => {},
  },
};

// ─── Браузерная кнопка (fallback при открытии не в Telegram) ─────────────────
function renderFallbackBtn() {
  let btn = document.getElementById('fallback-main-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'fallback-main-btn';
    btn.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0;
      height: 52px; background: #2AABEE; color: #fff;
      border: none; font-size: 15px; font-weight: 600;
      cursor: pointer; z-index: 9999;
      font-family: inherit;
    `;
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
      if (tg.MainButton._handler) tg.MainButton._handler();
    });
  }
  btn.textContent = tg.MainButton.text;
  btn.style.display = 'block';
}

function removeFallbackBtn() {
  const btn = document.getElementById('fallback-main-btn');
  if (btn) btn.style.display = 'none';
}

// ─── Состояние приложения ─────────────────────────────────────────────────────
const state = {
  currentScreen: 'screen-welcome', // id активного экрана
  questionOrder: [],                // порядок вопросов (может пропускать q2)
  questionIndex: 0,                 // текущий индекс в questionOrder
  answers: {
    q1: [],     // multi-select: массив id
    q2: null,   // single: id или null
    q3: null,
    q4: null,
    q5: null,
    q6: null,
  },
  scoreResult: null,    // результат calculateScore()
  consentChecked: false,
  mainBtnHandler: null, // текущий обработчик MainButton
};

// ─── Утилиты навигации ────────────────────────────────────────────────────────

/**
 * Переход на другой экран с анимацией slide.
 * direction: 'forward' (по умолчанию) | 'back'
 */
function goTo(screenId, direction = 'forward') {
  const fromEl = document.getElementById(state.currentScreen);
  const toEl   = document.getElementById(screenId);
  if (!toEl || fromEl === toEl) return;

  // Позиция входящего экрана до анимации
  toEl.style.transition = 'none';
  toEl.style.transform  = direction === 'forward' ? 'translateX(40%)' : 'translateX(-40%)';
  toEl.style.opacity    = '0';
  toEl.classList.add('active'); // делаем видимым (pointer-events off через opacity)

  // Форсируем перерисовку
  toEl.offsetHeight; // eslint-disable-line

  // Запускаем анимацию
  toEl.style.transition = '';
  toEl.style.transform  = 'translateX(0)';
  toEl.style.opacity    = '1';

  if (fromEl) {
    fromEl.style.transform = direction === 'forward' ? 'translateX(-40%)' : 'translateX(40%)';
    fromEl.style.opacity   = '0';
    setTimeout(() => {
      fromEl.classList.remove('active');
      fromEl.style.transform = '';
      fromEl.style.opacity   = '';
    }, 290);
  }

  state.currentScreen = screenId;
}

/** Установить обработчик MainButton (автоматически снимает предыдущий) */
function setMainBtn(text, handler, enabled = true) {
  tg.MainButton.offClick(state.mainBtnHandler);
  state.mainBtnHandler = handler;
  tg.MainButton.setText(text);
  if (enabled) tg.MainButton.enable(); else tg.MainButton.disable();
  tg.MainButton.onClick(state.mainBtnHandler);
  tg.MainButton.show();
  renderFallbackBtn(); // на случай браузера
}

/** Скрыть MainButton */
function hideMainBtn() {
  tg.MainButton.offClick(state.mainBtnHandler);
  state.mainBtnHandler = null;
  tg.MainButton.hide();
}

// ─── Применение темы Telegram ─────────────────────────────────────────────────
function applyTheme() {
  const p = tg.themeParams || {};
  const root = document.documentElement;

  if (p.bg_color)              root.style.setProperty('--tg-bg',        p.bg_color);
  if (p.secondary_bg_color)    root.style.setProperty('--tg-secondary',  p.secondary_bg_color);
  if (p.text_color)            root.style.setProperty('--tg-text',       p.text_color);
  if (p.hint_color)            root.style.setProperty('--tg-hint',       p.hint_color);
  if (p.link_color)            root.style.setProperty('--tg-link',       p.link_color);
  if (p.button_color)          root.style.setProperty('--tg-btn',        p.button_color);
  if (p.button_text_color)     root.style.setProperty('--tg-btn-text',   p.button_text_color);
  if (p.button_color)          root.style.setProperty('--accent',        p.button_color);

  if (tg.colorScheme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
  }
}

// ─── ЭКРАН 1: СТАРТ ───────────────────────────────────────────────────────────
function initWelcome() {
  // Счётчик прошедших
  const counter = document.getElementById('welcome-counter');
  if (counter) {
    counter.textContent = `Уже прошли ${CONFIG.totalAudited.toLocaleString('ru')} клиник`;
  }

  // Восстановить прогресс из localStorage
  const savedAnswers = localStorage.getItem('stress_test_answers');
  const savedStep    = localStorage.getItem('stress_test_step');
  if (savedAnswers && savedStep) {
    // Показываем подсказку «продолжить»
    showContinueBanner(savedStep);
  }

  tg.BackButton.hide();

  setMainBtn('Начать стресс-тест', () => {
    // Сбросить старый прогресс при новом старте
    localStorage.removeItem('stress_test_answers');
    localStorage.removeItem('stress_test_step');
    startQuiz();
  });
}

function showContinueBanner(step) {
  const content = document.querySelector('#screen-welcome .screen-content');
  const banner = document.createElement('div');
  banner.style.cssText = `
    margin-top: 20px; padding: 12px 14px; border-radius: 10px;
    background: var(--accent-light); border: 1px solid var(--accent);
    font-size: 13px; color: var(--tg-text); text-align: center; width: 100%;
  `;
  banner.innerHTML = `Есть незавершённый тест (шаг ${parseInt(step) + 1}).
    <br><a id="continue-link" style="color:var(--accent);font-weight:600;">Продолжить</a>
    &nbsp;·&nbsp;
    <a id="restart-link" style="color:var(--tg-hint);">Начать заново</a>`;
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

/** Определяет порядок вопросов с учётом ветвления */
function buildQuestionOrder() {
  const skipQ2 = state.answers.q1.includes('unknown');
  state.questionOrder = skipQ2
    ? ['q1', 'q3', 'q4', 'q5', 'q6']
    : ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
}

function startQuiz() {
  state.answers   = { q1: [], q2: null, q3: null, q4: null, q5: null, q6: null };
  state.questionIndex = 0;
  buildQuestionOrder();

  goTo('screen-question');
  renderQuestion();
}

/** Рендерит текущий вопрос в экране screen-question */
function renderQuestion() {
  const qId = state.questionOrder[state.questionIndex];
  const q   = QUESTIONS.find(q => q.id === qId);
  if (!q) return;

  // Прогресс-бар
  const total   = state.questionOrder.length;
  const current = state.questionIndex + 1;
  const pct     = ((state.questionIndex) / total) * 100;

  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `Вопрос ${current} из ${total}`;

  // Заголовок и подсказка
  document.getElementById('question-title').textContent = q.title;
  const hintEl = document.getElementById('question-hint');
  if (q.hint) {
    hintEl.textContent = q.hint;
    hintEl.classList.remove('hidden');
  } else {
    hintEl.classList.add('hidden');
  }

  // Варианты ответов
  const list = document.getElementById('options-list');
  list.innerHTML = '';
  q.options.forEach(opt => {
    const card = document.createElement('div');
    card.className = 'option-card';
    card.dataset.id = opt.id;

    // Индикатор выбора: чекбокс (multi) или радио (single)
    const indicator = document.createElement('div');
    indicator.className = q.type === 'multi' ? 'option-check' : 'option-radio';

    card.innerHTML = `
      <span class="option-emoji">${opt.emoji}</span>
      <span class="option-text">${opt.text}</span>
    `;
    card.appendChild(indicator);

    // Восстановить выбранное состояние
    const savedAnswer = state.answers[qId];
    if (q.type === 'multi' && Array.isArray(savedAnswer) && savedAnswer.includes(opt.id)) {
      card.classList.add('selected');
    } else if (q.type === 'single' && savedAnswer === opt.id) {
      card.classList.add('selected');
    }

    card.addEventListener('click', () => handleOptionClick(q, opt, card));
    list.appendChild(card);
  });

  // BackButton
  if (state.questionIndex === 0) {
    tg.BackButton.show();
    tg.BackButton.onClick(handleBack);
  } else {
    tg.BackButton.show();
    tg.BackButton.onClick(handleBack);
  }

  // MainButton — активна только если есть выбор
  updateMainBtn(q);
}

/** Обработка клика по варианту ответа */
function handleOptionClick(q, opt, card) {
  tg.HapticFeedback.selectionChanged();

  const cards = document.querySelectorAll('#options-list .option-card');

  if (q.type === 'single') {
    // Снимаем выбор со всех, выбираем только одну
    cards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.answers[q.id] = opt.id;

    // При single-select — небольшая задержка и переход (опционально)
    // Пользователь может нажать MainButton или дождаться автоперехода

  } else {
    // Multi-select
    if (opt.exclusive) {
      // «Не знаем» — снимает все остальные
      const wasSelected = card.classList.contains('selected');
      cards.forEach(c => c.classList.remove('selected'));
      if (!wasSelected) {
        card.classList.add('selected');
        state.answers[q.id] = [opt.id];
      } else {
        state.answers[q.id] = [];
      }
    } else {
      // Снимаем exclusive-вариант если он был выбран
      cards.forEach(c => {
        const cId = c.dataset.id;
        const cOpt = q.options.find(o => o.id === cId);
        if (cOpt?.exclusive) c.classList.remove('selected');
      });
      state.answers[q.id] = (state.answers[q.id] || []).filter(id => {
        const o = q.options.find(o => o.id === id);
        return !o?.exclusive;
      });

      // Переключаем текущую карточку
      if (card.classList.contains('selected')) {
        card.classList.remove('selected');
        state.answers[q.id] = state.answers[q.id].filter(id => id !== opt.id);
      } else {
        card.classList.add('selected');
        if (!state.answers[q.id]) state.answers[q.id] = [];
        state.answers[q.id].push(opt.id);
      }
    }
  }

  // Пересчёт порядка если изменился Q1 (может добавить/убрать Q2)
  if (q.id === 'q1') buildQuestionOrder();

  updateMainBtn(q);
  saveProgress();
}

/** Обновляет состояние MainButton в зависимости от наличия ответа */
function updateMainBtn(q) {
  const answer = state.answers[q.id];
  const hasAnswer = q.type === 'multi'
    ? Array.isArray(answer) && answer.length > 0
    : answer !== null;

  const isLast = state.questionIndex === state.questionOrder.length - 1;
  const btnText = isLast ? 'Узнать результат' : 'Далее';

  setMainBtn(btnText, handleNextQuestion, hasAnswer);

  // Серый цвет кнопки если нет выбора
  if (!hasAnswer) {
    tg.MainButton.disable();
  }
}

/** Переход к следующему вопросу или к загрузке */
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

/** Обработка BackButton — возврат на предыдущий вопрос или старт */
function handleBack() {
  tg.HapticFeedback.selectionChanged();

  if (state.questionIndex === 0) {
    // Вернуться на стартовый экран
    tg.BackButton.hide();
    goTo('screen-welcome', 'back');
    initWelcome();
  } else {
    state.questionIndex--;
    goTo('screen-question', 'back');
    renderQuestion();
  }
}

/** Сохранить прогресс в localStorage */
function saveProgress() {
  localStorage.setItem('stress_test_answers', JSON.stringify(state.answers));
  localStorage.setItem('stress_test_step', state.questionIndex.toString());
}

// ─── ЭКРАН ЗАГРУЗКИ ───────────────────────────────────────────────────────────
function goToLoading() {
  hideMainBtn();
  tg.BackButton.hide();
  goTo('screen-loading');
  runLoadingAnimation();
}

function runLoadingAnimation() {
  const textEl    = document.getElementById('loader-text');
  let   msgIndex  = 0;

  // Меняем текст каждые 700 мс
  textEl.textContent = LOADING_MESSAGES[0];
  const interval = setInterval(() => {
    msgIndex++;
    if (msgIndex < LOADING_MESSAGES.length) {
      textEl.style.opacity = '0';
      setTimeout(() => {
        textEl.textContent = LOADING_MESSAGES[msgIndex];
        textEl.style.opacity = '1';
      }, 200);
    }
  }, 700);

  // Через ~2.8 сек переходим к результату
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
  const r = state.scoreResult;
  goTo('screen-result');
  renderResult(r);

  // BackButton скрыт — нет смысла возвращаться к квизу
  tg.BackButton.hide();

  setMainBtn('Получить план усиления — бесплатно', () => {
    goTo('screen-contacts');
    initContactForm();
  });
}

function renderResult(r) {
  // Балл
  document.getElementById('result-score').textContent = `${r.total} / 100`;

  // Прогресс-бар (анимация запускается после перехода)
  const scoreFill = document.getElementById('score-fill');
  scoreFill.style.background = r.levelData.color;
  setTimeout(() => {
    scoreFill.style.width = r.total + '%';
  }, 100);

  // Бейдж уровня
  const badge = document.getElementById('level-badge');
  badge.style.background = r.levelData.bgColor;
  badge.style.color       = r.levelData.color;
  document.getElementById('level-emoji').textContent = r.levelData.emoji;
  document.getElementById('level-text').textContent  = r.levelData.badge;

  // Сравнение со средним
  document.getElementById('score-avg').textContent =
    `Средний по нише: ${CONFIG.avgScore}/100 · ${CONFIG.avgSource}`;

  // Сообщение
  document.getElementById('score-message').textContent = r.levelData.message;

  // Карта рисков
  renderRiskMap(r);

  // Сценарий риска
  if (r.riskScenario) {
    const scenarioEl = document.getElementById('risk-scenario');
    const textEl     = document.getElementById('risk-scenario-text');
    scenarioEl.classList.remove('hidden');
    textEl.textContent =
      `Директ подорожал на ${r.riskScenario.pctGrowth}% → ` +
      `CPL: ~${r.riskScenario.cplFrom.toLocaleString('ru')} → ` +
      `~${r.riskScenario.cplTo.toLocaleString('ru')} ₽`;
  }

  // Топ-3 проблемы
  renderProblems(r.topProblems);

  // Кнопка «Поделиться»
  document.getElementById('btn-share').addEventListener('click', shareResult);
}

function renderRiskMap(r) {
  const container = document.getElementById('risk-map');
  container.innerHTML = '';

  Object.values(r.blocks).forEach(block => {
    const pct   = (block.score / block.max) * 100;
    const color = scoreToColor(pct);

    // Определяем иконку статуса
    let flagIcon = '';
    if (pct === 0)        flagIcon = '🔴';
    else if (pct < 50)    flagIcon = '⚠️';

    const row = document.createElement('div');
    row.className = 'risk-row';
    row.innerHTML = `
      <span class="risk-row-icon">${block.icon}</span>
      <span class="risk-row-label">${block.label}</span>
      <div class="risk-bar-wrap">
        <div class="risk-bar-fill" style="background:${color}"></div>
      </div>
      <span class="risk-row-score">${block.score}/${block.max}</span>
      <span class="risk-row-flag">${flagIcon}</span>
    `;
    container.appendChild(row);

    // Анимация полоски с задержкой
    setTimeout(() => {
      row.querySelector('.risk-bar-fill').style.width = pct + '%';
    }, 200);
  });
}

function renderProblems(problems) {
  const container = document.getElementById('problems-list');
  container.innerHTML = '';

  if (!problems || problems.length === 0) {
    container.innerHTML = '<div style="font-size:14px;color:var(--tg-hint);">Серьёзных проблем не выявлено 👍</div>';
    return;
  }

  problems.forEach(p => {
    const card = document.createElement('div');
    card.className = 'problem-card';
    card.innerHTML = `
      <span class="problem-icon">⚡</span>
      <span class="problem-text">${p.text}</span>
    `;
    container.appendChild(card);
  });
}

/** Цвет полоски: от красного (0%) до зелёного (100%) */
function scoreToColor(pct) {
  if (pct >= 70) return '#43A047';
  if (pct >= 40) return '#FB8C00';
  return '#E53935';
}

/** Поделиться результатом через Telegram */
function shareResult() {
  tg.HapticFeedback.selectionChanged();
  const r    = state.scoreResult;
  const text = encodeURIComponent(
    `Прошёл маркетинговый стресс-тест клиники и набрал ${r.total}/100 (${r.levelData.badge}).\n` +
    `Проверьте свою клинику: @medmarket_bot` // ← замените на вашего бота
  );
  try {
    tg.openTelegramLink(`https://t.me/share/url?url=https://t.me/medmarket_bot&text=${text}`);
  } catch (_) {
    // Fallback для браузера
    navigator.clipboard?.writeText(decodeURIComponent(text));
  }
}

// ─── ЭКРАН ФОРМЫ КОНТАКТОВ ────────────────────────────────────────────────────
function initContactForm() {
  // Автозаполнение имени из Telegram
  const user = tg.initDataUnsafe?.user || {};
  const nameInput  = document.getElementById('input-name');
  const phoneInput = document.getElementById('input-phone');

  if (user.first_name) {
    nameInput.value = user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.first_name;
  }

  // BackButton → возврат к результату
  tg.BackButton.show();
  tg.BackButton.onClick(() => {
    goTo('screen-result', 'back');
    tg.BackButton.hide();
    setMainBtn('Получить план усиления — бесплатно', () => {
      goTo('screen-contacts');
      initContactForm();
    });
  });

  // Сбрасываем согласие
  state.consentChecked = false;
  document.getElementById('consent-checkbox').classList.remove('checked');

  // Ссылка на политику конфиденциальности
  const consentLink = document.getElementById('consent-link');
  consentLink.href = CONFIG.privacyUrl;
  consentLink.addEventListener('click', (e) => {
    e.preventDefault();
    tg.openTelegramLink(CONFIG.privacyUrl);
  });

  // Чекбокс согласия
  document.getElementById('consent-wrap').addEventListener('click', () => {
    state.consentChecked = !state.consentChecked;
    const cb = document.getElementById('consent-checkbox');
    if (state.consentChecked) {
      cb.classList.add('checked');
    } else {
      cb.classList.remove('checked');
    }
    tg.HapticFeedback.selectionChanged();
    validateForm();
  });

  // Валидация при вводе телефона
  phoneInput.addEventListener('input', () => {
    formatPhone(phoneInput);
    validateForm();
  });

  setMainBtn('Отправить', submitForm, false);
  validateForm();
}

/** Простое форматирование телефона */
function formatPhone(input) {
  let val = input.value.replace(/\D/g, '');
  if (val.startsWith('8')) val = '7' + val.slice(1);
  if (val.startsWith('7') && val.length > 1) {
    val = val.slice(0, 11);
    const parts = [
      '+7',
      val.length > 1  ? ` (${val.slice(1, 4)}`   : '',
      val.length > 4  ? `) ${val.slice(4, 7)}`    : '',
      val.length > 7  ? `-${val.slice(7, 9)}`     : '',
      val.length > 9  ? `-${val.slice(9, 11)}`    : '',
    ];
    input.value = parts.join('');
  }
}

/** Проверяет валидность формы и включает/выключает MainButton */
function validateForm() {
  const phone = document.getElementById('input-phone').value.replace(/\D/g, '');
  const valid = phone.length >= 11 && state.consentChecked;
  if (valid) {
    tg.MainButton.enable();
  } else {
    tg.MainButton.disable();
  }
  renderFallbackBtn();
}

/** Отправка формы */
async function submitForm() {
  const name   = document.getElementById('input-name').value.trim();
  const phone  = document.getElementById('input-phone').value.trim();
  const clinic = document.getElementById('input-clinic').value.trim();
  const r      = state.scoreResult;

  if (!phone) return;

  // Показываем индикатор загрузки на кнопке
  tg.MainButton.showProgress();
  tg.MainButton.disable();

  const payload = {
    name,
    phone,
    clinic:    clinic || null,
    score:     r.total,
    level:     r.level,
    flags:     r.flags,
    blocks: Object.fromEntries(
      Object.entries(r.blocks).map(([k, v]) => [k, v.score])
    ),
    tg_user_id:  tg.initDataUnsafe?.user?.id       || null,
    tg_username: tg.initDataUnsafe?.user?.username || null,
    timestamp:   new Date().toISOString(),
  };

  // Отправка на webhook (если настроен)
  if (CONFIG.webhookUrl) {
    try {
      await fetch(CONFIG.webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Webhook недоступен:', err);
      // Продолжаем — не блокируем UX из-за ошибки отправки
    }
  }

  // Переход на экран подтверждения
  tg.MainButton.hideProgress();
  goTo('screen-done');
  initDoneScreen();
}

// ─── ЭКРАН ПОДТВЕРЖДЕНИЯ ──────────────────────────────────────────────────────
function initDoneScreen() {
  hideMainBtn();
  tg.BackButton.hide();

  // Данные менеджера из конфига
  document.getElementById('manager-name').textContent = CONFIG.managerName;
  document.getElementById('manager-role').textContent = CONFIG.managerRole;
  document.getElementById('manager-avatar').textContent =
    CONFIG.managerName.charAt(0).toUpperCase();

  // Кнопка «Канал агентства»
  const btnChannel = document.getElementById('btn-channel');
  btnChannel.querySelector('span:last-child').textContent = `Канал ${CONFIG.agencyName}`;
  btnChannel.onclick = () => {
    tg.openTelegramLink(CONFIG.channelUrl);
  };

  // Кнопка «Закрыть»
  document.getElementById('btn-close').onclick = () => {
    tg.close();
  };
}

// ─── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────────────────────────
function init() {
  // Инициализируем Telegram WebApp
  tg.ready();
  tg.expand();

  // Применяем тему
  applyTheme();

  // Запускаем стартовый экран
  initWelcome();
}

// Запуск когда DOM готов
document.addEventListener('DOMContentLoaded', init);

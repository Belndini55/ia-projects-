(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const TYPE_INFO = {
    hotkey: { title: 'Skrót klawiszowy', badge: 'SKRÓT', description: 'Wciśnij kilka klawiszy jednocześnie.', icon: 'hotkey' },
    key: { title: 'Naciśnij klawisz', badge: 'KLAWISZ', description: 'Wyślij pojedyncze naciśnięcie klawisza.', icon: 'key' },
    text: { title: 'Wpisz tekst', badge: 'TEKST', description: 'Wstaw tekst do aktywnego pola.', icon: 'text' },
    click: { title: 'Kliknij', badge: 'KLIKNIĘCIE', description: 'Kliknij wskazane miejsce na ekranie.', icon: 'click' },
    move: { title: 'Przesuń kursor', badge: 'RUCH MYSZY', description: 'Przenieś kursor w wybrane miejsce.', icon: 'move' },
    scroll: { title: 'Przewiń', badge: 'PRZEWIJANIE', description: 'Przewiń zawartość aktywnego okna.', icon: 'scroll' },
    delay: { title: 'Opóźnienie', badge: 'OCZEKIWANIE', description: 'Dodaj przerwę między działaniami.', icon: 'delay' },
    loop: { title: 'Pętla', badge: 'PĘTLA', description: 'Powtórz grupę kroków określoną liczbę razy.', icon: 'loop' },
  };
  const ICONS = {
    hotkey: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M6 9h2m2 0h2m2 0h2M6 13h3m2 0h2m2 0h2M8 16h8"></path></svg>',
    key: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M9 16h6"></path></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16m-3 0h6"></path></svg>',
    click: '<svg viewBox="0 0 24 24"><path d="m6 3 12 11-6 .8-3.2 5.2L6 3Z"></path></svg>',
    move: '<svg viewBox="0 0 24 24"><path d="M12 3v18m-9-9h18M12 3l-3 3m3-3 3 3M3 12l3-3m-3 3 3 3m12-3-3-3m3 3-3 3M12 21l-3-3m3 3 3-3"></path></svg>',
    scroll: '<svg viewBox="0 0 24 24"><path d="M12 4v16m-5-5 5 5 5-5M7 8l5-5 5 5"></path></svg>',
    delay: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3 2"></path></svg>',
    loop: '<svg viewBox="0 0 24 24"><path d="M19 7h-9a4 4 0 0 0-4 4v1m0 0 3-3m-3 3-3-3M5 17h9a4 4 0 0 0 4-4v-1m0 0-3 3m3-3 3 3"></path></svg>',
    macro: '<svg viewBox="0 0 24 24"><path d="M7 5h10M7 12h10M7 19h10"></path><circle cx="4" cy="5" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="19" r="1"></circle></svg>',
  };
  const ACTION_OPTIONS = [
    ['hotkey', 'Skrót klawiszowy', 'Wciśnij kombinację, np. Ctrl + C.'],
    ['key', 'Naciśnij klawisz', 'Enter, Tab, strzałka lub klawisz funkcyjny.'],
    ['text', 'Wpisz tekst', 'Wstaw gotową treść do aktywnego pola.'],
    ['click', 'Kliknij', 'Kliknij punkt na ekranie, wybierz przycisk i liczbę kliknięć.'],
    ['move', 'Przesuń kursor', 'Przenieś wskaźnik z opcjonalną animacją.'],
    ['scroll', 'Przewiń', 'Przewiń aktywne okno w górę lub w dół.'],
    ['delay', 'Opóźnienie', 'Poczekaj na reakcję aplikacji lub strony.'],
    ['loop', 'Pętla', 'Zgrupuj akcje i powtórz je wielokrotnie.'],
  ];

  const state = {
    macros: [],
    activeId: null,
    selectedStepId: null,
    collapsed: new Set(),
    search: '',
    addingInto: null,
    currentRun: null,
    saveTimer: null,
    saveRevision: 0,
    pollTimer: null,
    pendingConfirm: null,
    drag: null,
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (!response.ok) throw new Error(result.error || `Błąd serwera (${response.status})`);
    return result;
  }

  const activeMacro = () => state.macros.find(macro => macro.id === state.activeId) || null;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const titleCaseKey = key => ({ ctrl: 'Ctrl', control: 'Ctrl', command: '⌘', cmd: '⌘', meta: '⌘', alt: 'Alt', option: 'Option', shift: 'Shift', enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Esc', escape: 'Esc', space: 'Spacja', up: '↑', down: '↓', left: '←', right: '→', pageup: 'Page Up', pagedown: 'Page Down' }[String(key).toLowerCase()] || String(key).toUpperCase());

  function visitSteps(steps, visitor, parentId = '') {
    (steps || []).forEach((step, index) => {
      visitor(step, index, parentId, steps);
      if (step.type === 'loop') visitSteps(step.children || [], visitor, step.id);
    });
  }

  function findStep(stepId) {
    let found = null;
    const macro = activeMacro();
    if (!macro) return null;
    visitSteps(macro.steps, step => { if (step.id === stepId) found = step; });
    return found;
  }

  function findContext(stepId) {
    let found = null;
    const macro = activeMacro();
    if (!macro) return null;
    visitSteps(macro.steps, (step, index, parentId, array) => {
      if (step.id === stepId) found = { step, index, parentId, array };
    });
    return found;
  }

  function totalSteps(steps) {
    return (steps || []).reduce((total, step) => total + 1 + (step.type === 'loop' ? totalSteps(step.children) : 0), 0);
  }

  function estimateSeconds(steps) {
    return (steps || []).reduce((total, step) => {
      if (step.type === 'loop') return total + estimateSeconds(step.children) * (Number(step.count) || 1);
      if (step.type === 'delay') return total + (Number(step.duration_ms) || 0) / 1000;
      if (step.type === 'text') return total + String(step.text || '').length * (Number(step.interval_ms) || 0) / 1000;
      if (step.type === 'move') return total + (Number(step.duration_ms) || 0) / 1000;
      if (step.type === 'click') return total + .18 * (Number(step.clicks) || 1);
      return total + .08;
    }, 0);
  }

  function formatDuration(seconds) {
    if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
    return `${Math.round(seconds * 10) / 10} s`;
  }

  function stepDetail(step) {
    switch (step.type) {
      case 'hotkey': return (step.keys || []).map(titleCaseKey).join(' + ');
      case 'key': return `Naciśnij ${titleCaseKey(step.key || 'enter')}`;
      case 'text': {
        const text = String(step.text || '').replace(/\n/g, ' ↵ ').replace(/\t/g, ' ⇥ ');
        return text ? `„${text.slice(0, 43)}${text.length > 43 ? '…' : ''}”` : 'Wpisz tekst…';
      }
      case 'click': return `${Number(step.clicks) > 1 ? `${step.clicks}× kliknięcie` : 'Kliknięcie'} · ${step.x}, ${step.y}`;
      case 'move': return `Pozycja ${step.x}, ${step.y} · ${step.duration_ms || 0} ms`;
      case 'scroll': return `${Number(step.amount) > 0 ? 'W górę' : 'W dół'} · ${Math.abs(Number(step.amount) || 0)}`;
      case 'delay': return `Odczekaj ${step.duration_ms || 0} ms`;
      case 'loop': return `${step.count || 1}× · ${(step.children || []).length} ${(step.children || []).length === 1 ? 'krok' : 'kroki'}`;
      default: return '';
    }
  }

  function stepTitle(step) {
    const info = TYPE_INFO[step.type] || { title: 'Akcja' };
    return step.label || info.title;
  }

  function renderSidebar() {
    const list = $('#macroList');
    const filtered = state.macros.filter(macro => `${macro.name} ${macro.description}`.toLowerCase().includes(state.search.toLowerCase()));
    $('#libraryCount').textContent = String(state.macros.length);
    list.innerHTML = filtered.length ? filtered.map((macro, index) => `
      <button class="macro-list-item ${macro.id === state.activeId ? 'active' : ''}" type="button" data-macro-id="${escapeHTML(macro.id)}" title="${escapeHTML(macro.name)}">
        <span class="macro-list-icon">${ICONS.macro}</span>
        <span class="macro-list-copy"><strong>${escapeHTML(macro.name || 'Bez nazwy')}</strong><span>${totalSteps(macro.steps)} ${totalSteps(macro.steps) === 1 ? 'krok' : 'kroków'}${macro.trigger ? ` · ${escapeHTML(macro.trigger)}` : ''}</span></span>
        ${macro.id === state.activeId ? '<span class="macro-active-dot"></span>' : ''}
      </button>`).join('') : '<div class="no-search-results">Nie znaleziono makr. Spróbuj innej nazwy.</div>';
  }

  function renderHeader() {
    const macro = activeMacro();
    if (!macro) return;
    $('#breadcrumbName').textContent = macro.name || 'Bez nazwy';
    setValueIfNotFocused($('#macroName'), macro.name);
    setValueIfNotFocused($('#macroDescription'), macro.description);
    setValueIfNotFocused($('#triggerInput'), macro.trigger);
    $('#stepCount').textContent = `${totalSteps(macro.steps)} ${totalSteps(macro.steps) === 1 ? 'krok' : 'kroków'}`;
    $('#durationEstimate').textContent = `~ ${formatDuration(estimateSeconds(macro.steps))}`;
  }

  function setValueIfNotFocused(element, value) {
    if (document.activeElement !== element) element.value = value || '';
  }

  function renderStep(step, index, parentId, level, counter) {
    const number = ++counter.value;
    const info = TYPE_INFO[step.type] || TYPE_INFO.key;
    const details = stepDetail(step);
    const selected = step.id === state.selectedStepId;
    const isLoop = step.type === 'loop';
    const isCollapsed = state.collapsed.has(step.id);
    const parent = escapeHTML(parentId || '');
    const tools = `
      <span class="step-tools">
        <button class="step-tool" type="button" data-step-action="up" data-step-id="${escapeHTML(step.id)}" title="Przesuń wyżej" aria-label="Przesuń wyżej">↑</button>
        <button class="step-tool" type="button" data-step-action="down" data-step-id="${escapeHTML(step.id)}" title="Przesuń niżej" aria-label="Przesuń niżej">↓</button>
        <button class="step-tool" type="button" data-step-action="duplicate" data-step-id="${escapeHTML(step.id)}" title="Duplikuj krok" aria-label="Duplikuj krok">${ICONS.macro}</button>
        <button class="step-tool remove-step" type="button" data-step-action="delete" data-step-id="${escapeHTML(step.id)}" title="Usuń krok" aria-label="Usuń krok">×</button>
      </span>`;
    const children = isLoop ? `
      <div class="step-list nested" data-parent-id="${escapeHTML(step.id)}" ${isCollapsed ? 'hidden' : ''}>
        ${(step.children || []).map((child, childIndex) => renderStep(child, childIndex, step.id, level + 1, counter)).join('')}
        <button class="nested-add" type="button" data-step-action="add-child" data-step-id="${escapeHTML(step.id)}"><span>+</span> Dodaj w pętli</button>
      </div>` : '';
    return `
      <div class="step-wrap" data-step-id="${escapeHTML(step.id)}" data-parent-id="${parent}" draggable="true">
        <div class="step-card ${selected ? 'selected' : ''}" data-step-id="${escapeHTML(step.id)}" tabindex="0" role="button" aria-label="Edytuj krok ${number}: ${escapeHTML(stepTitle(step))}">
          ${isLoop ? `<button class="loop-expand" type="button" data-step-action="toggle-loop" data-step-id="${escapeHTML(step.id)}" aria-label="${isCollapsed ? 'Rozwiń' : 'Zwiń'} pętlę">${isCollapsed ? '›' : '⌄'}</button>` : `<span class="step-number">${number.toString().padStart(2, '0')}</span>`}
          <span class="step-icon type-${escapeHTML(step.type)}">${ICONS[info.icon]}</span>
          <span class="step-copy"><span class="step-copy-top"><strong>${escapeHTML(stepTitle(step))}</strong><span class="step-type-badge ${isLoop ? 'badge-loop' : ''}">${info.badge}</span></span><span>${escapeHTML(details)}</span></span>
          ${step.type === 'delay' ? `<span class="step-duration">${escapeHTML(formatDuration((Number(step.duration_ms) || 0) / 1000))}</span>` : ''}
          ${tools}
        </div>
        ${children}
      </div>`;
  }

  function renderSteps() {
    const macro = activeMacro();
    if (!macro) return;
    const root = $('#stepList');
    const counter = { value: 0 };
    root.innerHTML = (macro.steps || []).map((step, index) => renderStep(step, index, '', 0, counter)).join('');
    $('#emptyFlow').hidden = macro.steps.length !== 0;
    $('#addStepButton').innerHTML = `<span class="add-step-plus">+</span><span>${state.addingInto ? 'Dodaj krok w pętli' : 'Dodaj krok'}</span><kbd>A</kbd>`;
    renderHeader();
  }

  function inputField(label, field, value, options = {}) {
    const { type = 'text', placeholder = '', hint = '', suffix = '', min = '', max = '', step = '1', rows = 4 } = options;
    const safe = escapeHTML(value ?? '');
    const control = type === 'textarea'
      ? `<textarea class="field-control" data-field="${field}" rows="${rows}" placeholder="${escapeHTML(placeholder)}">${safe}</textarea>`
      : `<input class="field-control" data-field="${field}" type="${type}" value="${safe}" placeholder="${escapeHTML(placeholder)}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} ${type === 'number' ? `step="${step}"` : ''} autocomplete="off">`;
    return `<div class="field-group"><label class="field-label">${escapeHTML(label)}${options.labelHint ? `<span class="field-hint">${escapeHTML(options.labelHint)}</span>` : ''}</label>${suffix ? `<div class="field-suffix">${control}<span>${escapeHTML(suffix)}</span></div>` : control}${hint ? `<p class="field-help">${escapeHTML(hint)}</p>` : ''}</div>`;
  }

  function selectField(label, field, value, choices) {
    return `<div class="field-group"><label class="field-label">${escapeHTML(label)}</label><select class="field-control" data-field="${field}">${choices.map(([key, title]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${title}</option>`).join('')}</select></div>`;
  }

  function renderInspector() {
    const body = $('#inspectorBody');
    const step = findStep(state.selectedStepId);
    if (!step) {
      $('#inspectorTitle').textContent = 'Właściwości';
      body.innerHTML = `
        <div class="inspector-empty"><div class="inspector-empty-icon">${ICONS.macro}</div><strong>Wybierz krok na osi czasu</strong><p>Ustawienia wybranej akcji pojawią się tutaj. Możesz też przeciągać kroki, aby zmienić ich kolejność.</p></div>
        <div class="field-divider"></div>
        <div class="inspector-summary"><div class="field-label">PODSUMOWANIE MAKRA</div><div class="summary-grid"><div><strong>${totalSteps((activeMacro() || {}).steps)}<small>kroków</small></strong></div><div><strong>${escapeHTML(formatDuration(estimateSeconds((activeMacro() || {}).steps)))}<small>orientacyjnie</small></strong></div></div></div>`;
      return;
    }
    const info = TYPE_INFO[step.type] || TYPE_INFO.key;
    $('#inspectorTitle').textContent = info.title;
    let fields = `<div class="inspector-type"><span class="step-icon type-${escapeHTML(step.type)}">${ICONS[info.icon]}</span><span class="inspector-type-copy"><strong>${info.title}</strong><span>${info.description}</span></span></div>`;
    fields += inputField('Własna etykieta', 'label', step.label || '', { placeholder: info.title, hint: 'Opcjonalnie — ułatwia czytanie długich makr.' });
    fields += '<div class="field-divider"></div><div class="field-label">USTAWIENIA AKCJI</div>';
    if (step.type === 'hotkey') {
      fields += inputField('Klawisze', 'keys', (step.keys || []).map(titleCaseKey).join(' + '), { placeholder: 'Ctrl + C', hint: 'Oddziel klawisze znakiem +, np. Ctrl + Shift + S.' });
    } else if (step.type === 'key') {
      fields += inputField('Klawisz', 'key', step.key || 'enter', { placeholder: 'enter', hint: 'Litera, cyfra, enter, tab, strzałka lub F1–F24.' });
    } else if (step.type === 'text') {
      fields += inputField('Treść', 'text', step.text || '', { type: 'textarea', placeholder: 'Wpisz tekst, który ma zostać wstawiony…', hint: 'Obsługuje polskie znaki i nowe linie.' });
      fields += inputField('Odstęp między znakami', 'interval_ms', step.interval_ms ?? 8, { type: 'number', min: 0, max: 1000, suffix: 'ms', hint: 'Ustaw 0, aby wpisać tekst możliwie szybko.' });
    } else if (step.type === 'click') {
      fields += `<div class="field-row">${inputField('Pozycja X', 'x', step.x ?? 640, { type: 'number', min: 0, max: 20000 })}${inputField('Pozycja Y', 'y', step.y ?? 360, { type: 'number', min: 0, max: 20000 })}</div>`;
      fields += selectField('Przycisk myszy', 'button', step.button || 'left', [['left', 'Lewy'], ['right', 'Prawy'], ['middle', 'Środkowy']]);
      fields += inputField('Liczba kliknięć', 'clicks', step.clicks ?? 1, { type: 'number', min: 1, max: 10 });
      fields += '<p class="field-help">Współrzędne są liczone od lewego górnego rogu ekranu.</p>';
    } else if (step.type === 'move') {
      fields += `<div class="field-row">${inputField('Pozycja X', 'x', step.x ?? 640, { type: 'number', min: 0, max: 20000 })}${inputField('Pozycja Y', 'y', step.y ?? 360, { type: 'number', min: 0, max: 20000 })}</div>`;
      fields += inputField('Czas ruchu', 'duration_ms', step.duration_ms ?? 250, { type: 'number', min: 0, max: 60000, suffix: 'ms' });
    } else if (step.type === 'scroll') {
      fields += inputField('Kierunek i siła', 'amount', step.amount ?? 3, { type: 'number', min: -1000, max: 1000, hint: 'Wartość dodatnia przewija w górę, ujemna — w dół.' });
    } else if (step.type === 'delay') {
      fields += inputField('Czas oczekiwania', 'duration_ms', step.duration_ms ?? 500, { type: 'number', min: 0, max: 300000, suffix: 'ms', hint: 'Przydatne po otwieraniu okien lub ładowaniu stron.' });
    } else if (step.type === 'loop') {
      fields += inputField('Powtórzenia', 'count', step.count ?? 3, { type: 'number', min: 1, max: 100, suffix: '×', hint: 'Wewnątrz pętli możesz zagnieżdżać kolejne akcje i pętle.' });
      fields += `<div class="inspector-loop-summary"><span>${ICONS.macro}</span><span>${(step.children || []).length} ${(step.children || []).length === 1 ? 'krok' : 'kroki'} wewnątrz pętli</span></div>`;
      fields += `<button class="button button-quiet inspector-add-child" type="button" data-add-child="${escapeHTML(step.id)}"><span>＋</span> Dodaj akcję do pętli</button>`;
    }
    body.innerHTML = fields;
  }

  function renderAll() {
    renderSidebar();
    renderHeader();
    renderSteps();
    renderInspector();
  }

  function setSaveStatus(text, kind = '') {
    const element = $('#saveState');
    element.className = `save-indicator ${kind}`.trim();
    element.lastElementChild.textContent = text;
  }

  function scheduleSave() {
    const macro = activeMacro();
    if (!macro) return;
    state.saveRevision += 1;
    const revision = state.saveRevision;
    setSaveStatus('Zapisywanie…', 'saving');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => persistMacro(revision), 420);
  }

  async function persistMacro(revision) {
    const macro = activeMacro();
    if (!macro) return;
    try {
      await api(`/api/macros/${encodeURIComponent(macro.id)}`, { method: 'PUT', body: JSON.stringify(macro) });
      if (revision === state.saveRevision) setSaveStatus('Zapisano');
    } catch (error) {
      if (revision === state.saveRevision) setSaveStatus('Błąd zapisu', 'error');
      showToast(error.message, 'error');
    }
  }

  function defaultStep(type) {
    const base = { id: uid(), type, label: '' };
    const data = {
      hotkey: { keys: ['ctrl', 'c'] },
      key: { key: 'enter' },
      text: { text: '', interval_ms: 8 },
      click: { x: 640, y: 360, button: 'left', clicks: 1 },
      move: { x: 640, y: 360, duration_ms: 250 },
      scroll: { amount: 3 },
      delay: { duration_ms: 500 },
      loop: { count: 3, children: [] },
    };
    return { ...base, ...data[type] };
  }

  function openActionMenu(parentId = null) {
    state.addingInto = parentId;
    $('#addStepButton').innerHTML = `<span class="add-step-plus">+</span><span>${parentId ? 'Dodaj krok w pętli' : 'Dodaj krok'}</span><kbd>A</kbd>`;
    $('#actionMenuBackdrop').hidden = false;
    $('#actionMenu').hidden = false;
  }

  function closeActionMenu() {
    $('#actionMenuBackdrop').hidden = true;
    $('#actionMenu').hidden = true;
    state.addingInto = null;
    const selected = findStep(state.selectedStepId);
    $('#addStepButton').innerHTML = `<span class="add-step-plus">+</span><span>${selected && selected.type === 'loop' ? 'Dodaj krok w pętli' : 'Dodaj krok'}</span><kbd>A</kbd>`;
  }

  function addStep(type, parentId = null) {
    const macro = activeMacro();
    if (!macro) return;
    const step = defaultStep(type);
    if (parentId) {
      const parent = findStep(parentId);
      if (!parent || parent.type !== 'loop') return;
      parent.children.push(step);
      state.collapsed.delete(parentId);
    } else {
      macro.steps.push(step);
    }
    state.selectedStepId = step.id;
    renderSteps();
    renderSidebar();
    renderInspector();
    scheduleSave();
  }

  function removeStep(stepId) {
    const context = findContext(stepId);
    if (!context) return;
    context.array.splice(context.index, 1);
    state.selectedStepId = null;
    renderAll();
    scheduleSave();
  }

  function cloneStep(step) {
    const copy = JSON.parse(JSON.stringify(step));
    visitSteps([copy], node => { node.id = uid(); });
    return copy;
  }

  function duplicateStep(stepId) {
    const context = findContext(stepId);
    if (!context) return;
    const copy = cloneStep(context.step);
    context.array.splice(context.index + 1, 0, copy);
    state.selectedStepId = copy.id;
    renderAll();
    scheduleSave();
  }

  function shiftStep(stepId, offset) {
    const context = findContext(stepId);
    if (!context) return;
    const destination = context.index + offset;
    if (destination < 0 || destination >= context.array.length) return;
    const [step] = context.array.splice(context.index, 1);
    context.array.splice(destination, 0, step);
    renderSteps();
    renderInspector();
    scheduleSave();
  }

  function onStepListClick(event) {
    const actionButton = event.target.closest('[data-step-action]');
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.stepAction;
      const stepId = actionButton.dataset.stepId;
      if (action === 'up') shiftStep(stepId, -1);
      else if (action === 'down') shiftStep(stepId, 1);
      else if (action === 'duplicate') duplicateStep(stepId);
      else if (action === 'delete') removeStep(stepId);
      else if (action === 'toggle-loop') {
        state.collapsed.has(stepId) ? state.collapsed.delete(stepId) : state.collapsed.add(stepId);
        renderSteps();
      } else if (action === 'add-child') openActionMenu(stepId);
      return;
    }
    const card = event.target.closest('.step-card');
    if (card) {
      state.selectedStepId = card.dataset.stepId;
      renderSteps();
      renderInspector();
    }
  }

  function onInspectorInput(event) {
    const button = event.target.closest('[data-add-child]');
    if (button) { openActionMenu(button.dataset.addChild); return; }
    const control = event.target.closest('[data-field]');
    if (!control) return;
    const field = control.dataset.field;
    const step = findStep(state.selectedStepId);
    if (!step) return;
    let value = control.value;
    if (control.type === 'number') value = value === '' ? 0 : Number(value);
    if (field === 'keys') {
      step.keys = value.split('+').map(part => normalizeKeyToken(part)).filter(Boolean);
    } else if (field === 'key') {
      step.key = normalizeKeyToken(value);
    } else {
      step[field] = value;
    }
    scheduleSave();
    renderSteps();
  }

  function normalizeKeyToken(value) {
    const token = String(value || '').trim().toLowerCase();
    return ({ '⌘': 'command', 'command': 'command', 'ctrl': 'ctrl', 'control': 'ctrl', 'option': 'alt', '⌥': 'alt', 'shift': 'shift', '⇧': 'shift', 'enter': 'enter', 'return': 'enter', 'spacebar': 'space', ' ': 'space', 'esc': 'esc' })[token] || token;
  }

  function macroInput(input, field) {
    const macro = activeMacro();
    if (!macro) return;
    macro[field] = input.value;
    if (field === 'name') {
      $('#breadcrumbName').textContent = macro.name || 'Bez nazwy';
      renderSidebar();
    }
    scheduleSave();
  }

  async function createMacro() {
    const payload = { name: 'Nowe makro', description: '', trigger: '', steps: [] };
    try {
      const response = await api('/api/macros', { method: 'POST', body: JSON.stringify(payload) });
      state.macros.unshift(response.macro);
      state.activeId = response.macro.id;
      state.selectedStepId = null;
      renderAll();
      $('#macroName').focus();
      $('#macroName').select();
      setSaveStatus('Zapisano');
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function duplicateMacro() {
    const macro = activeMacro();
    if (!macro) return;
    const payload = { ...JSON.parse(JSON.stringify(macro)), id: uid(), name: `${macro.name} — kopia` };
    try {
      const response = await api('/api/macros', { method: 'POST', body: JSON.stringify(payload) });
      state.macros.unshift(response.macro);
      state.activeId = response.macro.id;
      state.selectedStepId = response.macro.steps[0]?.id || null;
      renderAll();
      showToast('Utworzono kopię makra.');
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function deleteMacro() {
    const macro = activeMacro();
    if (!macro) return;
    if (!window.confirm(`Usunąć makro „${macro.name}”? Tej operacji nie można cofnąć.`)) return;
    try {
      await api(`/api/macros/${encodeURIComponent(macro.id)}`, { method: 'DELETE' });
      state.macros = state.macros.filter(item => item.id !== macro.id);
      if (state.macros.length) {
        state.activeId = state.macros[0].id;
        state.selectedStepId = state.macros[0].steps[0]?.id || null;
        renderAll();
      } else {
        state.activeId = null;
        state.selectedStepId = null;
        renderAll();
        await createMacro();
      }
      showToast('Makro usunięte.');
    } catch (error) { showToast(error.message, 'error'); }
  }

  function exportMacro() {
    const macro = activeMacro();
    if (!macro) return;
    const blob = new Blob([JSON.stringify(macro, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(macro.name || 'makro').trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'makro'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Makro wyeksportowane do pliku JSON.');
  }

  async function importMacro(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const payload = parsed.macro && typeof parsed.macro === 'object' ? parsed.macro : parsed;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Plik nie zawiera obiektu makra.');
      const imported = { ...payload, id: uid(), name: `${String(payload.name || 'Zaimportowane makro').slice(0, 68)} — import` };
      const response = await api('/api/macros', { method: 'POST', body: JSON.stringify(imported) });
      state.macros.unshift(response.macro);
      state.activeId = response.macro.id;
      state.selectedStepId = response.macro.steps[0]?.id || null;
      renderAll();
      showToast('Makro zaimportowane.');
    } catch (error) { showToast(error.message || 'Nie udało się odczytać pliku JSON.', 'error'); }
    finally { $('#importFile').value = ''; }
  }

  function openConfirm() {
    const macro = activeMacro();
    if (!macro) return;
    state.pendingConfirm = () => startRun('live');
    $('#confirmTitle').textContent = `Uruchomić „${macro.name}”?`;
    $('#confirmText').textContent = 'Tryb rzeczywisty będzie sterować klawiaturą i myszą. Po kliknięciu masz 3 sekundy na przełączenie się do aplikacji docelowej. Najpierw przetestuj makro i zapisz otwarte pliki.';
    $('#confirmBackdrop').hidden = false;
  }

  function closeConfirm(accepted) {
    $('#confirmBackdrop').hidden = true;
    const callback = state.pendingConfirm;
    state.pendingConfirm = null;
    if (accepted && callback) callback();
  }

  async function startRun(mode) {
    const macro = activeMacro();
    if (!macro) return;
    clearTimeout(state.pollTimer);
    try {
      const response = await api(`/api/macros/${encodeURIComponent(macro.id)}/run`, {
        method: 'POST', body: JSON.stringify({ mode }),
      });
      state.currentRun = response.run;
      $('#runPanel').hidden = false;
      updateRunPanel(response.run);
      if (!TERMINAL.has(response.run.status)) pollRun(response.run.id);
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function pollRun(runId) {
    try {
      const result = await api(`/api/runs/${encodeURIComponent(runId)}`);
      state.currentRun = result;
      updateRunPanel(result);
      if (!TERMINAL.has(result.status)) state.pollTimer = setTimeout(() => pollRun(runId), 500);
    } catch (error) { showToast(error.message, 'error'); }
  }

  function updateRunPanel(run) {
    if (!run) return;
    const statusNames = { queued: 'W kolejce…', running: 'Makro w toku', completed: 'Zakończono', stopped: 'Zatrzymano', stopping: 'Zatrzymywanie…', failed: 'Wystąpił błąd' };
    $('#runTitle').textContent = run.status === 'completed' ? 'Makro wykonane' : run.status === 'failed' ? 'Makro przerwane' : run.status === 'stopped' ? 'Makro zatrzymane' : run.macro_name;
    $('#runSubtitle').textContent = run.mode === 'live' ? 'Sterowanie klawiaturą i myszą' : 'Bezpieczny podgląd — bez działań na komputerze';
    $('#runModeBadge').textContent = run.mode === 'live' ? 'TRYB RZECZYWISTY' : 'PODGLĄD';
    $('#runModeBadge').classList.toggle('live', run.mode === 'live');
    $('#runFooterStatus').textContent = run.error || statusNames[run.status] || 'Przygotowywanie…';
    $('#runStatusIcon').className = `run-status-icon ${run.status === 'completed' ? 'done' : run.status === 'failed' ? 'failed' : ''}`;
    $('#stopRunButton').hidden = TERMINAL.has(run.status);
    const logs = (run.logs || []).slice(-120);
    $('#runLog').innerHTML = logs.map(entry => `<div class="run-log-entry ${escapeHTML(entry.level || '')}"><time>${escapeHTML(entry.time || '')}</time><span class="run-log-bullet">›</span><span>${escapeHTML(entry.message || '')}</span></div>`).join('');
    $('#runLog').scrollTop = $('#runLog').scrollHeight;
  }

  async function stopRun() {
    if (!state.currentRun) return;
    try {
      const result = await api(`/api/runs/${encodeURIComponent(state.currentRun.id)}/stop`, { method: 'POST', body: '{}' });
      if (result.run) updateRunPanel(result.run);
    } catch (error) { showToast(error.message, 'error'); }
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✓'}</span><span>${escapeHTML(message)}</span>`;
    $('#toastRegion').append(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function renderActionOptions() {
    $('#actionOptions').innerHTML = ACTION_OPTIONS.map(([type, title, description]) => `
      <button class="action-option" type="button" data-action-type="${type}">
        <span class="step-icon type-${type}">${ICONS[type]}</span>
        <span class="action-option-copy"><strong>${title}</strong><span>${description}</span></span>
      </button>`).join('');
  }

  function isTypingTarget(target) {
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  function handleKeydown(event) {
    const typing = isTypingTarget(event.target);
    if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault(); createMacro(); return;
    }
    if (!typing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault(); openConfirm(); return;
    }
    if (!typing && event.key.toLowerCase() === 'a' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const selected = findStep(state.selectedStepId);
      openActionMenu(selected?.type === 'loop' ? selected.id : null);
      return;
    }
    if (!typing && event.key === '/' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault(); $('#macroSearch').focus();
    }
    if (event.key === 'Escape') {
      if (!$('#actionMenu').hidden) closeActionMenu();
      else if (!$('#confirmBackdrop').hidden) closeConfirm(false);
    }
  }

  function bindEvents() {
    $('#macroList').addEventListener('click', event => {
      const item = event.target.closest('[data-macro-id]');
      if (!item) return;
      state.activeId = item.dataset.macroId;
      const macro = activeMacro();
      state.selectedStepId = macro?.steps?.[0]?.id || null;
      state.collapsed.clear();
      renderAll();
    });
    $('#macroSearch').addEventListener('input', event => { state.search = event.target.value; renderSidebar(); });
    $('#newMacroButton').addEventListener('click', createMacro);
    $('#duplicateMacroButton').addEventListener('click', duplicateMacro);
    $('#deleteMacroButton').addEventListener('click', deleteMacro);
    $('#exportButton').addEventListener('click', exportMacro);
    $('#importButton').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', event => { if (event.target.files?.[0]) importMacro(event.target.files[0]); });
    $('#macroName').addEventListener('input', event => macroInput(event.target, 'name'));
    $('#macroDescription').addEventListener('input', event => macroInput(event.target, 'description'));
    $('#triggerInput').addEventListener('input', event => macroInput(event.target, 'trigger'));
    $('#stepList').addEventListener('click', onStepListClick);
    $('#stepList').addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('step-card')) {
        event.preventDefault();
        state.selectedStepId = event.target.dataset.stepId;
        renderSteps(); renderInspector();
      }
    });
    $('#inspectorBody').addEventListener('input', onInspectorInput);
    $('#inspectorBody').addEventListener('change', onInspectorInput);
    $('#inspectorBody').addEventListener('click', onInspectorInput);
    $('#addStepButton').addEventListener('click', () => {
      const selected = findStep(state.selectedStepId);
      openActionMenu(selected?.type === 'loop' ? selected.id : null);
    });
    $('#actionOptions').addEventListener('click', event => {
      const option = event.target.closest('[data-action-type]');
      if (!option) return;
      const parent = state.addingInto;
      closeActionMenu();
      addStep(option.dataset.actionType, parent);
    });
    $('#closeActionMenu').addEventListener('click', closeActionMenu);
    $('#actionMenuBackdrop').addEventListener('click', closeActionMenu);
    $('#previewButton').addEventListener('click', () => startRun('preview'));
    $('#runButton').addEventListener('click', openConfirm);
    $('#cancelConfirm').addEventListener('click', () => closeConfirm(false));
    $('#acceptConfirm').addEventListener('click', () => closeConfirm(true));
    $('#confirmBackdrop').addEventListener('click', event => { if (event.target === $('#confirmBackdrop')) closeConfirm(false); });
    $('#stopRunButton').addEventListener('click', stopRun);
    $('#closeRunPanel').addEventListener('click', () => { $('#runPanel').hidden = true; clearTimeout(state.pollTimer); });
    $('#keyboardHelpButton').addEventListener('click', () => showToast('Skróty: A — dodaj krok · ⌘/Ctrl + N — nowe makro · ⌘/Ctrl + Enter — uruchom. Skróty makr działają globalnie po instalacji pynput.'));
    document.addEventListener('keydown', handleKeydown);

    $('#stepList').addEventListener('dragstart', event => {
      const wrap = event.target.closest('.step-wrap');
      if (!wrap) return;
      state.drag = { id: wrap.dataset.stepId, parentId: wrap.dataset.parentId || '' };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.drag.id);
      requestAnimationFrame(() => wrap.querySelector('.step-card')?.classList.add('dragging'));
    });
    $('#stepList').addEventListener('dragover', event => {
      const target = event.target.closest('.step-wrap');
      if (!target || !state.drag || (target.dataset.parentId || '') !== state.drag.parentId) return;
      event.preventDefault();
      $$('.step-card.drop-target', $('#stepList')).forEach(card => card.classList.remove('drop-target'));
      target.querySelector(':scope > .step-card')?.classList.add('drop-target');
      event.dataTransfer.dropEffect = 'move';
    });
    $('#stepList').addEventListener('drop', event => {
      const target = event.target.closest('.step-wrap');
      if (!target || !state.drag || (target.dataset.parentId || '') !== state.drag.parentId || target.dataset.stepId === state.drag.id) return;
      event.preventDefault();
      const from = findContext(state.drag.id);
      const to = findContext(target.dataset.stepId);
      if (from && to && from.array === to.array) {
        const [step] = from.array.splice(from.index, 1);
        const destination = to.index - (from.index < to.index ? 1 : 0);
        from.array.splice(destination, 0, step);
        renderSteps(); scheduleSave();
      }
    });
    $('#stepList').addEventListener('dragend', () => {
      state.drag = null;
      $$('.step-card', $('#stepList')).forEach(card => card.classList.remove('dragging', 'drop-target'));
    });
  }

  async function boot() {
    renderActionOptions();
    bindEvents();
    try {
      const health = await api('/api/health');
      const status = $('#globalHotkeyStatus');
      if (!health.global_hotkeys) {
        status.innerHTML = '<span class="tiny-shield">⌘</span><span>Skróty globalne wyłączone</span>';
        status.title = 'Zainstaluj opcjonalne zależności z requirements-live.txt, aby włączyć globalne skróty.';
      } else if (health.hotkeys_registered) {
        status.innerHTML = '<span class="tiny-shield">✓</span><span>Skróty globalne aktywne</span>';
        status.classList.add('active');
        status.title = 'Skróty zapisanych makr są zarejestrowane w systemie.';
      } else {
        status.innerHTML = '<span class="tiny-shield">⌘</span><span>Ustaw skrót makra</span>';
        status.title = 'Obsługa globalnych skrótów jest gotowa. Dodaj skrót do makra.';
      }
      $('#triggerInput').title = status.title;
    } catch (_) { /* The macro list below reports connection failures. */ }
    try {
      const response = await api('/api/macros');
      state.macros = response.macros || [];
      if (!state.macros.length) await createMacro();
      else {
        state.activeId = state.macros[0].id;
        state.selectedStepId = state.macros[0].steps?.[0]?.id || null;
        renderAll();
      }
    } catch (error) {
      renderAll();
      showToast(`Nie można połączyć z lokalnym serwerem: ${error.message}`, 'error');
    }
  }

  boot();
})();

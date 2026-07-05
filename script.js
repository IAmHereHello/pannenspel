(() => {
  const STORAGE_KEY = 'pannenspel-state-v1';
  const PHASES = ['Beschrijven', 'Eén woord', 'Uitbeelden'];
  const TURN_SECONDS = 60;
  const COLOR_PALETTE = ['#e63946', '#1d4ed8', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  const defaultState = () => ({
    screen: 'setup',
    teams: [],
    phaseIdx: 0,
    currentTeamIdx: 0,
    timeLeft: TURN_SECONDS,
    turnStatus: 'idle',
    turnStartScore: 0,
    turnEndReason: null,
  });

  let state = loadState();
  let timerHandle = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.teams)) return defaultState();
      if (parsed.turnStatus === 'running') parsed.turnStatus = 'idle';
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function nextColor() {
    const used = state.teams.map((t) => t.color);
    const free = COLOR_PALETTE.find((c) => !used.includes(c));
    return free || COLOR_PALETTE[state.teams.length % COLOR_PALETTE.length];
  }

  function addTeam(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    state.teams.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name: trimmed,
      color: nextColor(),
      score: 0,
    });
    saveState();
    render();
  }

  function removeTeam(id) {
    state.teams = state.teams.filter((t) => t.id !== id);
    saveState();
    render();
  }

  function moveTeam(id, dir) {
    const i = state.teams.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.teams.length) return;
    [state.teams[i], state.teams[j]] = [state.teams[j], state.teams[i]];
    saveState();
    render();
  }

  function updateTeamName(id, name) {
    const t = state.teams.find((t) => t.id === id);
    if (t) t.name = name;
    saveState();
  }

  function updateTeamColor(id, color) {
    const t = state.teams.find((t) => t.id === id);
    if (t) t.color = color;
    saveState();
    render();
  }

  function startGame() {
    if (state.teams.length < 2) return;
    state.teams.forEach((t) => { t.score = 0; });
    state.phaseIdx = 0;
    state.currentTeamIdx = 0;
    state.timeLeft = TURN_SECONDS;
    state.turnStatus = 'idle';
    state.turnStartScore = 0;
    state.turnEndReason = null;
    state.screen = 'game';
    saveState();
    render();
  }

  function newGame() {
    state.teams.forEach((t) => { t.score = 0; });
    state.phaseIdx = 0;
    state.currentTeamIdx = 0;
    state.timeLeft = TURN_SECONDS;
    state.turnStatus = 'idle';
    state.screen = 'setup';
    saveState();
    render();
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(tick, 1000);
  }

  function tick() {
    if (state.turnStatus !== 'running') { stopTimer(); return; }
    state.timeLeft -= 1;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.turnStatus = 'time-up';
      state.turnEndReason = 'timeout';
      stopTimer();
      playBuzzer();
    }
    saveState();
    render();
  }

  function playBuzzer() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'square';
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.setValueAtTime(660, ctx.currentTime + 0.25);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      o.stop(ctx.currentTime + 0.6);
    } catch (e) { /* audio not available, ignore */ }
    if (navigator.vibrate) { try { navigator.vibrate(300); } catch (e) {} }
  }

  function handleMainClick() {
    if (state.screen !== 'game' || state.teams.length === 0) return;
    const team = state.teams[state.currentTeamIdx];
    if (state.turnStatus === 'idle') {
      state.turnStatus = 'running';
      startTimer();
    } else if (state.turnStatus === 'running') {
      team.score += 1;
    } else if (state.turnStatus === 'time-up') {
      state.currentTeamIdx = (state.currentTeamIdx + 1) % state.teams.length;
      state.timeLeft = TURN_SECONDS;
      state.turnStatus = 'running';
      state.turnEndReason = null;
      state.turnStartScore = state.teams[state.currentTeamIdx].score;
      startTimer();
    }
    saveState();
    render();
  }

  function handleFoul() {
    if (state.turnStatus !== 'running') return;
    stopTimer();
    state.turnStatus = 'time-up';
    state.turnEndReason = 'foul';
    saveState();
    render();
  }

  function adjustScore(id, delta) {
    const t = state.teams.find((t) => t.id === id);
    if (!t) return;
    t.score = Math.max(0, t.score + delta);
    saveState();
    render();
  }

  function handleSpacebar() {
    if (state.screen !== 'game') return;
    const wasRunning = state.turnStatus === 'running';
    const carriedTime = wasRunning ? state.timeLeft : TURN_SECONDS;
    stopTimer();
    if (state.phaseIdx >= PHASES.length - 1) {
      state.screen = 'final';
      state.turnStatus = 'idle';
    } else {
      state.phaseIdx += 1;
      state.timeLeft = carriedTime;
      state.turnStatus = 'idle';
    }
    saveState();
    render();
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (state.screen !== 'game') return;
    e.preventDefault();
    handleSpacebar();
  });

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function render() {
    const app = document.getElementById('app');
    if (state.screen === 'setup') app.innerHTML = renderSetup();
    else if (state.screen === 'game') app.innerHTML = renderGame();
    else app.innerHTML = renderFinal();
    bindEvents();
  }

  function renderSetup() {
    const rows = state.teams.map((t, i) => `
      <div class="team-row">
        <input type="color" class="color-input" value="${t.color}" data-color-id="${t.id}">
        <input type="text" class="name-input" value="${escapeHtml(t.name)}" data-name-id="${t.id}">
        <button class="icon-btn" data-move-up="${t.id}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="icon-btn" data-move-down="${t.id}" ${i === state.teams.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="icon-btn danger" data-remove="${t.id}">&times;</button>
      </div>
    `).join('');

    const canStart = state.teams.length >= 2;

    return `
      <div class="setup-screen">
        <h1>Pannenspel</h1>
        <p class="subtitle">Fases: ${PHASES.join(' &rarr; ')}</p>
        <form id="add-team-form">
          <input type="text" id="team-name-input" placeholder="Teamnaam" autocomplete="off">
          <button type="submit">Team toevoegen</button>
        </form>
        <div class="team-list">${rows || '<p class="hint">Nog geen teams toegevoegd.</p>'}</div>
        <button id="start-game-btn" class="primary" ${canStart ? '' : 'disabled'}>Spel starten</button>
        ${canStart ? '' : '<p class="hint">Voeg minimaal 2 teams toe.</p>'}
      </div>
    `;
  }

  function renderGame() {
    const team = state.teams[state.currentTeamIdx];
    const nextTeam = state.teams[(state.currentTeamIdx + 1) % state.teams.length];
    const roundPoints = team.score - state.turnStartScore;
    const panels = state.teams.map((t, i) => `
      <div class="panel ${i === state.currentTeamIdx ? 'active' : ''}" style="background:${t.color}">
        <div class="team-name">${escapeHtml(t.name)}</div>
        <div class="score">${t.score}</div>
        ${i === state.currentTeamIdx ? `<div class="round-points">+${roundPoints} deze beurt</div>` : ''}
        <button class="minus-btn" data-adjust="${t.id}">&minus;1</button>
      </div>
    `).join('');

    let overlay = '';
    if (state.turnStatus === 'idle') {
      overlay = `
        <div class="overlay" id="click-catcher">
          <div class="overlay-team" style="color:${team.color}">${escapeHtml(team.name)}</div>
          <div class="overlay-msg">Tik om te starten (${formatTime(state.timeLeft)})</div>
        </div>`;
    } else if (state.turnStatus === 'time-up') {
      const reasonMsg = state.turnEndReason === 'foul' ? '&#10060; FOUT! Woord gezegd' : '&#9200; TIJD OM!';
      overlay = `
        <div class="overlay timeup" id="click-catcher">
          <div class="overlay-msg">${reasonMsg}</div>
          <div class="overlay-team" style="color:${team.color}">${escapeHtml(team.name)}</div>
          <div class="overlay-msg">+${roundPoints} punten deze beurt</div>
          <div class="overlay-msg small">Volgende: ${escapeHtml(nextTeam.name)} &mdash; tik om door te gaan</div>
        </div>`;
    }

    return `
      <div class="game-screen">
        <div class="topbar">
          <div class="phase">Fase ${state.phaseIdx + 1}/${PHASES.length}: ${PHASES[state.phaseIdx]}</div>
          ${state.turnStatus === 'running' ? '<button id="foul-btn" class="foul-btn">&#10060; Fout (stop beurt)</button>' : ''}
          <div class="timer ${state.turnStatus === 'running' && state.timeLeft <= 10 ? 'warning' : ''}">${formatTime(state.timeLeft)}</div>
        </div>
        <div class="panels" id="panels-container">${panels}</div>
        ${overlay}
      </div>
    `;
  }

  function renderFinal() {
    const sorted = [...state.teams].sort((a, b) => b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;
    const rows = sorted.map((t, i) => `
      <div class="final-row" style="border-color:${t.color}">
        <span class="rank">${i + 1}</span>
        <span class="dot" style="background:${t.color}"></span>
        <span class="fname">${escapeHtml(t.name)}</span>
        <span class="fscore">${t.score}</span>
        ${t.score === topScore ? '<span class="crown">&#127942;</span>' : ''}
      </div>
    `).join('');

    return `
      <div class="final-screen">
        <h1>Eindstand</h1>
        <div class="final-list">${rows}</div>
        <button id="new-game-btn" class="primary">Nieuw spel</button>
      </div>
    `;
  }

  function bindEvents() {
    if (state.screen === 'setup') {
      const form = document.getElementById('add-team-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('team-name-input');
        addTeam(input.value);
        const newInput = document.getElementById('team-name-input');
        if (newInput) newInput.focus();
      });
      document.querySelectorAll('[data-remove]').forEach((btn) =>
        btn.addEventListener('click', () => removeTeam(btn.dataset.remove)));
      document.querySelectorAll('[data-move-up]').forEach((btn) =>
        btn.addEventListener('click', () => moveTeam(btn.dataset.moveUp, -1)));
      document.querySelectorAll('[data-move-down]').forEach((btn) =>
        btn.addEventListener('click', () => moveTeam(btn.dataset.moveDown, 1)));
      document.querySelectorAll('[data-name-id]').forEach((input) =>
        input.addEventListener('input', () => updateTeamName(input.dataset.nameId, input.value)));
      document.querySelectorAll('[data-color-id]').forEach((input) =>
        input.addEventListener('input', () => updateTeamColor(input.dataset.colorId, input.value)));
      const startBtn = document.getElementById('start-game-btn');
      if (startBtn) startBtn.addEventListener('click', startGame);
    } else if (state.screen === 'game') {
      const panelsContainer = document.getElementById('panels-container');
      panelsContainer.addEventListener('click', handleMainClick);
      const catcher = document.getElementById('click-catcher');
      if (catcher) catcher.addEventListener('click', handleMainClick);
      const foulBtn = document.getElementById('foul-btn');
      if (foulBtn) foulBtn.addEventListener('click', (e) => { e.stopPropagation(); handleFoul(); });
      document.querySelectorAll('[data-adjust]').forEach((btn) =>
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          adjustScore(btn.dataset.adjust, -1);
        }));
    } else if (state.screen === 'final') {
      document.getElementById('new-game-btn').addEventListener('click', newGame);
    }
  }

  render();
})();

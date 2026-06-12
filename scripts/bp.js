// ==================== BP MODULE ====================
let bpHeroes = [];
let sortedHeroes = [];
let myLineup = ['', '', '', '', ''];
let enemyLineup = ['', '', '', '', ''];
let currentBPTab = 'recommended'; // recommended, notRecommended, enemyRecommended, enemyNotRecommended

// 简单的防抖函数
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Tab configuration
const BP_TABS = [
  { id: 'recommended', label: '🟢 我方推荐', color: '#4ade80' },
  { id: 'notRecommended', label: '🔴 我方慎选', color: '#ef4444' },
  { id: 'enemyRecommended', label: '🔵 敌方预测', color: '#3b82f6' },
  { id: 'enemyNotRecommended', label: '⚫ 敌方规避', color: '#6b7280' }
];

async function initBP() {
  // 先立即显示UI骨架，避免白屏
  renderBPSelectsSkeleton();

  // 后台加载英雄数据
  const loaded = await BP.loadHeroes();
  if (!loaded) {
    document.getElementById('resultsContent').innerHTML = '<div class="error">加载英雄数据失败，请刷新页面重试</div>';
    document.getElementById('resultsCard').classList.add('show');
    return;
  }

  bpHeroes = BP.getAllHeroes();
  sortedHeroes = bpHeroes.slice().sort((a, b) =>
    (BP.getHeroName(a.id) || '').localeCompare(BP.getHeroName(b.id) || ''));
  renderBPSelects();
  initProBP();

  // 位置筛选变化时自动重新计算（只在第一次初始化时绑定）
  const posEl = document.getElementById('myPosition');
  if (posEl && !posEl.dataset.bpBound) {
    posEl.dataset.bpBound = '1';
    posEl.addEventListener('change', () => {
      if (myLineup.some(id => id !== '') || enemyLineup.some(id => id !== '')) calculateBP();
    });
  }
}


function renderBPSelectsSkeleton() {
  const createSlot = (position, isEnemy) => `
    <div class="position-slot">
      <span class="position-label">${position}号位</span>
      <div class="hero-dropdown" data-team="${isEnemy ? 'enemy' : 'my'}" data-position="${position}">
        <div class="hero-skeleton-input"></div>
      </div>
    </div>
  `;

  const positions = [1, 2, 3, 4, 5];
  document.getElementById('myTeam').innerHTML = positions.map(p => createSlot(p, false)).join('');
  document.getElementById('enemyTeam').innerHTML = positions.map(p => createSlot(p, true)).join('');
}

function renderBPSelects() {
  const createSlot = (position, isEnemy) => `
    <div class="position-slot">
      <span class="position-label">${position}号位</span>
      <div class="hero-dropdown" data-team="${isEnemy ? 'enemy' : 'my'}" data-position="${position}">
        <input type="text" class="hero-dropdown-input" placeholder="搜索英雄..." autocomplete="off">
        <span class="hero-dropdown-arrow">▼</span>
        <div class="hero-dropdown-menu"></div>
      </div>
    </div>
  `;

  const positions = [1, 2, 3, 4, 5];
  document.getElementById('myTeam').innerHTML = positions.map(p => createSlot(p, false)).join('');
  document.getElementById('enemyTeam').innerHTML = positions.map(p => createSlot(p, true)).join('');

  document.querySelectorAll('.hero-dropdown').forEach(dropdown => {
    const input = dropdown.querySelector('.hero-dropdown-input');
    const menu = dropdown.querySelector('.hero-dropdown-menu');

    input.addEventListener('focus', () => showBPDropdown(dropdown));
    input.addEventListener('input', debounce(() => filterBPDropdown(dropdown, input.value)));
    input.addEventListener('keydown', (e) => handleBPKeydown(e, dropdown));
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
  });
}

function searchHeroes(query) {
  if (!query || query.trim() === '') {
    return bpHeroes.map(h => ({ id: h.id, name: BP.getHeroName(h.id), alias: (h.alias || [])[0] || '' }));
  }

  const q = query.toLowerCase().trim();
  return bpHeroes
    .filter(hero => {
      const name = BP.getHeroName(hero.id) || '';
      if (name.toLowerCase().includes(q)) return true;
      if (hero.alias && hero.alias.some(a => a.toLowerCase().includes(q))) return true;
      if (hero.id.toLowerCase().includes(q)) return true;
      return false;
    })
    .map(h => ({ id: h.id, name: BP.getHeroName(h.id), alias: (h.alias || [])[0] || '' }));
}

function showBPDropdown(dropdown) {
  const menu = dropdown.querySelector('.hero-dropdown-menu');
  const input = dropdown.querySelector('.hero-dropdown-input');
  filterBPDropdown(dropdown, input.value);
  menu.classList.add('open');
}

function filterBPDropdown(dropdown, query) {
  const menu = dropdown.querySelector('.hero-dropdown-menu');
  const results = searchHeroes(query);
  const input = dropdown.querySelector('.hero-dropdown-input');

  const allSelected = [...myLineup, ...enemyLineup].filter(id => id && id !== '');
  const selectedSet = new Set(allSelected);

  if (results.length === 0) {
    // If slot has a selection, still show clear option even with no results
    if (input.dataset.selected) {
      menu.innerHTML = `<div class="hero-dropdown-item hero-dropdown-clear" onclick="clearBPHero(this)">
        <span class="hero-dropdown-clear-icon">✕</span>
        <span class="hero-dropdown-item-name" style="color:var(--mute);">取消选择</span>
      </div><div class="hero-dropdown-empty">未找到英雄</div>`;
    } else {
      menu.innerHTML = '<div class="hero-dropdown-empty">未找到英雄</div>';
    }
    return;
  }

  // If this slot already has a hero selected, add a "clear" option at top
  let clearHtml = '';
  if (input.dataset.selected) {
    clearHtml = `<div class="hero-dropdown-item hero-dropdown-clear" onclick="clearBPHero(this)">
      <span class="hero-dropdown-clear-icon">✕</span>
      <span class="hero-dropdown-item-name" style="color:var(--mute);">取消选择</span>
    </div>`;
  }

  menu.innerHTML = clearHtml + results
    .map(hero => {
      const isDisabled = selectedSet.has(hero.id);
      const heroKey = hero.id.replace('npc_dota_hero_', '');
      const avatarUrl = BP.getHeroAvatarUrl(hero.id) || `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${heroKey}_icon.png`;
      return `
        <div class="hero-dropdown-item ${isDisabled ? 'disabled' : ''}"
             data-hero-id="${hero.id}"
             ${isDisabled ? '' : 'onclick="selectBPHero(this)"'}>
          <img class="hero-dropdown-item-avatar" src="${avatarUrl}" alt="${hero.name || BP.getHeroName(hero.id) || heroKey}" loading="lazy" onerror="this.style.display='none'">
          <span class="hero-dropdown-item-name">${hero.name || BP.getHeroName(hero.id) || heroKey}</span>
          ${hero.alias ? `<span class="hero-dropdown-item-alias">${hero.alias}</span>` : ''}
        </div>
      `;
    }).join('');
}

function handleBPKeydown(e, dropdown) {
  const menu = dropdown.querySelector('.hero-dropdown-menu');
  const items = menu.querySelectorAll('.hero-dropdown-item:not(.disabled)');
  const current = menu.querySelector('.hero-dropdown-item.highlighted');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    const next = current ? current.nextElementSibling : items[0];
    if (next && !next.classList.contains('disabled')) {
      next.classList.add('highlighted');
      next.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    const prev = current ? current.previousElementSibling : items[items.length - 1];
    if (prev && !prev.classList.contains('disabled')) {
      prev.classList.add('highlighted');
      prev.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (current) {
      if (current.classList.contains('hero-dropdown-clear')) {
        clearBPHero(current);
      } else if (!current.classList.contains('disabled')) {
        selectBPHero(current);
      }
    } else if (items.length > 0) {
      items.forEach(i => i.classList.remove('highlighted'));
      if (!current || current.classList.contains('disabled')) {
        items[0].classList.add('highlighted');
      }
    }
  } else if (e.key === 'Escape') {
    menu.classList.remove('open');
  }
}

function selectBPHero(element) {
  const heroId = element.dataset.heroId;
  const dropdown = element.closest('.hero-dropdown');
  const input = dropdown.querySelector('.hero-dropdown-input');
  const menu = dropdown.querySelector('.hero-dropdown-menu');

  const hero = bpHeroes.find(h => h.id === heroId);

  const heroName = hero ? (hero.name || BP.getHeroName(hero.id) || '') : '';
  input.value = heroName;
  input.dataset.selected = heroId;
  const localAvatar = BP.getHeroAvatarUrl(heroId);
  if (localAvatar) {
    input.style.backgroundImage = `url(${localAvatar})`;
  }
  input.style.backgroundSize = '24px 24px';
  input.style.backgroundRepeat = 'no-repeat';
  input.style.backgroundPosition = '8px center';
  input.style.paddingLeft = '40px';
  input.classList.add('has-value');

  const team = dropdown.dataset.team;
  const position = parseInt(dropdown.dataset.position);
  const posIndex = position - 1;

  if (team === 'my') {
    myLineup[posIndex] = heroId;
  } else {
    enemyLineup[posIndex] = heroId;
  }

  menu.classList.remove('open');
  updateBPSelectDisables();
  // 自动触发计算推荐
  calculateBP();
}

function clearBPHero(element) {
  const dropdown = element.closest('.hero-dropdown');
  const input = dropdown.querySelector('.hero-dropdown-input');
  const menu = dropdown.querySelector('.hero-dropdown-menu');

  input.value = '';
  input.dataset.selected = '';
  input.style.backgroundImage = '';
  input.style.paddingLeft = '';
  input.style.backgroundSize = '';
  input.style.backgroundRepeat = '';
  input.style.backgroundPosition = '';
  input.classList.remove('has-value');

  const team = dropdown.dataset.team;
  const position = parseInt(dropdown.dataset.position);
  const posIndex = position - 1;

  if (team === 'my') {
    myLineup[posIndex] = '';
  } else {
    enemyLineup[posIndex] = '';
  }

  menu.classList.remove('open');
  updateBPSelectDisables();
  calculateBP();
}

function updateBPSelectDisables() {
  const allSelected = [...myLineup, ...enemyLineup].filter(id => id && id !== '');
  const selectedSet = new Set(allSelected);

  document.querySelectorAll('.hero-dropdown').forEach(dropdown => {
    const input = dropdown.querySelector('.hero-dropdown-input');
    const currentSelected = input.dataset.selected;

    if (currentSelected && selectedSet.has(currentSelected)) {
      const team = dropdown.dataset.team;
      const position = parseInt(dropdown.dataset.position);
      const posIndex = position - 1;
      const lineup = team === 'my' ? myLineup : enemyLineup;

      if (lineup[posIndex] !== currentSelected) {
        input.value = '';
        input.dataset.selected = '';
        input.style.backgroundImage = '';
        input.style.paddingLeft = '';
        input.classList.remove('has-value');
      }
    }
  });
}

function calculateBP() {
  try {
    const myPositionVal = document.getElementById('myPosition').value;
    const myPosition = myPositionVal ? parseInt(myPositionVal) : null;

    const hasEnemy = enemyLineup.some(id => id !== '');
    if (!hasEnemy) {
      document.getElementById('resultsContent').innerHTML = '<div class="error">请至少选择一个敌方英雄</div>';
      document.getElementById('resultsCard').classList.add('show');
      return;
    }

    // Calculate all 4 recommendation types
    const allResults = {
      recommended: BP.getRecommendations(myLineup, enemyLineup, myPosition),
      notRecommended: BP.getNotRecommended(myLineup, enemyLineup, myPosition),
      enemyRecommended: BP.getEnemyRecommendations(myLineup, enemyLineup, myPosition),
      enemyNotRecommended: BP.getEnemyNotRecommended(myLineup, enemyLineup, myPosition)
    };

    renderBPResultsWithTabs(allResults);
    document.getElementById('resultsCard').classList.add('show');
  } catch (e) {
    console.error('calculateBP error:', e);
    document.getElementById('resultsContent').innerHTML = '<div class="error">计算 BP 建议时出错：' + String(e.message || e) + '</div>';
    document.getElementById('resultsCard').classList.add('show');
  }
}

function renderBPResultsWithTabs(allResults) {
  const positionNames = {
    1: '1号位',
    2: '2号位',
    3: '3号位',
    4: '4号位',
    5: '5号位'
  };

  // Render tab buttons
  const tabsHtml = `
    <div class="bp-tabs">
      ${BP_TABS.map(tab => `
        <button class="bp-tab ${currentBPTab === tab.id ? 'active' : ''}"
                data-tab="${tab.id}"
                style="--tab-color: ${tab.color}">
          ${tab.label}
        </button>
      `).join('')}
    </div>
  `;

  // Get current tab data
  const currentData = allResults[currentBPTab] || {};
  // 判断 "已选" 列表：my vs enemy
  const isEnemyTab = currentBPTab.includes('enemy');
  const occupiedLineup = isEnemyTab ? enemyLineup : myLineup;

  const renderHeroCard = (rec) => {
    const localAvatar = BP.getHeroAvatarUrl(rec.heroId);
    const name = rec.name || BP.getHeroName(rec.heroId) || rec.heroId.replace('npc_dota_hero_', '');
    const initChar = (name || '?').charAt(0);
    const color = avatarColorFor(rec.heroId);
    const avatarHtml = localAvatar
      ? `<img class="rec-col-avatar" src="${localAvatar}" alt="${name}" loading="lazy" onerror="this.outerHTML='<div class=&quot;rec-col-avatar avatar-fallback&quot; style=&quot;background:${color};&quot;>${initChar}</div>'">`
      : `<div class="rec-col-avatar avatar-fallback" style="background:${color};">${initChar}</div>`;

    const countersHtml = (rec.counters || []).slice(0, 3).map(c => {
      const cls = c.net > 0 ? 'positive' : c.net < 0 ? 'negative' : 'neutral';
      const sign = c.net >= 0 ? '+' : '';
      return `<div class="score-item ${cls}">克制 ${c.heroName} <span class="score-val">${sign}${c.net.toFixed(1)}</span></div>`;
    }).join('');

    const synergiesHtml = (rec.synergies || []).slice(0, 2).map(s => {
      const cls = s.score > 0 ? 'positive' : s.score < 0 ? 'negative' : 'neutral';
      const sign = s.score >= 0 ? '+' : '';
      return `<div class="score-item ${cls}">配合 ${s.heroName} <span class="score-val">${sign}${s.score.toFixed(1)}</span></div>`;
    }).join('');

    const strength = rec.strength ?? rec.winRateScore ?? 0;
    const strengthCls = strength >= 5 ? 'high' : strength >= 0 ? 'mid' : 'low';

    return `
      <div class="rec-col-hero">
        <div class="rec-col-hero-header">
          ${avatarHtml}
          <span class="rec-col-name">${name}</span>
          <span class="rec-col-strength ${strengthCls}">${strength.toFixed(1)}</span>
        </div>
        <div class="rec-col-scores">
          ${countersHtml}${synergiesHtml}
        </div>
      </div>
    `;
  };

  // 5 列布局：每个位置一列
  let columnsHtml = '<div class="rec-columns">';
  let totalRendered = 0;
  for (let pos = 1; pos <= 5; pos++) {
    const heroes = currentData[pos] || [];
    const occupied = occupiedLineup[pos - 1] && occupiedLineup[pos - 1] !== '';
    let colBody;
    if (occupied) {
      const occName = BP.getHeroName(occupiedLineup[pos - 1]) || '';
      colBody = `<div class="rec-col-hero rec-col-occupied">已选：${occName}</div>`;
    } else if (heroes.length === 0) {
      colBody = `<div class="rec-col-empty">无推荐</div>`;
    } else {
      colBody = heroes.map(renderHeroCard).join('');
      totalRendered += heroes.length;
    }
    columnsHtml += `
      <div class="rec-col">
        <div class="rec-col-title">${positionNames[pos]}</div>
        <div class="rec-col-list">${colBody}</div>
      </div>
    `;
  }
  columnsHtml += '</div>';

  if (totalRendered === 0) {
    document.getElementById('resultsContent').innerHTML = `
      ${tabsHtml}
      <div class="error">当前分类下没有数据，请尝试其他分类或调整阵容</div>
    `;
  } else {
    document.getElementById('resultsContent').innerHTML = tabsHtml + columnsHtml;
  }

  // Add tab click handlers
  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      currentBPTab = tabId;
      // Re-render with new tab (use cached results)
      renderBPResultsWithTabs(allResults);
    });
  });
}

window.initBP = initBP;
window.calculateBP = calculateBP;
window.selectBPHero = selectBPHero;
// ==================== PRO MODE (BP simulation) ====================

let proBPInitialized = false;
let proBPState = null;
let proBPFilterMode = 'all'; // 'all' | 'recR' | 'recD' | 'recByPosR' | 'recByPosD'
let heroScoresR = {}; // heroId -> total score for Radiant
let heroScoresD = {}; // heroId -> total score for Dire
let heroScoresByPosR = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} }; // pos -> heroId -> score for R
let heroScoresByPosD = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} }; // pos -> heroId -> score for D
const colorMap = {};

const PRO_BP_STEPS = [
  { team: 'R', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
];

function createProBPState(team) {
  return {
    picks: { R: [], D: [] },
    bans: { R: [], D: [] },
    available: new Set(bpHeroes.map(h => h.id)),
    currentStep: 0,
    myTeam: team,
    started: false,
    ended: false,
  };
}

function initProBP() {
  if (proBPInitialized) return;
  proBPInitialized = true;

  const allBtn = document.getElementById('proBPFilterAll');
  const rBtn = document.getElementById('proBPFilterR');
  const dBtn = document.getElementById('proBPFilterD');
  const byPosRBtn = document.getElementById('proBPFilterByPosR');
  const byPosDBtn = document.getElementById('proBPFilterByPosD');
  const searchInput = document.getElementById('proBPHeroSearch');
  const prevBtn = document.getElementById('proBPPrevBtn');
  const nextBtn = document.getElementById('proBPNextBtn');
  const autoBtn = document.getElementById('proBPAutoBtn');

  if (allBtn) allBtn.addEventListener('click', () => { proBPFilterMode = 'all'; updateFilterBtns(); renderProBPGrid(); });
  if (rBtn) rBtn.addEventListener('click', () => { proBPFilterMode = 'recR'; updateFilterBtns(); renderProBPGrid(); });
  if (dBtn) dBtn.addEventListener('click', () => { proBPFilterMode = 'recD'; updateFilterBtns(); renderProBPGrid(); });
  if (byPosRBtn) byPosRBtn.addEventListener('click', () => { proBPFilterMode = 'recByPosR'; updateFilterBtns(); renderProBPGrid(); });
  if (byPosDBtn) byPosDBtn.addEventListener('click', () => { proBPFilterMode = 'recByPosD'; updateFilterBtns(); renderProBPGrid(); });
  if (searchInput) searchInput.addEventListener('input', debounce(() => renderProBPGrid(), 250));

  if (prevBtn) prevBtn.addEventListener('click', proBPPrev);
  if (nextBtn) nextBtn.addEventListener('click', proBPNext);
  if (autoBtn) autoBtn.addEventListener('click', proBPAuto);

  document.querySelectorAll('#bpModeTabs .bp-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#bpModeTabs .bp-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      const casualPanel = document.getElementById('casualModePanel');
      const proPanel = document.getElementById('proModePanel');
      const desc = document.getElementById('bpModeDesc');
      if (mode === 'pro') {
        casualPanel.style.display = 'none';
        document.getElementById('bpCasualUI').style.display = 'none';
        proPanel.style.display = 'block';
        desc.textContent = '职业模式：模拟 24 步 BP 流程，根据当前阵容显示推荐/克制分数';
        if (!proBPState) {
          proBPStart();
        }
        renderProBPGrid();
        updateProBPUI();
      } else {
        casualPanel.style.display = 'block';
        document.getElementById('bpCasualUI').style.display = 'block';
        proPanel.style.display = 'none';
        desc.textContent = '天梯模式：根据双方阵容自动算出每个位置的克制 / 配合建议';
      }
    });
  });
}

function updateFilterBtns() {
  const allBtn = document.getElementById('proBPFilterAll');
  const rBtn = document.getElementById('proBPFilterR');
  const dBtn = document.getElementById('proBPFilterD');
  const byPosRBtn = document.getElementById('proBPFilterByPosR');
  const byPosDBtn = document.getElementById('proBPFilterByPosD');
  if (allBtn) allBtn.classList.toggle('active', proBPFilterMode === 'all');
  if (rBtn) rBtn.classList.toggle('active', proBPFilterMode === 'recR');
  if (dBtn) dBtn.classList.toggle('active', proBPFilterMode === 'recD');
  if (byPosRBtn) byPosRBtn.classList.toggle('active', proBPFilterMode === 'recByPosR');
  if (byPosDBtn) byPosDBtn.classList.toggle('active', proBPFilterMode === 'recByPosD');
}

function proBPStart() {
  proBPState = createProBPState('R');
  proBPState.started = true;
  const panel = document.getElementById('proBPHeroGridPanel');
  if (panel) panel.style.display = 'flex';
  const nav = document.getElementById('proBPStepNav');
  if (nav) nav.style.display = 'flex';
  updateProBPUI();
}

function getDisplayedHeroes() {
  return sortedHeroes;
}

let lastComputedLineupHash = '';

function computeHeroScores() {
  if (!proBPState) return;
  const myLineup = proBPState.picks[proBPState.myTeam].slice(0, 5);
  while (myLineup.length < 5) myLineup.push('');
  const enemyTeam = proBPState.myTeam === 'R' ? 'D' : 'R';
  const enemyLineup = proBPState.picks[enemyTeam].slice(0, 5);
  while (enemyLineup.length < 5) enemyLineup.push('');

  // 阵容没变则跳过重复计算
  const hash = myLineup.join(',') + '|' + enemyLineup.join(',') + '|' + (proBPState.available.size);
  if (hash === lastComputedLineupHash) return;
  lastComputedLineupHash = hash;

  heroScoresR = {};
  heroScoresD = {};
  for (let p = 1; p <= 5; p++) { heroScoresByPosR[p] = {}; heroScoresByPosD[p] = {}; }

  for (const hero of bpHeroes) {
    if (!proBPState.available.has(hero.id)) continue;
    const rScore = BP.getCandidateScores(hero.id, myLineup, enemyLineup);
    const dScore = BP.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup);
    heroScoresR[hero.id] = rScore ? rScore.totalStrength : 0;
    heroScoresD[hero.id] = dScore ? dScore.totalStrength : 0;
    for (let pos = 1; pos <= 5; pos++) {
      if (!BP.canPlayPosition(hero.id, pos)) continue;
      heroScoresByPosR[pos][hero.id] = rScore ? rScore.totalStrength : 0;
      heroScoresByPosD[pos][hero.id] = dScore ? dScore.totalStrength : 0;
    }
  }
}

function avatarColorFor(heroId) {
  if (colorMap[heroId]) return colorMap[heroId];
  let h = 0;
  for (let i = 0; i < heroId.length; i++) {
    h = heroId.charCodeAt(i) + ((h << 5) - h);
  }
  const c = (h & 0x00FFFFFF).toString(16).toUpperCase().padStart(6, '0');
  colorMap[heroId] = '#' + c;
  return colorMap[heroId];
}

function getStepForAction(team, action, heroId) {
  const arr = action === 'ban' ? proBPState.bans[team] : proBPState.picks[team];
  const idx = arr.indexOf(heroId);
  if (idx === -1) return null;
  let count = 0;
  for (let i = 0; i < PRO_BP_STEPS.length; i++) {
    if (PRO_BP_STEPS[i].team === team && PRO_BP_STEPS[i].action === action) {
      if (count === idx) return i + 1;
      count++;
    }
  }
  return null;
}

function getPickStepForSlot(team, slotIdx) {
  let count = 0;
  for (let i = 0; i < PRO_BP_STEPS.length; i++) {
    if (PRO_BP_STEPS[i].team === team && PRO_BP_STEPS[i].action === 'pick') {
      if (count === slotIdx) return i + 1;
      count++;
    }
  }
  return null;
}

function renderProBPGrid() {
  const grid = document.getElementById('proBPHeroGrid');
  if (!grid || !proBPState) return;

  if (proBPFilterMode === 'recByPosR' || proBPFilterMode === 'recByPosD') {
    renderProBPGridByPos(grid, proBPFilterMode === 'recByPosR' ? heroScoresByPosR : heroScoresByPosD);
    return;
  }

  const search = (document.getElementById('proBPHeroSearch')?.value || '').toLowerCase().trim();
  const def = PRO_BP_STEPS[proBPState.currentStep];
  const isBanTurn = def && def.action === 'ban';
  const isPickTurn = def && def.action === 'pick';
  const ended = proBPState.ended;

  if (proBPFilterMode !== 'all') {
    computeHeroScores();
  }

  const displayedHeroes = getDisplayedHeroes();
  const scoreMap = proBPFilterMode !== 'all'
    ? (proBPFilterMode === 'recR' ? heroScoresR : heroScoresD)
    : null;

  // Sort: score descending for recR/recD, alphabetically for all
  let sorted = displayedHeroes.slice();
  if (scoreMap) {
    sorted.sort((a, b) => (scoreMap[b.id] ?? -Infinity) - (scoreMap[a.id] ?? -Infinity));
  } else {
    sorted.sort((a, b) => (BP.getHeroName(a.id) || '').localeCompare(BP.getHeroName(b.id) || ''));
  }

  let html = '';
  for (const hero of sorted) {
    const name = BP.getHeroName(hero.id);
    const aliases = (hero.alias || []).join(' ');
    if (search && !(name + ' ' + aliases + ' ' + hero.id).toLowerCase().includes(search)) continue;

    const isAvailable = proBPState.available.has(hero.id);
    const isBanned = !isAvailable && (proBPState.bans.R.includes(hero.id) || proBPState.bans.D.includes(hero.id));
    const isPickedByR = proBPState.picks.R.includes(hero.id);
    const isPickedByD = proBPState.picks.D.includes(hero.id);

    let cls = 'pro-bp-hero-grid-item';
    let badge = '';

    if (isBanned) {
      cls += ' banned';
      badge = '\u{1F6AB}';
    } else if (isPickedByR) {
      cls += ' picked-by-me';
      badge = '✅';
    } else if (isPickedByD) {
      cls += ' picked-by-enemy';
      badge = '\u{1F534}';
    } else if (isAvailable && !ended) {
      if (isBanTurn) {
        cls += ' can-ban';
      } else if (isPickTurn) {
        cls += ' can-pick';
      }
    } else {
      cls += ' disabled-click';
    }

    const url = BP.getHeroAvatarUrl(hero.id);
    const initChar = (name || '?').charAt(0);
    const color = avatarColorFor(hero.id);

    let avatarHtml;
    if (url) {
      avatarHtml = `<img class="pro-bp-hero-grid-avatar" src="${url}" alt="${name}" loading="lazy"
           onerror="this.outerHTML='<div class=&quot;pro-bp-hero-grid-avatar avatar-fallback&quot; style=&quot;background:${color};&quot;>${initChar}</div>'">`;
    } else {
      avatarHtml = `<div class="pro-bp-hero-grid-avatar avatar-fallback" style="background:${color};">${initChar}</div>`;
    }

    let scoreHtml = '';
    if (scoreMap) {
      const score = scoreMap[hero.id] ?? 0;
      scoreHtml = `<span class="pro-bp-hero-grid-score">${score.toFixed(1)}</span>`;
    }

    html += '<div class="' + cls + '" data-hero-id="' + hero.id + '" onclick="onProBPHeroClick(\'' + hero.id + '\')">';
    html += avatarHtml;
    if (badge) html += '<span class="pro-bp-hero-grid-badge">' + badge + '</span>';
    html += '<span class="pro-bp-hero-grid-name">' + name + '</span>';
    if (scoreHtml) html += scoreHtml;
    html += '</div>';
  }

  grid.innerHTML = html;
}

function renderProBPGridByPos(grid, scoreMapByPos) {
  const search = (document.getElementById('proBPHeroSearch')?.value || '').toLowerCase().trim();
  const def = PRO_BP_STEPS[proBPState.currentStep];
  const isBanTurn = def && def.action === 'ban';
  const isPickTurn = def && def.action === 'pick';
  const ended = proBPState.ended;

  computeHeroScores();

  const positionNames = { 1: '1号位', 2: '2号位', 3: '3号位', 4: '4号位', 5: '5号位' };

  const cardHtml = (hero, scoreMap) => {
    const name = BP.getHeroName(hero.id);
    const aliases = (hero.alias || []).join(' ');
    if (search && !(name + ' ' + aliases + ' ' + hero.id).toLowerCase().includes(search)) return null;

    const isAvailable = proBPState.available.has(hero.id);
    const isBanned = !isAvailable && (proBPState.bans.R.includes(hero.id) || proBPState.bans.D.includes(hero.id));
    const isPickedByR = proBPState.picks.R.includes(hero.id);
    const isPickedByD = proBPState.picks.D.includes(hero.id);

    let cls = 'pro-bp-hero-grid-item';
    let badge = '';
    if (isBanned) { cls += ' banned'; badge = '\u{1F6AB}'; }
    else if (isPickedByR) { cls += ' picked-by-me'; badge = '✅'; }
    else if (isPickedByD) { cls += ' picked-by-enemy'; badge = '\u{1F534}'; }
    else if (isAvailable && !ended) {
      if (isBanTurn) cls += ' can-ban';
      else if (isPickTurn) cls += ' can-pick';
    } else cls += ' disabled-click';

    const url = BP.getHeroAvatarUrl(hero.id);
    const initChar = (name || '?').charAt(0);
    const color = avatarColorFor(hero.id);
    const avatarHtml = url
      ? `<img class="pro-bp-hero-grid-avatar" src="${url}" alt="${name}" loading="lazy" onerror="this.outerHTML='<div class=&quot;pro-bp-hero-grid-avatar avatar-fallback&quot; style=&quot;background:${color};&quot;>${initChar}</div>'">`
      : `<div class="pro-bp-hero-grid-avatar avatar-fallback" style="background:${color};">${initChar}</div>`;

    const score = scoreMap[hero.id] ?? 0;
    const scoreHtml = `<span class="pro-bp-hero-grid-score">${score.toFixed(1)}</span>`;

    return `<div class="${cls}" data-hero-id="${hero.id}" onclick="onProBPHeroClick('${hero.id}')">${avatarHtml}${badge ? `<span class="pro-bp-hero-grid-badge">${badge}</span>` : ''}<span class="pro-bp-hero-grid-name">${name}</span>${scoreHtml}</div>`;
  };

  let html = '<div class="pro-bp-pos-columns">';
  for (let pos = 1; pos <= 5; pos++) {
    const scoreMapForPos = scoreMapByPos[pos] || {};
    const list = bpHeroes
      .filter(h => h.roles && h.roles.includes(pos) && scoreMapForPos[h.id] != null)
      .sort((a, b) => (scoreMapForPos[b.id] ?? -Infinity) - (scoreMapForPos[a.id] ?? -Infinity));

    const items = list.map(h => cardHtml(h, scoreMapForPos)).filter(Boolean);

    html += `<div class="pro-bp-pos-col"><div class="pro-bp-pos-col-title">${positionNames[pos]}</div><div class="pro-bp-pos-col-list">`;
    if (items.length === 0) {
      html += '<div class="pro-bp-pos-col-empty">无</div>';
    } else {
      html += items.join('');
    }
    html += '</div></div>';
  }
  html += '</div>';

  grid.innerHTML = html;
}


function onProBPHeroClick(heroId) {
  if (!proBPState || proBPState.ended) return;
  const def = PRO_BP_STEPS[proBPState.currentStep];
  if (!def) return;
  const allPicked = [...proBPState.picks.R, ...proBPState.picks.D];
  const allBanned = [...proBPState.bans.R, ...proBPState.bans.D];
  if (allPicked.includes(heroId) || allBanned.includes(heroId)) return;
  if (def.action === 'ban') {
    proBPState.bans[def.team].push(heroId);
  } else {
    proBPState.picks[def.team].push(heroId);
  }
  proBPState.available.delete(heroId);
  proBPState.currentStep++;
  if (proBPState.currentStep >= PRO_BP_STEPS.length) {
    proBPState.ended = true;
  }
  updateProBPUI();
  renderProBPGrid();
}

function updateProBPUI() {
  if (!proBPState) return;
  const def = PRO_BP_STEPS[proBPState.currentStep];
  const step = proBPState.currentStep;
  const total = PRO_BP_STEPS.length;

  const progressEl = document.getElementById('proBPProgress');
  if (progressEl) {
    let barHtml = '';
    for (let i = 0; i < total; i++) {
      const s = PRO_BP_STEPS[i];
      let pCls = 'pro-bp-progress-step';
      if (i < step) pCls += ' done';
      else if (i === step) pCls += ' current';
      if (s.action === 'ban') pCls += ' ban-step';
      barHtml += '<div class="' + pCls + '"></div>';
    }
    progressEl.innerHTML = barHtml;
  }

  const phaseEl = document.getElementById('proBPPhase');
  const actionEl = document.getElementById('proBPAction');
  if (phaseEl && actionEl) {
    if (proBPState.ended) {
      phaseEl.textContent = '✅ BP 结束';
      actionEl.textContent = '阵容确定！';
      actionEl.classList.remove('waiting-enemy');
    } else if (def) {
      const teamName = def.team === 'R' ? '先选方' : '后选方';
      const actionName = def.action === 'ban' ? '禁用' : '选择';
      phaseEl.textContent = '第 ' + (step + 1) + ' / ' + total + ' 手';
      actionEl.textContent = teamName + ' ' + actionName + '英雄';
      actionEl.classList.toggle('waiting-enemy', def.team !== proBPState.myTeam);
    }
  }

  renderProBPBans();
  renderProBPLineups();
  updateProBPScoreCard();

  const countEl = document.getElementById('proBPStepCount');
  if (countEl) countEl.textContent = step + ' / ' + total;

  const prevBtn = document.getElementById('proBPPrevBtn');
  const nextBtn = document.getElementById('proBPNextBtn');
  if (prevBtn) prevBtn.disabled = step <= 0;
  if (nextBtn) nextBtn.disabled = proBPState.ended || step >= total;
}

function renderProBPBans() {
  const rBansEl = document.getElementById('proBPRBans');
  const dBansEl = document.getElementById('proBPDBans');
  if (!rBansEl || !dBansEl) return;

  const renderBans = (bans, currentTeam) => {
    let html = '';
    const def = PRO_BP_STEPS[proBPState.currentStep];
    const isCurrentBan = def && def.action === 'ban' && def.team === currentTeam;
    for (let i = 0; i < 7; i++) {
      const heroId = bans[i];
      let cls = 'pro-bp-ban-slot';
      if (heroId) {
        const url = BP.getHeroAvatarUrl(heroId);
        const name = BP.getHeroName(heroId);
        const step = getStepForAction(currentTeam, 'ban', heroId);
        html += '<div class="' + cls + '">';
        html += '<img src="' + url + '" alt="' + name + '" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;pro-bp-ban-slot empty&quot;>×</div>\'"><div class="ban-cross">✕</div>';
        if (step != null) html += '<span class="pro-bp-ban-slot-step">' + step + '</span>';
        html += '</div>';
      } else {
        if (isCurrentBan && i === bans.length) cls += ' ban-slot-current empty';
        else cls += ' empty';
        html += '<div class="' + cls + '"></div>';
      }
    }
    return html;
  };

  rBansEl.innerHTML = renderBans(proBPState.bans.R, 'R');
  dBansEl.innerHTML = renderBans(proBPState.bans.D, 'D');
}

function renderProBPLineups() {
  const lineupEl = document.getElementById('proBPLineups');
  if (!lineupEl) return;
  const renderLineup = (teamLabel, picks, team) => {
    const padded = picks.slice(0, 5);
    while (padded.length < 5) padded.push('');
    let html = '<div class="pro-bp-lineup"><div class="pro-bp-lineup-label">' + teamLabel + '</div><div class="pro-bp-lineup-slots">';
    padded.forEach((heroId, idx) => {
      const slotStep = getPickStepForSlot(team, idx);
      if (heroId) {
        const name = BP.getHeroName(heroId);
        const url = BP.getHeroAvatarUrl(heroId);
        html += '<div class="pro-bp-lineup-slot picked"><span class="pro-bp-lineup-slot-pos">' + slotStep + '</span>';
        html += '<img class="pro-bp-lineup-slot-avatar" src="' + url + '" alt="' + name + '" loading="lazy" onerror="this.style.display=\'none\'"><span class="pro-bp-lineup-slot-name">' + name + '</span></div>';
      } else {
        html += '<div class="pro-bp-lineup-slot"><span class="pro-bp-lineup-slot-pos">' + slotStep + '</span><span class="pro-bp-lineup-slot-empty">待选择</span></div>';
      }
    });
    html += '</div></div>';
    return html;
  };
  const myTeam = proBPState.myTeam;
  const enemyTeam = myTeam === 'R' ? 'D' : 'R';
  lineupEl.innerHTML = renderLineup(myTeam === 'R' ? '🟢 先选方' : '🔴 后选方', proBPState.picks[myTeam], myTeam) +
    renderLineup(myTeam === 'R' ? '🔴 后选方' : '🟢 先选方', proBPState.picks[enemyTeam], enemyTeam);
}

function updateProBPScoreCard() {
  const card = document.getElementById('proBPScoreCard');
  if (!card || !proBPState) return;
  const rPicks = proBPState.picks.R;
  const dPicks = proBPState.picks.D;
  const hasAny = rPicks.length > 0 || dPicks.length > 0;
  if (!hasAny) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const rScore = BP.getLineupScoreBreakdown(rPicks, dPicks);
  const dScore = BP.getLineupScoreBreakdown(dPicks, rPicks);

  document.getElementById('proRScoreTotal').textContent = rScore.total.toFixed(1);
  document.getElementById('proDScoreTotal').textContent = dScore.total.toFixed(1);
  const gap = rScore.total - dScore.total;
  const gapEl = document.getElementById('proScoreGap');
  gapEl.textContent = (gap >= 0 ? '+' : '') + gap.toFixed(1);
  gapEl.classList.toggle('positive', gap > 0);
  gapEl.classList.toggle('negative', gap < 0);

  const hintEl = document.getElementById('proScoreHint');
  if (rPicks.length + dPicks.length < 10) {
    hintEl.textContent = 'BP 进行中 (' + (rPicks.length + dPicks.length) + '/10 选)';
  } else {
    hintEl.textContent = 'BP 完成';
  }

  const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1);
  document.getElementById('proRScoreBreakdown').innerHTML =
    '<div class="pro-bp-score-breakdown-row"><span>胜率</span><span class="val">' + rScore.winRateScore.toFixed(1) + '</span></div>' +
    '<div class="pro-bp-score-breakdown-row"><span>配合</span><span class="val">' + fmt(rScore.synergyScore) + '</span></div>' +
    '<div class="pro-bp-score-breakdown-row"><span>克制</span><span class="val">' + fmt(rScore.counterScore) + '</span></div>';
  document.getElementById('proDScoreBreakdown').innerHTML =
    '<div class="pro-bp-score-breakdown-row"><span>胜率</span><span class="val">' + dScore.winRateScore.toFixed(1) + '</span></div>' +
    '<div class="pro-bp-score-breakdown-row"><span>配合</span><span class="val">' + fmt(dScore.synergyScore) + '</span></div>' +
    '<div class="pro-bp-score-breakdown-row"><span>克制</span><span class="val">' + fmt(dScore.counterScore) + '</span></div>';
}

function proBPPrev() {
  if (!proBPState || proBPState.currentStep <= 0) return;
  const step = proBPState.currentStep - 1;
  const prevStep = PRO_BP_STEPS[step];
  if (prevStep.action === 'ban') { const r = proBPState.bans[prevStep.team].pop(); if (r) proBPState.available.add(r); }
  else { const r = proBPState.picks[prevStep.team].pop(); if (r) proBPState.available.add(r); }
  proBPState.currentStep = step;
  proBPState.ended = false;
  updateProBPUI();
  renderProBPGrid();
}

function proBPNext() {
  if (!proBPState || proBPState.ended) return;
  proBPState.currentStep++;
  if (proBPState.currentStep >= PRO_BP_STEPS.length) {
    proBPState.ended = true;
  }
  updateProBPUI();
  renderProBPGrid();
}

function proBPAuto() {
  if (!proBPState || proBPState.ended) return;
  const autoInterval = setInterval(() => {
    if (proBPState.ended) { clearInterval(autoInterval); return; }
    const def = PRO_BP_STEPS[proBPState.currentStep];
    if (!def) { clearInterval(autoInterval); return; }
    computeHeroScores();
    const avail = bpHeroes.filter(h => proBPState.available.has(h.id));
    if (avail.length === 0) { proBPState.ended = true; updateProBPUI(); renderProBPGrid(); clearInterval(autoInterval); return; }
    const scoreMap = def.team === 'R' ? heroScoresR : heroScoresD;
    let best = avail[0], bestScore = -Infinity;
    for (const hero of avail) { const s = scoreMap[hero.id] ?? -Infinity; if (s > bestScore) { bestScore = s; best = hero; } }
    onProBPHeroClick(best.id);
  }, 500);
}

window.initProBP = initProBP;
window.proBPStart = proBPStart;
window.onProBPHeroClick = onProBPHeroClick;
window.proBPPrev = proBPPrev;
window.proBPNext = proBPNext;
window.proBPAuto = proBPAuto;

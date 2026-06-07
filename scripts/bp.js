// ==================== BP MODULE ====================
let bpInitialized = false;
let bpHeroes = [];
let myLineup = ['', '', '', '', ''];
let enemyLineup = ['', '', '', '', ''];
let currentBPTab = 'recommended'; // recommended, notRecommended, enemyRecommended, enemyNotRecommended

// Tab configuration
const BP_TABS = [
  { id: 'recommended', label: '🟢 我方推荐', color: '#4ade80' },
  { id: 'notRecommended', label: '🔴 我方慎选', color: '#ef4444' },
  { id: 'enemyRecommended', label: '🔵 敌方预测', color: '#3b82f6' },
  { id: 'enemyNotRecommended', label: '⚫ 敌方规避', color: '#6b7280' }
];

async function initBP() {
  if (bpInitialized) return;
  bpInitialized = true;

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
  renderBPSelects();
  initProBP();
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
    input.addEventListener('input', () => filterBPDropdown(dropdown, input.value));
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
    return bpHeroes.map(h => ({ id: h.id, name: h.name, alias: h.aliases ? h.aliases[0] : '' }));
  }

  const q = query.toLowerCase().trim();
  return bpHeroes
    .filter(hero => {
      if (hero.name.toLowerCase().includes(q)) return true;
      if (hero.name_en && hero.name_en.toLowerCase().includes(q)) return true;
      if (hero.aliases && hero.aliases.some(a => a.toLowerCase().includes(q))) return true;
      return false;
    })
    .map(h => ({ id: h.id, name: h.name, alias: h.aliases ? h.aliases[0] : '' }));
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

  const allSelected = [...myLineup, ...enemyLineup].filter(id => id && id !== '');
  const selectedSet = new Set(allSelected);

  if (results.length === 0) {
    menu.innerHTML = '<div class="hero-dropdown-empty">未找到英雄</div>';
    return;
  }

  menu.innerHTML = results
    .map(hero => {
      const isDisabled = selectedSet.has(hero.id);
      const heroKey = hero.id.replace('npc_dota_hero_', '');
      const avatarUrl = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${heroKey}_icon.png`;
      return `
        <div class="hero-dropdown-item ${isDisabled ? 'disabled' : ''}"
             data-hero-id="${hero.id}"
             ${isDisabled ? '' : 'onclick="selectBPHero(this)"'}>
          <img class="hero-dropdown-item-avatar" src="${avatarUrl}" alt="${hero.name}" onerror="this.style.display='none'">
          <span class="hero-dropdown-item-name">${hero.name}</span>
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
    if (current && !current.classList.contains('disabled')) {
      selectBPHero(current);
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

  const heroKey = heroId.replace('npc_dota_hero_', '');
  const avatarUrl = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${heroKey}_icon.png`;
  input.value = hero ? hero.name : '';
  input.dataset.selected = heroId;
  input.style.backgroundImage = `url(${avatarUrl})`;
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
}

function renderBPResultsWithTabs(allResults) {
  const positionNames = {
    1: '1号位（大哥）',
    2: '2号位（中单）',
    3: '3号位（劣单）',
    4: '4号位（游走）',
    5: '5号位（酱油）'
  };

  // Check if any result has data
  const hasAny = Object.values(allResults).some(r =>
    Object.keys(r).some(pos => r[pos] && r[pos].length > 0)
  );

  if (!hasAny) {
    document.getElementById('resultsContent').innerHTML = '<div class="error">未能找到合适的推荐，请调整阵容或位置</div>';
    return;
  }

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
  const currentData = allResults[currentBPTab];

  const hasData = Object.keys(currentData).some(pos => currentData[pos] && currentData[pos].length > 0);

  if (!hasData) {
    document.getElementById('resultsContent').innerHTML = `
      ${tabsHtml}
      <div class="error">当前分类下没有数据，请尝试其他分类或调整阵容</div>
    `;
  } else {
    let html = '';
    for (const [pos, heroes] of Object.entries(currentData)) {
      if (!heroes || heroes.length === 0) continue;

      const positionLabel = positionNames[pos] || `${pos}号位`;

      heroes.forEach((rec) => {
        const heroKey = rec.heroId.replace('npc_dota_hero_', '');
        const avatarUrl = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${heroKey}_icon.png`;

        const countersHtml = rec.counters && rec.counters.length > 0
          ? rec.counters.map(c => {
              const cls = c.score > 0 ? 'positive' : c.score < 0 ? 'negative' : 'neutral';
              const sign = c.score >= 0 ? '+' : '';
              const label = currentBPTab.includes('enemy') ? '我方' : '敌方';
              return `<div class="score-item ${cls}">对${label} ${c.heroName} ${sign}${c.score.toFixed(2)}</div>`;
            }).join('')
          : '';

        const synergiesHtml = rec.synergies && rec.synergies.length > 0
          ? rec.synergies.map(s => {
              const cls = s.score > 0 ? 'positive' : s.score < 0 ? 'negative' : 'neutral';
              const sign = s.score >= 0 ? '+' : '';
              const label = currentBPTab.includes('enemy') ? '敌方' : '我方';
              return `<div class="score-item ${cls}">对${label} ${s.heroName} ${sign}${s.score.toFixed(2)}</div>`;
            }).join('')
          : '';

        html += `
          <div class="recommendation">
            <img class="rec-avatar" src="${avatarUrl}" alt="${rec.name}" onerror="this.style.display='none'">
            <span class="rec-position">${positionLabel}</span>
            <span class="rec-name">${rec.name}</span>
            <div class="rec-scores">
              ${countersHtml}
              ${synergiesHtml}
            </div>
          </div>
        `;
      });
    }

    document.getElementById('resultsContent').innerHTML = tabsHtml + html;
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

// Legacy function for compatibility
function renderBPResults(recommendations) {
  renderBPResultsWithTabs({
    recommended: recommendations,
    notRecommended: {},
    enemyRecommended: {},
    enemyNotRecommended: {}
  });
}

// Expose functions globally
window.initBP = initBP;
window.calculateBP = calculateBP;
window.selectBPHero = selectBPHero;
// ==================== PRO MODE (BP simulation) ====================

let proBPInitialized = false;
let proBPState = null;
let proBPFilterMode = 'all'; // 'all' | 'recR' | 'recD'
let heroScoresR = {}; // heroId -> total score for Radiant
let heroScoresD = {}; // heroId -> total score for Dire
const colorMap = {};

const PRO_BP_STEPS = [
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'ban' },
  { team: 'D', action: 'ban' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'R', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'D', action: 'pick' },
  { team: 'R', action: 'pick' },
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
  const searchInput = document.getElementById('proBPHeroSearch');
  const prevBtn = document.getElementById('proBPPrevBtn');
  const nextBtn = document.getElementById('proBPNextBtn');
  const autoBtn = document.getElementById('proBPAutoBtn');

  if (allBtn) allBtn.addEventListener('click', () => { proBPFilterMode = 'all'; updateFilterBtns(); renderProBPGrid(); });
  if (rBtn) rBtn.addEventListener('click', () => { proBPFilterMode = 'recR'; updateFilterBtns(); renderProBPGrid(); });
  if (dBtn) dBtn.addEventListener('click', () => { proBPFilterMode = 'recD'; updateFilterBtns(); renderProBPGrid(); });
  if (searchInput) searchInput.addEventListener('input', () => renderProBPGrid());

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
        proPanel.style.display = 'block';
        desc.textContent = '职业模式：模拟 24 步 BP 流程，英雄按位置分组显示推荐/克制分数';
        if (!proBPState) {
          proBPStart();
        }
        renderProBPGrid();
        updateProBPUI();
      } else {
        casualPanel.style.display = 'block';
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
  if (allBtn) allBtn.classList.toggle('active', proBPFilterMode === 'all');
  if (rBtn) rBtn.classList.toggle('active', proBPFilterMode === 'recR');
  if (dBtn) dBtn.classList.toggle('active', proBPFilterMode === 'recD');
}

function proBPStart() {
  proBPState = createProBPState('R');
  proBPState.started = true;
  const panel = document.getElementById('proBPHeroGridPanel');
  if (panel) panel.style.display = 'block';
  const nav = document.getElementById('proBPStepNav');
  if (nav) nav.style.display = 'flex';
  updateProBPUI();
}

function getDisplayedHeroes() {
  if (!proBPState || !bpHeroes.length) return [];
  return bpHeroes.filter(h => proBPState.available.has(h.id)).sort((a, b) =>
    (BP.getHeroName(a.id) || '').localeCompare(BP.getHeroName(b.id) || ''));
}

function computeHeroScores() {
  if (!proBPState) return;
  heroScoresR = {};
  heroScoresD = {};
  const myLineup = proBPState.picks[proBPState.myTeam].slice(0, 5);
  while (myLineup.length < 5) myLineup.push('');
  const enemyTeam = proBPState.myTeam === 'R' ? 'D' : 'R';
  const enemyLineup = proBPState.picks[enemyTeam].slice(0, 5);
  while (enemyLineup.length < 5) enemyLineup.push('');
  for (const hero of bpHeroes) {
    if (!proBPState.available.has(hero.id)) continue;
    const rScore = BP.getCandidateScores(hero.id, myLineup, enemyLineup);
    const dScore = BP.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup);
    heroScoresR[hero.id] = rScore ? rScore.totalStrength : 0;
    heroScoresD[hero.id] = dScore ? dScore.totalStrength : 0;
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

function renderProBPGrid() {
  const grid = document.getElementById('proBPHeroGrid');
  if (!grid || !proBPState) return;

  const search = (document.getElementById('proBPHeroSearch')?.value || '').toLowerCase().trim();
  const def = PRO_BP_STEPS[proBPState.currentStep];
  const isBanTurn = def && def.action === 'ban';
  const isPickTurn = def && def.action === 'pick';
  const ended = proBPState.ended;

  if (proBPFilterMode !== 'all') {
    computeHeroScores();
  }

  const displayedHeroes = getDisplayedHeroes();

  // Build HTML
  let html = '';

  if (proBPFilterMode !== 'all' && proBPState && def) {
    // recR/recD mode: same styling as "all" mode, just reordered by position
    const scoreMap = proBPFilterMode === 'recR' ? heroScoresR : heroScoresD;
    const posLabels = {1:'1号位', 2:'2号位', 3:'3号位', 4:'4号位', 5:'5号位'};
    const posSeparator = '<div class="pro-bp-pos-separator"></div>';

    for (let pos = 1; pos <= 3; pos++) {
      const posHeroes = displayedHeroes.filter(h => BP.canPlayPosition(h.id, pos));
      const sorted = posHeroes.slice().sort((a, b) => (scoreMap[b.id] ?? -Infinity) - (scoreMap[a.id] ?? -Infinity));

      html += '<div class="pro-bp-pos-header">' + posLabels[pos] + '</div>';

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
          badge = '🚫';
        } else if (isPickedByR) {
          cls += ' picked-by-me';
          badge = '✅';
        } else if (isPickedByD) {
          cls += ' picked-by-enemy';
          badge = '🔴';
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
          avatarHtml = `<img class="pro-bp-hero-grid-avatar" src="${url}" alt="${name}"
               onerror="this.outerHTML='<div class=&quot;pro-bp-hero-grid-avatar avatar-fallback&quot; style=&quot;background:${color};&quot;>${initChar}</div>'">`;
        } else {
          avatarHtml = `<div class="pro-bp-hero-grid-avatar avatar-fallback" style="background:${color};">${initChar}</div>`;
        }

        html += '<div class="' + cls + '" data-hero-id="' + hero.id + '" onclick="onProBPHeroClick(\'' + hero.id + '\')">';
        html += avatarHtml;
        if (badge) html += '<span class="pro-bp-hero-grid-badge">' + badge + '</span>';
        html += '<span class="pro-bp-hero-grid-name">' + name + '</span>';
        html += '</div>';
      }

      if (pos < 3) {
        html += posSeparator;
      }
    }
  } else {
    // "all" mode: flat grid
    for (const hero of displayedHeroes) {
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
        badge = '🚫';
      } else if (isPickedByR) {
        cls += ' picked-by-me';
        badge = '✅';
      } else if (isPickedByD) {
        cls += ' picked-by-enemy';
        badge = '🔴';
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
        avatarHtml = `<img class="pro-bp-hero-grid-avatar" src="${url}" alt="${name}"
             onerror="this.outerHTML='<div class=&quot;pro-bp-hero-grid-avatar avatar-fallback&quot; style=&quot;background:${color};&quot;>${initChar}</div>'">`;
      } else {
        avatarHtml = `<div class="pro-bp-hero-grid-avatar avatar-fallback" style="background:${color};">${initChar}</div>`;
      }

      html += '<div class="' + cls + '" data-hero-id="' + hero.id + '" onclick="onProBPHeroClick(\'' + hero.id + '\')">';
      html += avatarHtml;
      if (badge) html += '<span class="pro-bp-hero-grid-badge">' + badge + '</span>';
      html += '<span class="pro-bp-hero-grid-name">' + name + '</span>';
      html += '</div>';
    }
  }

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
        html += '<div class="' + cls + '">';
        html += '<img src="' + url + '" alt="' + name + '" onerror="this.outerHTML=\'<div class=&quot;pro-bp-ban-slot empty&quot;>×</div>\'"><div class="ban-cross">✕</div></div>';
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
  const renderLineup = (teamLabel, picks) => {
    const padded = picks.slice(0, 5);
    while (padded.length < 5) padded.push('');
    let html = '<div class="pro-bp-lineup"><div class="pro-bp-lineup-label">' + teamLabel + '</div><div class="pro-bp-lineup-slots">';
    padded.forEach((heroId, idx) => {
      const pos = idx + 1;
      if (heroId) {
        const name = BP.getHeroName(heroId);
        const url = BP.getHeroAvatarUrl(heroId);
        html += '<div class="pro-bp-lineup-slot picked"><span class="pro-bp-lineup-slot-pos">' + pos + '</span>';
        html += '<img class="pro-bp-lineup-slot-avatar" src="' + url + '" alt="' + name + '" onerror="this.style.display=\'none\'"><span class="pro-bp-lineup-slot-name">' + name + '</span></div>';
      } else {
        html += '<div class="pro-bp-lineup-slot"><span class="pro-bp-lineup-slot-pos">' + pos + '</span><span class="pro-bp-lineup-slot-empty">待选择</span></div>';
      }
    });
    html += '</div></div>';
    return html;
  };
  const myTeam = proBPState.myTeam;
  const enemyTeam = myTeam === 'R' ? 'D' : 'R';
  lineupEl.innerHTML = renderLineup(myTeam === 'R' ? '🟢 先选方' : '🔴 后选方', proBPState.picks[myTeam]) +
    renderLineup(myTeam === 'R' ? '🔴 后选方' : '🟢 先选方', proBPState.picks[enemyTeam]);
}

function updateProBPScoreCard() {
  const card = document.getElementById('proBPScoreCard');
  if (!card) return;
  const myTeam = proBPState.myTeam;
  const enemyTeam = myTeam === 'R' ? 'D' : 'R';
  const myPicks = proBPState.picks[myTeam].filter(id => id);
  const enemyPicks = proBPState.picks[enemyTeam].filter(id => id);
  if (enemyPicks.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  const myLineup = [...myPicks];
  while (myLineup.length < 5) myLineup.push('');
  const enemyLineup2 = [...enemyPicks];
  while (enemyLineup2.length < 5) enemyLineup2.push('');
  let myScore = 0, mySynergy = 0, myCounter = 0;
  for (const heroId of myPicks) {
    const scores = BP.getCandidateScores(heroId, myLineup.filter((h,i) => h !== heroId || i >= myPicks.length), enemyLineup2);
    if (scores) { myScore += scores.totalStrength; mySynergy += scores.synergies.reduce((s, x) => s + x.score, 0); myCounter += scores.counters.reduce((s, x) => s + x.net, 0); }
  }
  let enemyScore = 0, enemySynergy = 0, enemyCounter = 0;
  for (const heroId of enemyPicks) {
    const scores = BP.getCandidateScoresForEnemy(heroId, enemyLineup2.filter((h,i) => h !== heroId || i >= enemyPicks.length), myLineup);
    if (scores) { enemyScore += scores.totalStrength; enemySynergy += scores.synergies.reduce((s, x) => s + x.score, 0); enemyCounter += scores.counters.reduce((s, x) => s + x.net, 0); }
  }
  document.getElementById('proMyScoreTotal').textContent = myScore.toFixed(1);
  document.getElementById('proEnemyScoreTotal').textContent = enemyScore.toFixed(1);
  document.getElementById('proGapScore').textContent = (myScore - enemyScore).toFixed(1);
  const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1);
  document.getElementById('proMyScoreBreakdown').innerHTML = '<div class="score-breakdown-row"><span>配合</span><span class="val">' + fmt(mySynergy) + '</span></div><div class="score-breakdown-row"><span>克制</span><span class="val">' + fmt(myCounter) + '</span></div>';
  document.getElementById('proEnemyScoreBreakdown').innerHTML = '<div class="score-breakdown-row"><span>配合</span><span class="val">' + fmt(enemySynergy) + '</span></div><div class="score-breakdown-row"><span>克制</span><span class="val">' + fmt(enemyCounter) + '</span></div>';
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
  if (proBPState && !proBPState.ended) onProBPHeroClick('__auto_skip__');
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

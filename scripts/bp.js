// ==================== BP MODULE ====================
let bpInitialized = false;
let bpHeroes = [];
let myLineup = ['', '', '', '', ''];
let enemyLineup = ['', '', '', '', ''];
let currentBPTab = 'recommended';

// Hero ID to Steam CDN image name mapping (for heroes whose image filename differs)
const HERO_IMG_MAP = {
  // 特殊文件名映射（CDN文件名与heroId不同）
  'npc_dota_hero_wraith_king': 'skeleton_king',
  'npc_dota_hero_timbersaw': 'shredder',
  // dota_react 路径 heroes（使用不同路径）
  'npc_dota_hero_dawnbreaker': 'dota_react/dawnbreaker',
  'npc_dota_hero_kez': 'dota_react/kez',
  'npc_dota_hero_largo': 'dota_react/largo',
  'npc_dota_hero_marci': 'dota_react/marci',
  'npc_dota_hero_muerta': 'dota_react/muerta',
  'npc_dota_hero_primal_beast': 'dota_react/primal_beast',
  'npc_dota_hero_ringmaster': 'dota_react/ringmaster',
  'npc_dota_hero_abyssal_underlord': 'dota_react/abyssal_underlord',
  'npc_dota_hero_leshrac': 'dota_react/leshrac',
  'npc_dota_hero_queen_of_pain': 'dota_react/qop',
  'npc_dota_hero_windranger': 'dota_react/windrunner',
  'npc_dota_hero_natures_prophet': 'dota_react/furion', // 自然先知用furion
};

// Tab configuration
const BP_TABS = [
  { id: 'recommended', label: '🟢 我方推荐', color: '#4ade80' },
  { id: 'notRecommended', label: '🔴 我方慎选', color: '#ef4444' },
  { id: 'enemyRecommended', label: '🔵 敌方预测', color: '#3b82f6' },
  { id: 'enemyNotRecommended', label: '⚫ 敌方规避', color: '#6b7280' }
];

// Get hero image key (some heroes have different CDN filenames)
function getHeroImgKey(heroId) {
  if (HERO_IMG_MAP[heroId]) return HERO_IMG_MAP[heroId];
  return heroId.replace('npc_dota_hero_', '');
}

// Get full hero image URL
function getHeroImgUrl(heroId) {
  const key = getHeroImgKey(heroId);
  if (key.startsWith('dota_react/')) {
    return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/${key}.png`;
  }
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${key}_icon.png`;
}

// XSS protection
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function initBP() {
  if (bpInitialized) return;
  bpInitialized = true;

  const calculateBtn = document.getElementById('calculateBtn');
  calculateBtn.disabled = true;
  calculateBtn.textContent = '加载中...';

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
  calculateBtn.disabled = false;
  calculateBtn.innerHTML = '<span>⚔️</span> 开始给出 BP 建议';
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

  // Build menu items
  let html = '';

  // Add clear option at top
  html += `
    <div class="hero-dropdown-item clear-option"
         onclick="clearBPSlot(this)">
      <span class="hero-dropdown-item-name">× 清空此位置</span>
    </div>
  `;

  if (results.length === 0) {
    menu.innerHTML = html + '<div class="hero-dropdown-empty">未找到英雄</div>';
    return;
  }

  html += results
    .map(hero => {
      const isDisabled = selectedSet.has(hero.id);
      const heroKey = getHeroImgKey(hero.id);
      const avatarUrl = getHeroImgUrl(heroId);
      return `
        <div class="hero-dropdown-item ${isDisabled ? 'disabled' : ''}"
             data-hero-id="${hero.id}"
             ${isDisabled ? '' : 'onclick="selectBPHero(this)"'}>
          <img class="hero-dropdown-item-avatar" src="${avatarUrl}" alt="${escapeHtml(hero.name)}" onerror="this.style.display='none'">
          <span class="hero-dropdown-item-name">${escapeHtml(hero.name)}</span>
          ${hero.alias ? `<span class="hero-dropdown-item-alias">${escapeHtml(hero.alias)}</span>` : ''}
        </div>
      `;
    }).join('');

  menu.innerHTML = html;
}

function handleBPKeydown(e, dropdown) {
  const menu = dropdown.querySelector('.hero-dropdown-menu');
  const heroItems = menu.querySelectorAll('.hero-dropdown-item:not(.disabled):not(.clear-option)');
  const current = menu.querySelector('.hero-dropdown-item.highlighted');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    const next = current ? current.nextElementSibling : heroItems[0];
    if (next && !next.classList.contains('disabled') && !next.classList.contains('clear-option')) {
      next.classList.add('highlighted');
      next.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    const prev = current ? current.previousElementSibling : heroItems[heroItems.length - 1];
    if (prev && !prev.classList.contains('disabled') && !prev.classList.contains('clear-option')) {
      prev.classList.add('highlighted');
      prev.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (current && current.classList.contains('clear-option')) {
      clearBPSlot(current);
    } else if (current && !current.classList.contains('disabled')) {
      selectBPHero(current);
    } else if (heroItems.length > 0) {
      heroItems.forEach(i => i.classList.remove('highlighted'));
      if (!current || current.classList.contains('disabled') || current.classList.contains('clear-option')) {
        heroItems[0].classList.add('highlighted');
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

  const heroKey = getHeroImgKey(heroId);
  const avatarUrl = getHeroImgUrl(heroId);
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

function clearBPSlot(element) {
  const dropdown = element.closest('.hero-dropdown');
  const input = dropdown.querySelector('.hero-dropdown-input');
  const menu = dropdown.querySelector('.hero-dropdown-menu');
  const team = dropdown.dataset.team;
  const position = parseInt(dropdown.dataset.position);
  const posIndex = position - 1;

  input.value = '';
  input.dataset.selected = '';
  input.style.backgroundImage = '';
  input.style.paddingLeft = '';
  input.classList.remove('has-value');

  if (team === 'my') {
    myLineup[posIndex] = '';
  } else {
    enemyLineup[posIndex] = '';
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
        const heroKey = getHeroImgKey(rec.heroId);
        const avatarUrl = getHeroImgUrl(heroId);

        // 克制指数（对敌方阵容的总克制）
        const counterDisplay = rec.totalCounterScore != null && rec.totalCounterScore !== 0
          ? `<div class="score-item ${rec.totalCounterScore > 0 ? 'positive' : 'negative'}">对敌方克制 ${rec.totalCounterScore > 0 ? '+' : ''}${rec.totalCounterScore.toFixed(2)}</div>`
          : '';

        // 配合指数（对己方阵容的总配合）
        const synergyDisplay = rec.totalSynergyScore != null && rec.totalSynergyScore !== 0
          ? `<div class="score-item ${rec.totalSynergyScore > 0 ? 'positive' : 'negative'}">对己方配合 ${rec.totalSynergyScore > 0 ? '+' : ''}${rec.totalSynergyScore.toFixed(2)}</div>`
          : '';

        // 总分显示
        const totalDisplay = rec.totalStrength != null
          ? `<div class="score-item total">总分 ${rec.totalStrength > 0 ? '+' : ''}${rec.totalStrength.toFixed(2)}</div>`
          : '';

        html += `
          <div class="recommendation">
            <img class="rec-avatar" src="${avatarUrl}" alt="${rec.name}" onerror="this.style.display='none'">
            <span class="rec-position">${positionLabel}</span>
            <span class="rec-name">${rec.name}</span>
            <div class="rec-scores">
              ${totalDisplay}
              ${counterDisplay}
              ${synergyDisplay}
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
window.clearBPSlot = clearBPSlot;
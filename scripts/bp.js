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

  const calculateBtn = document.getElementById('calculateBtn');
  calculateBtn.disabled = true;
  calculateBtn.textContent = '加载中...';

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
// ==================== TEAM ANALYSIS MODULE ====================
// 战队分析：搜索战队 → 查看近20场列表 → 选择比赛 → 叠加显示眼位
// 注意：OPENDOTA_API 和 heroNameMap 已由 replay.js 声明

// Note: selectedMatches, allMatches, matchDataCache are declared in replay.js
// Note: currentFilters, timeRange, playerFilter, displayMode are declared in replay.js
let timeRange = [0, 9999];    // in seconds
let showHeatmap = false;     // 热力图显示开关
const MINIMAP_SIZE = 600;
const MINIMAP_COORD_MIN = 64;  // Dota2 minimap actual data range min
const MINIMAP_COORD_MAX = 192; // Dota2 minimap actual data range max
const MINIMAP_COORD_RANGE = MINIMAP_COORD_MAX - MINIMAP_COORD_MIN; // ~128

// OpenDota obs_log x/y 是 minimap 坐标，约 64-192 范围
// 映射到整个 600x600 canvas，填满整张地图

// World coord 转换（Dota2 世界坐标约 -16000 到 16000）
// OpenDota lane_pos/positions 使用 world coord
const WORLD_COORD_MIN = -16000;
const WORLD_COORD_MAX = 16000;
const WORLD_COORD_RANGE = WORLD_COORD_MAX - WORLD_COORD_MIN;

function worldToCanvasX(wx) {
  const normalized = (wx - WORLD_COORD_MIN) / WORLD_COORD_RANGE;
  return normalized * MINIMAP_SIZE;
}
function worldToCanvasY(wy) {
  // Y 轴翻转
  return (1 - (wy - WORLD_COORD_MIN) / WORLD_COORD_RANGE) * MINIMAP_SIZE;
}
function toCanvasX(minimapX) {
  const normalized = (minimapX - MINIMAP_COORD_MIN) / MINIMAP_COORD_RANGE;
  return normalized * MINIMAP_SIZE;
}
function toCanvasY(minimapY) {
  const normalized = (minimapY - MINIMAP_COORD_MIN) / MINIMAP_COORD_RANGE;
  // Y 轴翻转（minimap 图片 Y 轴向下，canvas Y 轴向上）
  return (1 - normalized) * MINIMAP_SIZE;
}

// 根据当前搜索的战队，生成选手显示名称
// 搜索"XG"时，XG选手显示"XG 5号位"，对手选手显示"<对手> 5号位"
function getPlayerDisplayName(player, match, searchTeamId, searchTeamName) {
  // match.radiant_team_id 和 match.dire_team_id 存储了双方战队ID
  // player.player_slot < 128 = Radiant, >= 128 = Dire
  // 用 match 详情 (matchDataCache) 中获取 radiant_team_id 来判断搜索战队在哪一边
  const matchData = matchDataCache[match.match_id];
  if (!matchData) return '未知';

  const searchTeamIsRadiant = matchData.radiant_team_id === searchTeamId;
  const playerIsRadiant = player.player_slot < 128;
  const isMyTeam = searchTeamIsRadiant === playerIsRadiant;

  const slot = playerIsRadiant ? player.player_slot : player.player_slot - 128;
  const posName = (slot + 1) + '号位';

  if (isMyTeam) {
    return `${searchTeamName} ${posName}`;
  } else {
    const oppName = match.opposing_team_name || '对手';
    return `${oppName} ${posName}`;
  }
}

function formatDate(ts) {
  if (!ts) return '?';
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatDur(s) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

// 显示/隐藏 loading
function showLoading(show) {
  const el = document.getElementById('teamLoading');
  if (el) el.style.display = show ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('teamError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function hideError() {
  const el = document.getElementById('teamError');
  if (el) el.style.display = 'none';
}

// 搜索战队后直接列出20场比赛，可勾选
window.searchTeamDirect = async function () {
  const input = document.getElementById('teamSearchInput');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  showLoading(true);
  hideError();
  document.getElementById('teamResultsSection').style.display = 'none';
  document.getElementById('teamAnalysisArea').style.display = 'none';

  try {
    const res = await fetch(`${OPENDOTA_API}/teams?search=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const teams = await res.json();
    if (!teams || teams.length === 0) {
      showError(`未找到战队 "${query}"`);
      showLoading(false);
      return;
    }

    const q = query.toUpperCase();
    const filtered = teams.filter(t =>
      (t.name || '').toUpperCase().includes(q) ||
      (t.tag || '').toUpperCase().includes(q)
    );

    renderTeamList(filtered, query);
    showLoading(false);
  } catch (e) {
    showError('搜索失败: ' + e.message);
    showLoading(false);
  }
};

// 渲染战队列表
function renderTeamList(teams, query) {
  const section = document.getElementById('teamResultsSection');
  section.innerHTML = `
    <div class="replay-result" style="display:block">
      <div class="replay-result-section">
        <div class="section-title">🏆 搜索 "${query}" 的结果</div>
        <div class="team-list-grid">
          ${teams.map(t => `
            <div class="team-card" onclick="window.loadTeamMatches(${t.team_id}, '${(t.name||'').replace(/'/g,"\\'")}')">
              <img src="${t.logo_url || ''}" class="team-card-logo" onerror="this.style.display='none'">
              <div class="team-card-name">${t.name || t.tag}</div>
              <div class="team-card-meta">${t.wins}胜 ${t.losses}负</div>
              <div class="team-card-rating">Rating: ${t.rating?.toFixed(0) || '?'}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  section.style.display = 'block';
}

// 加载战队比赛列表 - 显示可勾选的列表
window.loadTeamMatches = async function (teamId, teamName) {
  showLoading(true);
  hideError();

  window._currentSearchTeamId = teamId;
  window._currentSearchTeamName = teamName;
  selectedMatches = [];
  allMatches = [];
  Object.keys(matchDataCache).forEach(k => delete matchDataCache[k]);

  try {
    const res = await fetch(`${OPENDOTA_API}/teams/${teamId}/matches`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const matches = await res.json();
    if (!matches || matches.length === 0) {
      showError(`战队 "${teamName}" 暂无比赛记录`);
      showLoading(false);
      return;
    }

    allMatches = matches.slice(0, 20);
    renderMatchList(teamName);
    showLoading(false);
  } catch (e) {
    showError('加载比赛列表失败: ' + e.message);
    showLoading(false);
  }
};

// 渲染比赛列表（可勾选）
function renderMatchList(teamName) {
  const section = document.getElementById('teamResultsSection');
  const analysisArea = document.getElementById('teamAnalysisArea');

  section.innerHTML = `
    <div class="replay-result" style="display:block">
      <div class="replay-result-section">
        <div class="section-title">📋 ${teamName} — 近20场比赛 <span style="font-size:0.75rem;color:#888">（勾选比赛后进入分析）</span></div>
        <div id="matchCardContainer" class="match-list"></div>
        <div style="margin-top:12px;text-align:center;">
          <button class="replay-btn" id="analyzeSelectedBtn" onclick="window.analyzeSelectedMatches()" style="display:none;">
            分析所选比赛（<span id="selectedCount">0</span>场）
          </button>
        </div>
      </div>
    </div>
  `;
  section.style.display = 'block';

  if (analysisArea) analysisArea.style.display = 'none';

  renderMatchCheckboxes();
}

function renderMatchCheckboxes() {
  const container = document.getElementById('matchCardContainer');
  container.innerHTML = allMatches.map((m, i) => {
    const isSelected = selectedMatches.includes(m);
    const oppName = m.opposing_team_name || (m.radiant ? '天辉' : '夜魇');
    const mySide = m.radiant ? '天辉' : '夜魇';
    const won = m.radiant_win ? '胜' : '负';
    return `
      <div class="match-card ${isSelected ? 'selected' : ''}" data-index="${i}" onclick="window.toggleMatch(${i})">
        <input type="checkbox" class="match-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();window.toggleMatch(${i})">
        <div class="match-card-date">${formatDate(m.start_time)}</div>
        <div class="match-card-teams">
          <span class="match-card-team">${mySide}</span>
          <span class="match-card-vs">vs</span>
          <span class="match-card-team">${oppName}</span>
        </div>
        <div class="match-card-score ${won === '胜' ? 'win' : 'loss'}">${m.radiant_score}-${m.dire_score} ${won}</div>
        <div class="match-card-duration">${formatDur(m.duration)}</div>
        <div class="match-card-league">${m.league_name || ''}</div>
      </div>
    `;
  }).join('');

  updateAnalyzeButton();
}

function updateAnalyzeButton() {
  const btn = document.getElementById('analyzeSelectedBtn');
  const count = document.getElementById('selectedCount');
  if (btn) btn.style.display = selectedMatches.length > 0 ? 'inline-block' : 'none';
  if (count) count.textContent = selectedMatches.length;
}

// 切换比赛选中状态
window.toggleMatch = async function (index) {
  const match = allMatches[index];
  const idx = selectedMatches.indexOf(match);
  if (idx >= 0) {
    selectedMatches.splice(idx, 1);
  } else {
    if (selectedMatches.length < 5) {
      selectedMatches.push(match);
    }
  }

  renderMatchCheckboxes();
};

// 分析所选比赛
window.analyzeSelectedMatches = async function () {
  if (selectedMatches.length === 0) return;
  const analysisArea = document.getElementById('teamAnalysisArea');
  const resultsSection = document.getElementById('teamResultsSection');
  if (analysisArea) analysisArea.style.display = 'none';
  showLoading(true);

  try {
    for (const m of selectedMatches) {
      await loadMatchDetail(m.match_id);
      await new Promise(r => setTimeout(r, 300));
    }
    showLoading(false);
    if (analysisArea) {
      analysisArea.style.display = 'flex';
      resultsSection.style.display = 'none';
    }

    const maxDurSec = Math.max(...selectedMatches.map(m => m.duration || 0));
    const maxDurMin = Math.ceil(maxDurSec / 60);
    const slider = document.getElementById('timeRangeSlider');
    if (slider) {
      slider.max = maxDurMin;
      slider.value = maxDurMin;
    }
    timeRange[1] = maxDurSec;
    const timeLabel = document.getElementById('timeRangeLabel');
    if (timeLabel) timeLabel.textContent = `${maxDurMin}分钟`;

    playerFilter = new Set();
    displayMode = 'global';
    showHeatmap = false;
    document.getElementById('btnGlobal').classList.add('active');
    document.getElementById('btnRealtime').classList.remove('active');
    document.getElementById('btnHeatmap').classList.remove('active');
    document.getElementById('teamMapCanvas').style.display = 'block';

    populatePlayerFilter();
    renderWardMap();
    renderWardStats();
  } catch (e) {
    showError('加载比赛数据失败: ' + e.message);
    showLoading(false);
  }
};

// 返回比赛列表
async function loadMatchDetail(matchId) {
  if (matchDataCache[matchId]) return;
  const res = await fetch(`${OPENDOTA_API}/matches/${matchId}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  matchDataCache[matchId] = data;
}

// 初始化 heroNameMap
async function initHeroNameMap() {
  if (Object.keys(heroNameMap).length > 0) return;
  try {
    const res = await fetch(`${OPENDOTA_API}/heroes`);
    const heroes = await res.json();
    heroes.forEach(h => {
      heroNameMap[h.id] = h.name_localized || h.name.replace('npc_dota_hero_', '');
    });
  } catch (e) {}
}

// ==================== 渲染部分 ====================

function renderWardMap() {
  const canvas = document.getElementById('teamMapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  const img = new Image();
  img.src = './Xnip2026-05-25_15-46-28.jpeg';
  img.onload = () => {
    ctx.drawImage(img, 0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    drawAllWards(ctx);
  };
  img.onerror = () => {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    drawAllWards(ctx);
  };
}

function drawAllWards(ctx) {
  let totalObs = 0, totalSen = 0;
  const allObs = [], allSen = [];

  for (const match of selectedMatches) {
    const data = matchDataCache[match.match_id];
    if (!data || !data.players) continue;

    // Build ehandle->destroy_time maps for THIS match only
    const obsDestroyTimes = new Map();
    const senDestroyTimes = new Map();
    for (const player of data.players) {
      (player.obs_left_log || []).forEach(left => {
        if (left.ehandle) obsDestroyTimes.set(left.ehandle, left.time);
      });
      (player.sen_left_log || []).forEach(left => {
        if (left.ehandle) senDestroyTimes.set(left.ehandle, left.time);
      });
    }

    const teamId = window._currentSearchTeamId || '';
    const teamName = window._currentSearchTeamName || '';

    for (const player of data.players) {
      const heroName = heroNameMap[player.hero_id] || '';
      const playerName = getPlayerDisplayName(player, match, teamId, teamName);

      if (playerFilter.size > 0) {
        // Show only wards from selected players/teams
        const myTeam = window._currentSearchTeamName || '';
        const oppTeam = selectedMatches[0]?.opposing_team_name || '对手';

        const isMyTeamAll = playerFilter.has(myTeam + ' 全队');
        const isOppTeamAll = playerFilter.has(oppTeam + ' 全队');

        // If "全部选手" or no filter, show all
        if (playerFilter.has('全部选手') || playerFilter.size === 0) {
          // show all
        } else if (isMyTeamAll && isOppTeamAll) {
          // show all (both teams selected)
        } else if (isMyTeamAll) {
          // show only my team
          if (!playerName.startsWith(myTeam)) continue;
        } else if (isOppTeamAll) {
          // show only opponent team
          if (!playerName.startsWith(oppTeam)) continue;
        } else {
          // show only specific selected players
          if (!playerFilter.has(playerName)) continue;
        }
      }

      (player.obs_log || []).forEach(o => {
        if (o.time > timeRange[1]) return;
        const endTime = o.ehandle && obsDestroyTimes.has(o.ehandle)
          ? obsDestroyTimes.get(o.ehandle)
          : null;
        if (displayMode === 'realtime' && endTime !== null && endTime < timeRange[1]) return;
        allObs.push({ x: o.x, y: o.y, hero: heroName, player: playerName, time: o.time, duration: endTime !== null ? endTime - o.time : null });
        totalObs++;
      });
      (player.sen_log || []).forEach(s => {
        if (s.time > timeRange[1]) return;
        const endTime = s.ehandle && senDestroyTimes.has(s.ehandle)
          ? senDestroyTimes.get(s.ehandle)
          : null;
        if (displayMode === 'realtime' && endTime !== null && endTime < timeRange[1]) return;
        allSen.push({ x: s.x, y: s.y, hero: heroName, player: playerName, time: s.time, duration: endTime !== null ? endTime - s.time : null });
        totalSen++;
      });
    }
  }

  // Observer 黄色圆点 - 持续时间越长越亮（透明度和半径）

  const canvas = document.getElementById('teamMapCanvas');

  if (currentFilters.obs) {
    allObs.forEach(o => {
      const cx = toCanvasX(o.x);
      const cy = toCanvasY(o.y);
      let alpha = 0.5;
      let radius = 5;
      if (o.duration !== null) {
        alpha = Math.min(1, 0.3 + (o.duration / 360) * 0.7);
        radius = Math.min(8, 4 + (o.duration / 360) * 4);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    });
  }

  // Sentry 蓝色圆点
  if (currentFilters.sen) {
    allSen.forEach(s => {
      const cx = toCanvasX(s.x);
      const cy = toCanvasY(s.y);
      let alpha = 0.5;
      let radius = 4;
      if (s.duration !== null) {
        alpha = Math.min(1, 0.3 + (s.duration / 360) * 0.7);
        radius = Math.min(7, 3 + (s.duration / 360) * 4);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#4a9eff';
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    });
  }

  // 更新统计数据
  document.getElementById('totalObs').textContent = totalObs;
  document.getElementById('totalSen').textContent = totalSen;

  // 热力图叠加在眼位图上
  if (showHeatmap) {
    drawHeatmapOverlay(ctx);
  }
}

function renderWardStats() {
  const panel = document.getElementById('teamStatsPanel');
  if (!panel) return;

  const stats = selectedMatches.map(m => {
    const data = matchDataCache[m.match_id];
    let obs = 0, sen = 0;
    if (data && data.players) {
      for (const p of data.players) {
        obs += p.obs_placed || 0;
        sen += p.sen_placed || 0;
      }
    }
    const opp = m.opposing_team_name || (m.radiant ? '天辉' : '夜魇');
    const won = m.radiant_win ? '胜' : '负';
    return { m, obs, sen, opp, won };
  });

  panel.innerHTML = `
    <div class="replay-result-section">
      <div class="section-title">📋 已选比赛（${selectedMatches.length}场）</div>
      <div class="match-stats-list">
        ${stats.map(s => `
          <div class="match-stats-row">
            <span class="ms-date">${formatDate(s.m.start_time)}</span>
            <span class="ms-opp">${s.m.radiant?'天辉':'夜魇'} vs ${s.opp}</span>
            <span class="ms-score ${s.won==='胜'?'win':'loss'}">${s.m.radiant_score}-${s.m.dire_score}</span>
            <span class="ms-ward"><span style="color:#ffd700">${s.obs}</span>/<span style="color:#4a9eff">${s.sen}</span></span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// 切换 OBS/Sentry 显示
window.toggleWardFilter = function (type) {
  // 如果当前显示热力图，先切回眼位图
  if (showHeatmap) {
    showHeatmap = false;
    document.getElementById('btnHeatmap').classList.remove('active');
    document.getElementById('teamMapCanvas').style.display = 'block';
    document.getElementById('teamHeatmapCanvas').style.display = 'none';
  }
  if (type === 'obs') currentFilters.obs = !currentFilters.obs;
  if (type === 'sen') currentFilters.sen = !currentFilters.sen;

  document.getElementById('btnObs').classList.toggle('active', currentFilters.obs);
  document.getElementById('btnSen').classList.toggle('active', currentFilters.sen);

  renderWardMap();
};

// 切换选手/队伍筛选复选框
window.togglePlayerFilter = function (val) {
  if (val === '全部选手') {
    playerFilter = new Set(['全部选手']);
  } else {
    playerFilter.delete('全部选手');
    if (playerFilter.has(val)) {
      playerFilter.delete(val);
    } else {
      playerFilter.add(val);
    }
    if (playerFilter.size === 0) {
      playerFilter.add('全部选手');
    }
  }
  // Update player filter checkbox visual states
  document.querySelectorAll('.pf-checkbox[data-value]').forEach(cb => {
    cb.classList.toggle('active', playerFilter.has(cb.dataset.value));
  });
  if (showHeatmap) {
    renderHeatmap();
  } else {
    renderWardMap();
  }
};

// 应用时间筛选 (slider value is in minutes, convert to seconds)
window.applyTimeFilter = function (valMin) {
  timeRange[1] = parseInt(valMin) * 60;
  document.getElementById('timeRangeLabel').textContent = valMin >= 9999 ? '全程' : `${valMin}分钟`;
  renderWardMap(); // showHeatmap 开关在 drawAllWards 内部判断
};

// 切换显示模式：全局 或 实时
window.setDisplayMode = function (mode) {
  displayMode = mode;
  document.getElementById('btnGlobal').classList.toggle('active', mode === 'global');
  document.getElementById('btnRealtime').classList.toggle('active', mode === 'realtime');
  renderWardMap();
};

// 切换热力图显示（在眼位图画布上叠加热力图）
window.toggleHeatmap = function () {
  showHeatmap = !showHeatmap;
  document.getElementById('btnHeatmap').classList.toggle('active', showHeatmap);
  renderWardMap(); // 统一走 renderWardMap，drawAllWards 内部判断 showHeatmap
};

// 热力图叠加直接在 drawAllWards 末尾绘制（复用同一 canvas）
// 数据源：obs_log + sen_log 的 x/y（minimap 坐标 64-192）
function drawHeatmapOverlay(ctx) {
  const GRID = 128;
  const cellSize = MINIMAP_SIZE / GRID;
  const grid = new Float32Array(GRID * GRID);
  let totalActions = 0;

  for (const match of selectedMatches) {
    const data = matchDataCache[match.match_id];
    if (!data || !data.players) continue;

    const teamId = window._currentSearchTeamId || '';
    const teamName = window._currentSearchTeamName || '';
    const oppTeam = match.opposing_team_name || '对手';

    for (const player of data.players) {
      const playerName = getPlayerDisplayName(player, match, teamId, teamName);
      if (playerFilter.size > 0 && !playerFilter.has('全部选手')) {
        const myTeamAll = playerFilter.has(teamName + ' 全队');
        const oppTeamAll = playerFilter.has(oppTeam + ' 全队');
        if (!myTeamAll && !oppTeamAll && !playerFilter.has(playerName)) continue;
        if (myTeamAll && !playerName.startsWith(teamName)) continue;
        if (oppTeamAll && playerName.startsWith(teamName)) continue;
      }

      for (const src of ['obs_log', 'sen_log']) {
        const logs = player[src] || [];
        for (const entry of logs) {
          const t = entry.time || 0;
          if (t > timeRange[1]) continue;
          const x = entry.x, y = entry.y;
          if (typeof x !== 'number' || typeof y !== 'number') continue;
          totalActions++;

          const cx = toCanvasX(x);
          const cy = toCanvasY(y);
          const sigma = cellSize * 3;
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const gx0 = Math.floor(cx / cellSize) + dx;
              const gy0 = Math.floor(cy / cellSize) + dy;
              if (gx0 < 0 || gx0 >= GRID || gy0 < 0 || gy0 >= GRID) continue;
              const wx = (gx0 + 0.5) * cellSize;
              const wy = (gy0 + 0.5) * cellSize;
              const dist2 = (wx - cx) ** 2 + (wy - cy) ** 2;
              const weight = Math.exp(-dist2 / (2 * sigma * sigma));
              grid[gy0 * GRID + gx0] += weight;
            }
          }
        }
      }
    }
  }

  if (totalActions === 0) return;

  const maxVal = Math.max(...grid);
  const imgGrid = new Uint8ClampedArray(MINIMAP_SIZE * MINIMAP_SIZE * 4);

  for (let py = 0; py < MINIMAP_SIZE; py++) {
    for (let px = 0; px < MINIMAP_SIZE; px++) {
      const gx = Math.floor(px / cellSize);
      const gy = Math.floor(py / cellSize);
      const v = grid[gy * GRID + gx];
      const norm = Math.min(1, v / (maxVal * 0.2));
      if (norm < 0.01) continue;
      const idx = (py * MINIMAP_SIZE + px) * 4;
      if (norm < 0.33) {
        imgGrid[idx]     = Math.round(norm / 0.33 * 255);
        imgGrid[idx + 1] = 0;
        imgGrid[idx + 2] = 0;
      } else if (norm < 0.66) {
        const t = (norm - 0.33) / 0.33;
        imgGrid[idx]     = 255;
        imgGrid[idx + 1] = Math.round(t * 255);
        imgGrid[idx + 2] = 0;
      } else {
        const t = (norm - 0.66) / 0.34;
        imgGrid[idx]     = 255;
        imgGrid[idx + 1] = 255;
        imgGrid[idx + 2] = Math.round(t * 255);
      }
      imgGrid[idx + 3] = Math.round(norm * 180);
    }
  }

  ctx.putImageData(new ImageData(imgGrid, MINIMAP_SIZE, MINIMAP_SIZE), 0, 0);
}

// 返回比赛列表
window.backToMatchList = function () {
  const section = document.getElementById('teamResultsSection');
  const area = document.getElementById('teamAnalysisArea');
  if (area) area.style.display = 'none';
  if (section) section.style.display = 'block';
  selectedMatches = [];
  allMatches = [];
  Object.keys(matchDataCache).forEach(k => delete matchDataCache[k]);
  timeRange = [0, 9999];
  playerFilter = new Set();
  displayMode = 'global';
  showHeatmap = false;
};

// 填充选手筛选复选框（进入分析界面时调用）
function populatePlayerFilter() {
  const panel = document.getElementById('playerFilterPanel');
  if (!panel) return;

  const teamId = window._currentSearchTeamId || '';
  const teamName = window._currentSearchTeamName || '';

  let myTeamFullName = null;
  let oppTeamFullName = null;
  const playerSet = new Set();

  for (const match of selectedMatches) {
    const data = matchDataCache[match.match_id];
    if (!data) continue;
    if (!myTeamFullName) {
      myTeamFullName = teamName + ' 全队';
      oppTeamFullName = match.opposing_team_name ? match.opposing_team_name + ' 全队' : '对手 全队';
    }
    if (!data.players) continue;
    for (const p of data.players) {
      const name = getPlayerDisplayName(p, match, teamId, teamName);
      if (name) playerSet.add(name);
    }
  }

  // Sort: 全队 first, then by position
  const players = [...playerSet].sort((a, b) => {
    if (a.includes('全队') && !b.includes('全队')) return -1;
    if (!a.includes('全队') && b.includes('全队')) return 1;
    const posA = parseInt(a.match(/(\d+)号位/)?.[1] || '99');
    const posB = parseInt(b.match(/(\d+)号位/)?.[1] || '99');
    if (posA !== posB) return posA - posB;
    return a.localeCompare(b);
  });

  // Separate my team, opp team, and individual players
  const myTeamPlayers = players.filter(n => n.startsWith(teamName) && !n.includes('全队'));
  const oppTeamPlayers = players.filter(n => !n.startsWith(teamName));
  const myTeamTag = teamName;
  const oppTeamTag = oppTeamFullName.replace(' 全队', '');

  // Build checkbox HTML
  const makeCheckbox = (label, value) =>
    `<label class="pf-checkbox ${playerFilter.has(value) || (value === '全部选手' && playerFilter.size === 0) ? 'active' : ''}" data-value="${value}" onclick="window.togglePlayerFilter('${value}')">${label}</label>`;

  const myTeamSection = myTeamPlayers.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
        <span style="font-size:0.65rem;color:#ffd700;width:100%;margin-top:4px;">${teamName}</span>
        ${makeCheckbox('全队', myTeamFullName)}
        ${myTeamPlayers.map(p => makeCheckbox(p, p)).join('')}
       </div>`
    : '';

  const oppTeamSection = oppTeamPlayers.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;">
        <span style="font-size:0.65rem;color:#4a9eff;width:100%;">${oppTeamTag}</span>
        ${makeCheckbox('全队', oppTeamFullName)}
        ${oppTeamPlayers.map(p => makeCheckbox(p, p)).join('')}
       </div>`
    : '';

  panel.innerHTML = `
    ${makeCheckbox('全部', '全部选手')}
    ${myTeamSection}
    ${oppTeamSection}
  `;
}

// 初始化
window.initTeamModule = async function () {
  await initHeroNameMap();
};
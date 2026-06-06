// ==================== TEAM ANALYSIS MODULE ====================
// Replaces the old single-match replay analysis.
// Flow: pick team (curated + search) -> crawl 20 recent matches via OpenDota ->
//       aggregate heroes by lane_role -> recommend counters via BP.getCounterScore ->
//       aggregate obs/sen_log positions -> render Dota2 minimap heatmap.

const Team = {
  initialized: false,
  busy: false,
  searchAbort: null,
  analyzeAbort: null,
  _teamsCache: null,            // in-memory cache of all OpenDota teams (search backend)
  _curatedTeams: null,          // config/teams.json
  _rosterSet: null,             // Set<account_id> for currently selected team
  _rosterTeamId: null,          // team_id the roster belongs to
  _heroIdMap: null,             // hero_id (int) -> { key, localized }
  _resizeBound: false,
};

const TEAM_STATUS_LOADING_DELAY_MS = 250;
const MATCH_CONCURRENCY = 4;
const MATCH_TIMEOUT_MS = 20000;
const MATCH_TARGET = 20;
const WARD_GRID = 4;            // bucket ward (x,y) to nearest WARD_GRID-cell
const WARD_TOP_N = 30;
const SEARCH_DEBOUNCE_MS = 250;
const TEAM_ROSTER_HIT_THRESHOLD = 3;  // min roster overlap to trust a side identification
// OpenDota's obs_log / sen_log use Dota 2 world coordinates. 实测多战队 20 场
// 范围 x: 65.1-193.6, y: 59.9-191.6 (来源: probe_wards.js)。用稍宽的窗口
// 56-200 捕获 outliers，再由 canvas 内的 X_MIN/X_MAX=0.03-0.97 把点压回底图
// 实际可玩区 (避开两侧黑边)。
const WARD_WORLD_MIN = 56;
const WARD_WORLD_MAX = 200;
const REPLAY_STATUS = 'teamStatus';
const PROGRESS_STATUS = 'teamProgressStatus';

// ==================== INIT ====================
async function initTeam() {
  if (Team.initialized) return;
  Team.initialized = true;

  setStatus(REPLAY_STATUS, '加载中...', 'loading');
  document.getElementById('teamResultCard').style.display = 'none';
  document.getElementById('teamProgressCard').style.display = 'none';

  // Load curated teams + ensure BP is loaded
  try {
    const res = await fetch('config/teams.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    Team._curatedTeams = data.teams || [];
  } catch (e) {
    Team._curatedTeams = [];
    console.warn('Failed to load config/teams.json:', e);
  }

  // Wait for BP.loadHeroes() to be ready (it might already be loading from BP tab)
  const bpReady = (window.BP && window.BP.heroesData)
    ? Promise.resolve()
    : (window.BP ? window.BP.loadHeroes() : Promise.reject(new Error('BP not loaded')));

  try {
    await bpReady;
  } catch (e) {
    setStatus(REPLAY_STATUS, '英雄数据加载失败，请刷新重试', 'error');
    return;
  }

  renderCuratedChips();
  bindSearchInput();
  bindAnalyzeButton();
  bindResize();

  setStatus(REPLAY_STATUS, '', null);
}

// ==================== HERO ID MAPPING (OpenDota numeric -> BP string key) ====================
// OpenDota's match data uses numeric `hero_id` (e.g., 110). The BP module's counter
// matrix is keyed on string IDs like `npc_dota_hero_X`. We fetch /api/heroes once
// (24h cached via loadCachedOrFetch) and build the bridge.
async function buildHeroIdMap() {
  if (Team._heroIdMap) return Team._heroIdMap;
  try {
    const arr = await loadCachedOrFetch('https://api.opendota.com/api/heroes', 'opendota_heroes_v1');
    const map = new Map();
    for (const h of (arr || [])) {
      if (typeof h.id === 'number' && h.name) {
        // h.name is the canonical key like 'npc_dota_hero_antimage' — directly
        // usable in BP.getHeroById / getCounterScore / getHeroName.
        map.set(h.id, h.name);
      }
    }
    Team._heroIdMap = map;
  } catch (e) {
    console.warn('Failed to load /api/heroes for mapping:', e);
    Team._heroIdMap = new Map();
  }
  return Team._heroIdMap;
}

function renderCuratedChips() {
  const container = document.getElementById('teamChips');
  if (!container) return;
  const teams = Team._curatedTeams || [];
  if (teams.length === 0) {
    container.innerHTML = '<div class="team-empty">精选战队加载失败，请使用下方搜索</div>';
    return;
  }
  container.innerHTML = teams.map(t => {
    const id = t.team_id;
    const disabled = !id ? ' disabled' : '';
    const title = !id ? ' title="暂未收录，请用搜索"' : '';
    return `
      <button class="team-chip${disabled}" data-team-id="${id || ''}" data-team-name="${escapeHtml(t.name)}"${title}>
        <span class="team-chip-tag">${escapeHtml(t.tag || '')}</span>
        <span class="team-chip-name">${escapeHtml(t.name)}</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.team-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.disabled) return;
      container.querySelectorAll('.team-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      Team._pendingTeam = {
        team_id: Number(chip.dataset.teamId),
        name: chip.dataset.teamName,
      };
      setStatus(REPLAY_STATUS, '已选择：' + chip.dataset.teamName, null);
    });
  });
}

function bindSearchInput() {
  const input = document.getElementById('teamSearchInput');
  const dropdown = document.getElementById('teamSearchResults');
  if (!input || !dropdown) return;
  let debounceId = null;
  let lastQuery = '';

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (debounceId) clearTimeout(debounceId);
    if (q === lastQuery) return;
    lastQuery = q;
    if (q.length === 0) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }
    debounceId = setTimeout(() => runTeamSearch(q), SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (q.length > 0) runTeamSearch(q);
    }
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.style.display = 'none';
    }
  });
}

async function runTeamSearch(query) {
  if (Team.searchAbort) Team.searchAbort.abort();
  Team.searchAbort = new AbortController();
  const signal = Team.searchAbort.signal;
  const dropdown = document.getElementById('teamSearchResults');

  // Lazy-load all teams (24h cache via loadCachedOrFetch)
  if (!Team._teamsCache) {
    try {
      const data = await loadCachedOrFetch('https://api.opendota.com/api/teams', 'opendota_teams_v1');
      Team._teamsCache = data || [];
    } catch (e) {
      if (signal.aborted) return;
      dropdown.innerHTML = '<div class="team-search-empty">战队列表加载失败，请检查网络</div>';
      dropdown.style.display = 'block';
      return;
    }
  }
  if (signal.aborted) return;

  const q = query.toLowerCase();
  const matches = (Team._teamsCache || [])
    .filter(t => {
      const name = (t.name || '').toLowerCase();
      const tag = (t.tag || '').toLowerCase();
      return name.includes(q) || tag.includes(q);
    })
    .slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="team-search-empty">未找到匹配战队</div>';
  } else {
    dropdown.innerHTML = matches.map(t => `
      <div class="team-search-item" data-team-id="${t.team_id}" data-team-name="${escapeHtml(t.name)}">
        <span class="team-search-tag">${escapeHtml(t.tag || '')}</span>
        <span class="team-search-name">${escapeHtml(t.name)}</span>
        <span class="team-search-meta">${(t.wins || 0)}胜 ${(t.losses || 0)}负</span>
      </div>
    `).join('');
    dropdown.querySelectorAll('.team-search-item').forEach(item => {
      item.addEventListener('click', () => {
        Team._pendingTeam = {
          team_id: Number(item.dataset.teamId),
          name: item.dataset.teamName,
        };
        document.getElementById('teamSearchInput').value = item.dataset.teamName;
        dropdown.style.display = 'none';
        document.querySelectorAll('.team-chip').forEach(c => c.classList.remove('active'));
        setStatus(REPLAY_STATUS, '已选择：' + item.dataset.teamName, null);
      });
    });
  }
  dropdown.style.display = 'block';
}

function bindAnalyzeButton() {
  const btn = document.getElementById('teamAnalyzeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (Team.busy) return;
    const pending = Team._pendingTeam;
    if (!pending || !pending.team_id) {
      setStatus(REPLAY_STATUS, '请先选择一支战队（点芯片或在搜索框里搜）', 'error');
      return;
    }
    startAnalysis(pending.team_id, pending.name);
  });
}

function bindResize() {
  if (Team._resizeBound) return;
  Team._resizeBound = true;
  let raf = null;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (Team._lastWardMap) renderWardHeatmap(Team._lastWardMap);
    });
  });
}

// ==================== ANALYSIS PIPELINE ====================
async function startAnalysis(teamId, teamName) {
  if (Team.busy) return;
  Team.busy = true;

  const btn = document.getElementById('teamAnalyzeBtn');
  const oldText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = '分析中…'; }

  // Reset UI
  document.getElementById('teamResultCard').style.display = 'none';
  document.getElementById('teamProgressCard').style.display = 'block';
  resetProgressSteps();
  setStatus(REPLAY_STATUS, '开始分析：' + teamName, 'loading');

  Team._rosterSet = null;
  Team._rosterTeamId = teamId;
  if (Team.analyzeAbort) Team.analyzeAbort.abort();
  Team.analyzeAbort = new AbortController();
  const signal = Team.analyzeAbort.signal;

  try {
    // Step 1: roster
    markProgress('step1', 'running');
    setStatus(REPLAY_STATUS, '加载战队信息…', 'loading');
    let roster;
    try {
      roster = await fetchRoster(teamId, signal);
    } catch (e) {
      markProgress('step1', 'error', e.message);
      throw e;
    }
    Team._rosterSet = roster.accountIds;
    markProgress('step1', 'done', `已识别 ${roster.accountIds.size} 名选手`);
    if (signal.aborted) return;

    // Step 2: match list
    markProgress('step2', 'running');
    setStatus(REPLAY_STATUS, '拉取最近 20 场比赛…', 'loading');
    let matchIds;
    try {
      matchIds = await fetchMatchList(teamId, signal);
    } catch (e) {
      markProgress('step2', 'error', e.message);
      throw e;
    }
    if (!matchIds || matchIds.length === 0) {
      markProgress('step2', 'error', '该战队暂无公开比赛记录');
      setStatus(REPLAY_STATUS, '该战队暂无公开比赛记录，请换一支', 'error');
      return;
    }
    markProgress('step2', 'done', `共 ${matchIds.length} 场比赛`);
    if (signal.aborted) return;

    // Step 3: fetch matches in parallel
    markProgress('step3', 'running');
    const matches = [];
    const errors = [];
    let done = 0;
    const total = matchIds.length;
    await parallelMap(matchIds, MATCH_CONCURRENCY, async (mid) => {
      try {
        const m = await fetchMatch(mid, signal);
        matches.push(m);
      } catch (e) {
        errors.push({ matchId: mid, message: e.message });
        console.warn('match', mid, 'failed:', e.message);
      }
      done += 1;
      setStatus(REPLAY_STATUS, `加载比赛详情 (${done}/${total})…`, 'loading');
      markProgress('step3', 'running', `${done}/${total}`);
    });
    if (signal.aborted) return;

    if (matches.length === 0) {
      markProgress('step3', 'error', '所有比赛拉取均失败');
      setStatus(REPLAY_STATUS, '比赛拉取均失败，请稍后重试。OpenDota 在大陆访问可能慢。', 'error');
      return;
    }
    markProgress('step3', 'done', `成功 ${matches.length}/${total} 场` + (errors.length ? `，跳过 ${errors.length} 场` : ''));
    if (signal.aborted) return;

    // Step 4: hero positions + counters
    markProgress('step4', 'running');
    setStatus(REPLAY_STATUS, '解析位置 + 克制…', 'loading');
    const heroIdMap = await buildHeroIdMap();
    const usable = matches.filter(m => identifyOurSide(m, Team._rosterSet));
    if (usable.length === 0) {
      markProgress('step4', 'error', '无可识别的我方比赛');
      setStatus(REPLAY_STATUS, '这 20 场比赛里没有该战队的阵容（可能 roster 已变更）', 'error');
      return;
    }
    const { buckets, unified } = aggregateHeroPositions(usable, Team._rosterSet, heroIdMap);
    const unifiedTop = topHeroesUnified(unified, 10);
    const unifiedCounters = recommendUnifiedCounters(unifiedTop, 12);
    const matchStats = aggregateMatchStats(usable, Team._rosterSet, heroIdMap);
    const playerStats = aggregatePlayerStats(usable, Team._rosterSet, heroIdMap);
    markProgress('step4', 'done', `${usable.length} 场可分析`);
    if (signal.aborted) return;

    // Step 5: ward aggregation
    markProgress('step5', 'running');
    setStatus(REPLAY_STATUS, '汇总眼位…', 'loading');
    const wardSplit = aggregateWardsBySide(usable, Team._rosterSet);
    Team._lastWardSplit = wardSplit;
    renderCounters({
      unifiedTop,
      unifiedCounters,
      matchCount: usable.length,
      teamName,
      matchStats,
      playerStats,
    });
    // Show the result card BEFORE sizing the heatmap canvas, otherwise the
    // #teamWardmapWrap has zero dimensions (display:none ancestor) and the
    // canvas would fall back to the 200px minimum.
    document.getElementById('teamResultCard').style.display = 'block';
    // requestAnimationFrame ensures the card has actually been laid out
    // before we measure the wrap and draw the canvas.
    requestAnimationFrame(() => renderWardHeatmaps(wardSplit));
    const totalWards = wardSplit.radWardsTotal + wardSplit.direWardsTotal;
    markProgress('step5', 'done', `汇总 ${totalWards} 个眼位`);

    setStatus(REPLAY_STATUS, '分析完成', 'success');
  } catch (e) {
    if (e.name === 'AbortError') {
      setStatus(REPLAY_STATUS, '已取消', null);
    } else {
      setStatus(REPLAY_STATUS, '分析失败：' + (e.message || '未知错误'), 'error');
    }
  } finally {
    Team.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

function resetProgressSteps() {
  ['step1', 'step2', 'step3', 'step4', 'step5'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('done', 'error', 'running');
    const detail = el.querySelector('.team-progress-detail');
    if (detail) detail.textContent = '';
  });
}

function markProgress(id, kind, detailText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('done', 'error', 'running');
  if (kind) el.classList.add(kind);
  const detail = el.querySelector('.team-progress-detail');
  if (detail && detailText) detail.textContent = detailText;
}

// ==================== OPENDOTA FETCHERS ====================
async function fetchRoster(teamId, signal) {
  // OpenDota's /api/teams/{id} does NOT include a `players` array on the bare response.
  // The canonical roster endpoint is /api/teams/{id}/players.
  const res = await fetch('https://api.opendota.com/api/teams/' + teamId + '/players', { signal });
  if (!res.ok) {
    if (res.status === 429) throw new Error('限流（429）');
    if (res.status === 404) throw new Error('未找到该战队');
    throw new Error('HTTP ' + res.status);
  }
  const arr = await res.json();
  const accountIds = new Set();
  for (const p of (arr || [])) {
    if (p.account_id) accountIds.add(p.account_id);
  }
  if (accountIds.size === 0) throw new Error('该战队暂无 roster 信息');
  return { accountIds, raw: arr };
}

async function fetchMatchList(teamId, signal) {
  const res = await fetch('https://api.opendota.com/api/teams/' + teamId + '/matches', { signal });
  if (!res.ok) {
    if (res.status === 429) throw new Error('限流（429）');
    throw new Error('HTTP ' + res.status);
  }
  const arr = await res.json();
  // Newest first; OpenDota may not have a `limit` param, so slice client-side
  return (arr || []).slice(0, MATCH_TARGET).map(m => m.match_id).filter(Boolean);
}

async function fetchMatch(matchId, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MATCH_TIMEOUT_MS);
  // Chain our external signal to the internal controller
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch('https://api.opendota.com/api/matches/' + matchId, { signal: controller.signal });
    if (!res.ok) {
      if (res.status === 429) throw new Error('限流（429）');
      if (res.status === 404) throw new Error('比赛未公开');
      throw new Error('HTTP ' + res.status);
    }
    const m = await res.json();
    if (!m || !m.players) throw new Error('比赛数据为空');
    return m;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Run fn across items with at most `concurrency` in flight.
async function parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ==================== SIDE IDENTIFICATION ====================
function identifyOurSide(match, rosterSet) {
  if (!match || !match.players) return null;
  // OpenDota does not populate `players[].team` on the bare /matches endpoint.
  // Side comes from `player_slot`: < 128 = Radiant, >= 128 = Dire.
  let radHit = 0, dirHit = 0;
  for (const p of match.players) {
    if (!p.account_id) continue;
    if (!rosterSet.has(p.account_id)) continue;
    const slot = p.player_slot;
    if (slot === undefined || slot === null) continue;
    if (slot < 128) radHit++;
    else dirHit++;
  }
  if (radHit < TEAM_ROSTER_HIT_THRESHOLD && dirHit < TEAM_ROSTER_HIT_THRESHOLD) {
    return null;
  }
  return radHit >= dirHit ? 'radiant' : 'dire';
}

function ourPlayers(match, side) {
  if (!side) return [];
  const wantRadiant = side === 'radiant';
  return (match.players || []).filter(p => {
    if (p.player_slot === undefined || p.player_slot === null) return false;
    return wantRadiant ? p.player_slot < 128 : p.player_slot >= 128;
  });
}

// ==================== HERO / POSITION AGGREGATION ====================
// OpenDota's `lane_role` is "farm priority in lane" and lumps the offlane side
// (3号位 + 4号位 + 5号位) all under lane_role=3, so 4/5 would always be empty.
// Instead we sort our team's 5 players by `player_slot` (0-4 Radiant, 128-132
// Dire) and assign 1号位..5号位 by that order. This matches the convention BP
// already uses for filtering heroes by position.
// Returns { buckets, unified }:
//   buckets[pos] = Map<bpHeroId, count>   for per-position display
//   unified      = Map<bpHeroId, count>   summed across all positions
function aggregateHeroPositions(matches, rosterSet, heroIdMap) {
  const buckets = { 1: new Map(), 2: new Map(), 3: new Map(), 4: new Map(), 5: new Map() };
  const unified = new Map();
  for (const m of matches) {
    const side = identifyOurSide(m, rosterSet);
    if (!side) continue;
    const our = ourPlayers(m, side).slice();
    our.sort((a, b) => (a.player_slot || 0) - (b.player_slot || 0));
    for (let i = 0; i < our.length && i < 5; i++) {
      const p = our[i];
      if (!p.hero_id) continue;
      const bpId = heroIdMap && heroIdMap.get(p.hero_id);
      if (!bpId) continue;
      if (!window.BP.getHeroById(bpId)) continue;
      const pos = i + 1;
      buckets[pos].set(bpId, (buckets[pos].get(bpId) || 0) + 1);
      unified.set(bpId, (unified.get(bpId) || 0) + 1);
    }
  }
  return { buckets, unified };
}

function topHeroesPerPosition(buckets, n) {
  const result = {};
  for (const pos of [1, 2, 3, 4, 5]) {
    const arr = Array.from(buckets[pos].entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([heroId, count]) => ({ heroId, count }));
    result[pos] = arr;
  }
  return result;
}

// Top N heroes across all positions combined, ordered by total play count.
function topHeroesUnified(unified, n) {
  return Array.from(unified.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([heroId, count]) => ({ heroId, count }));
}

// ==================== UNIFIED COUNTER RECOMMENDATION ====================
// Score each BP hero by SUM of `getCounterScore(cand, t) * t.count` over the
// team's most-played heroes. Heroes the team plays MORE OF get higher weight
// — a hero countering 1 of the team's 6-game signature at 5 scores 30, while
// a hero countering 1 of their 2-game pocket pick at 5 scores only 10. This
// matches the user's "出现多的权重更高" intent without abandoning the rest
// of the top-10 pool.
function recommendUnifiedCounters(targets, k) {
  const allHeroes = window.BP.getAllHeroes();
  const targetIds = new Set(targets.map(t => t.heroId));
  const results = [];
  for (const cand of allHeroes) {
    if (targetIds.has(cand.id)) continue;
    let totalScore = 0;
    let hits = 0;
    let topHits = 0;
    const covered = [];
    for (const t of targets) {
      const s = window.BP.getCounterScore(cand.id, t.heroId);
      if (s > 0) {
        totalScore += s * t.count;     // weight = play count
        hits++;
        if (t.count >= 4) topHits++;  // "popular" threshold for the X/3 label
        covered.push(t.heroId);
      }
    }
    if (hits === 0) continue;
    results.push({
      heroId: cand.id,
      heroName: window.BP.getHeroName(cand.id) || cand.id,
      totalScore: +totalScore.toFixed(2),
      hits,
      topHits,
      targetsCovered: covered,
    });
  }
  results.sort((a, b) => b.totalScore - a.totalScore);
  return results.slice(0, k);
}

function getHeroRoles(heroId, heroIdMap) {
  if (!heroId) return null;
  const bpId = heroIdMap && heroIdMap.get(heroId);
  if (!bpId) return null;
  const hero = window.BP.getHeroById(bpId);
  if (!hero || !hero.roles || hero.roles.length === 0) return null;
  return hero.roles;
}

// ==================== MATCH STATS AGGREGATION ====================
// Infer a unique position (1-5) for each player in a match, ensuring each
// position is filled by at most ONE player-game per match. This avoids the
// previous bug where heroes with roles=[1,2] (e.g. Gyrocopter) and heroes
// with roles=[1,3] (e.g. Lone Druid) were both classified as pos 1 by
// `roles[0]`, leading to a single match counting as 2 player-games for
// pos 1 and pushing the per-position total above the actual match count.
//
// Algorithm:
//   - lane_role=1 → pos 1   (safe lane, 1 player)
//   - lane_role=2 → pos 2   (mid, 1 player)
//   - lane_role=4 → pos 4   (jungle, 1 player)
//   - lane_role=3 → split the 3 offlane-side players into 3/4/5 by hero roles:
//       * hero with only role 3 → pos 3
//       * hero with only role 5 (or roles={4,5} containing 5) → pos 5
//       * remaining → pos 4
function assignPositionsForMatch(match, side, heroIdMap) {
  const our = ourPlayers(match, side);
  const assigned = new Map();  // account_id -> pos

  // Group by lane_role
  const byLane = { 1: [], 2: [], 3: [], 4: [], 0: [] };
  for (const p of our) {
    if (!p.account_id) continue;
    const lr = (p.lane_role >= 0 && p.lane_role <= 4) ? p.lane_role : 0;
    byLane[lr].push(p);
  }

  if (byLane[1].length > 0) {
    assigned.set(byLane[1][0].account_id, 1);
  }
  if (byLane[2].length > 0) {
    assigned.set(byLane[2][0].account_id, 2);
  }
  if (byLane[4].length > 0) {
    assigned.set(byLane[4][0].account_id, 4);
  }

  // offlane trilane (or duo): split into 3/4/5
  const offlane = byLane[3];
  if (offlane.length >= 1) {
    const items = offlane.map(p => ({ player: p, roles: getHeroRoles(p.hero_id, heroIdMap) || [] }));

    // 1) pos 3: hero whose only role is 3, or who has 3 but no 4/5
    const pos3Candidate = items.find(c =>
      (c.roles.length === 1 && c.roles[0] === 3) ||
      (c.roles.includes(3) && !c.roles.includes(4) && !c.roles.includes(5))
    ) || items.find(c => c.roles.includes(3));

    // 2) pos 5: hero whose only role is 5, or who has 5 but no 3/4
    const pos5Candidate = items.find(c =>
      c !== pos3Candidate && (
        (c.roles.length === 1 && c.roles[0] === 5) ||
        (c.roles.includes(5) && !c.roles.includes(3) && !c.roles.includes(4))
      )
    ) || items.find(c => c !== pos3Candidate && c.roles.includes(5));

    // 3) pos 4: first remaining
    const pos4Candidate = items.find(c => c !== pos3Candidate && c !== pos5Candidate);

    if (pos3Candidate) assigned.set(pos3Candidate.player.account_id, 3);
    if (pos4Candidate) assigned.set(pos4Candidate.player.account_id, 4);
    if (pos5Candidate) assigned.set(pos5Candidate.player.account_id, 5);
  }

  // lane_role=0 or missing: fall back to roles[0]
  for (const p of byLane[0]) {
    if (assigned.has(p.account_id)) continue;
    const roles = getHeroRoles(p.hero_id, heroIdMap);
    if (roles && roles[0]) assigned.set(p.account_id, roles[0]);
  }

  return assigned;
}

function teamKillsOf(match, side) {
  if (side === 'radiant') {
    return match.players.filter(p => p.player_slot < 128)
      .reduce((s, p) => s + (p.kills || 0), 0);
  }
  return match.players.filter(p => p.player_slot >= 128)
    .reduce((s, p) => s + (p.kills || 0), 0);
}

function aggregateMatchStats(matches, rosterSet, heroIdMap) {
  const newPos = () => ({ kills: 0, deaths: 0, assists: 0, games: 0, kdaSum: 0, partNum: 0, partDen: 0 });
  const result = {
    wins: 0, losses: 0,
    radWins: 0, radLosses: 0,
    direWins: 0, direLosses: 0,
    durations: [],
    ourKills: [],
    ourDeaths: [],
    pos: { 1: newPos(), 2: newPos(), 3: newPos(), 4: newPos(), 5: newPos() },
  };
  for (const m of matches) {
    const side = identifyOurSide(m, rosterSet);
    if (!side) continue;
    const our = ourPlayers(m, side);
    const didWin = (side === 'radiant') === !!m.radiant_win;
    result.wins += didWin ? 1 : 0;
    result.losses += didWin ? 0 : 1;
    if (side === 'radiant') {
      if (didWin) result.radWins++; else result.radLosses++;
    } else {
      if (didWin) result.direWins++; else result.direLosses++;
    }
    if (typeof m.duration === 'number') result.durations.push(m.duration);

    const tk = teamKillsOf(m, side);
    const gameKills = our.reduce((s, p) => s + (p.kills || 0), 0);
    const gameDeaths = our.reduce((s, p) => s + (p.deaths || 0), 0);
    result.ourKills.push(gameKills);
    result.ourDeaths.push(gameDeaths);

    // Per-player position assignment: ensures each position has at most 1
    // player-game per match.
    const positions = assignPositionsForMatch(m, side, heroIdMap);
    for (const p of our) {
      if (!p.account_id) continue;
      const pos = positions.get(p.account_id);
      if (!pos || pos < 1 || pos > 5) continue;
      const s = result.pos[pos];
      const k = p.kills || 0;
      const d = p.deaths || 0;
      const a = p.assists || 0;
      s.kills += k;
      s.deaths += d;
      s.assists += a;
      s.games += 1;
      s.kdaSum += (k + a) / Math.max(d, 1);
      s.partNum += k + a;
      s.partDen += tk || 1;
    }
  }
  return result;
}

// ==================== PLAYER AGGREGATION ====================
// Aggregate per-player stats across all matches the team played in.
// Returns Map<account_id, playerStat> where playerStat has:
//   accountId, name, mainPos, games, wins,
//   kills, deaths, assists (sums), gpm/xpm (averages),
//   heroStats: Map<heroId, { games, wins }>
// mainPos is the mode of assignPositionsForMatch() results; falls back
// to the mode of lane_role across the player's games.
function aggregatePlayerStats(matches, rosterSet, heroIdMap) {
  const result = new Map();
  for (const m of matches) {
    const side = identifyOurSide(m, rosterSet);
    if (!side) continue;
    const our = ourPlayers(m, side);
    const positions = assignPositionsForMatch(m, side, heroIdMap);
    const didWin = (side === 'radiant') === !!m.radiant_win;
    for (const p of our) {
      if (!p.account_id) continue;
      let stat = result.get(p.account_id);
      if (!stat) {
        stat = {
          accountId: p.account_id,
          name: p.personaname || p.name || ('account_' + String(p.account_id).slice(0, 8)),
          positions: [],
          laneRoles: [],
          games: 0, wins: 0,
          kills: 0, deaths: 0, assists: 0,
          gpmSum: 0, xpmSum: 0, gpmN: 0, xpmN: 0,
          heroStats: new Map(),
        };
        result.set(p.account_id, stat);
      }
      stat.games++;
      if (didWin) stat.wins++;
      stat.kills += p.kills || 0;
      stat.deaths += p.deaths || 0;
      stat.assists += p.assists || 0;
      if (typeof p.gold_per_min === 'number') { stat.gpmSum += p.gold_per_min; stat.gpmN++; }
      if (typeof p.xp_per_min === 'number') { stat.xpmSum += p.xp_per_min; stat.xpmN++; }
      const pos = positions.get(p.account_id);
      if (pos) stat.positions.push(pos);
      if (typeof p.lane_role === 'number') stat.laneRoles.push(p.lane_role);
      if (p.hero_id) {
        const bpId = heroIdMap && heroIdMap.get(p.hero_id);
        if (bpId && window.BP.getHeroById(bpId)) {
          let hs = stat.heroStats.get(bpId);
          if (!hs) { hs = { games: 0, wins: 0 }; stat.heroStats.set(bpId, hs); }
          hs.games++;
          if (didWin) hs.wins++;
        }
      }
    }
  }
  for (const stat of result.values()) {
    stat.mainPos = modeOrNull(stat.positions);
    if (!stat.mainPos) stat.mainPos = modeOrNull(stat.laneRoles);
    stat.gpm = stat.gpmN > 0 ? stat.gpmSum / stat.gpmN : 0;
    stat.xpm = stat.xpmN > 0 ? stat.xpmSum / stat.xpmN : 0;
    stat.avgKda = stat.games > 0
      ? (stat.kills + stat.assists) / Math.max(stat.deaths, stat.games)
      : 0;
  }
  return result;
}

function modeOrNull(arr) {
  if (!arr || arr.length === 0) return null;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

// ==================== WARD AGGREGATION ====================
// Only observer wards (假眼) — the user explicitly does not want sentries.
// Split by which side our team was on, so the "天辉时" and "夜魇时" warding
// patterns can be shown separately (they differ a lot in pro Dota).
// Returns { radMap, direMap, radWardsTotal, direWardsTotal } where each
// map is { "x,y": { x, y, count } } bucketed by WARD_GRID.
function aggregateWardsBySide(matches, rosterSet) {
  const radMap = {};
  const direMap = {};
  for (const m of matches) {
    const side = identifyOurSide(m, rosterSet);
    if (!side) continue;
    const target = side === 'radiant' ? radMap : direMap;
    for (const p of ourPlayers(m, side)) {
      collectWardLog(target, p.obs_log, 'obs');
    }
  }
  const radWardsTotal = Object.values(radMap).reduce((s, e) => s + e.count, 0);
  const direWardsTotal = Object.values(direMap).reduce((s, e) => s + e.count, 0);
  return { radMap, direMap, radWardsTotal, direWardsTotal };
}

function collectWardLog(map, log, kind) {
  if (!Array.isArray(log)) return;
  const span = WARD_WORLD_MAX - WARD_WORLD_MIN;
  for (const w of log) {
    // OpenDota obs_log/sen_log entries put x,y,z directly on the entry (not under
    // a `pos` sub-object). Fall back to w.pos for older endpoint shapes.
    const x = (typeof w.x === 'number') ? w.x : (w.pos && typeof w.pos.x === 'number' ? w.pos.x : null);
    const y = (typeof w.y === 'number') ? w.y : (w.pos && typeof w.pos.y === 'number' ? w.pos.y : null);
    if (x === null || y === null) continue;
    if (x < WARD_WORLD_MIN || x > WARD_WORLD_MAX || y < WARD_WORLD_MIN || y > WARD_WORLD_MAX) continue;
    // Normalize to 0-127 minimap grid, then bucket
    const nx = ((x - WARD_WORLD_MIN) / span) * 127;
    const ny = ((y - WARD_WORLD_MIN) / span) * 127;
    const key = bucketKey(nx, ny);
    if (!map[key]) map[key] = { x: bucketCenter(nx), y: bucketCenter(ny), count: 0 };
    map[key][kind]++;
    map[key].count++;
  }
}

function bucketKey(x, y) {
  const bx = Math.floor(x / WARD_GRID);
  const by = Math.floor(y / WARD_GRID);
  return bx + ',' + by;
}

function bucketCenter(x) {
  return Math.floor(x / WARD_GRID) * WARD_GRID + WARD_GRID / 2;
}

// ==================== RENDER ====================
const POSITION_LABELS = { 1: '1号位 大哥', 2: '2号位 中单', 3: '3号位 劣单', 4: '4号位 游走', 5: '5号位 酱油' };

function fmtDuration(sec) {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const POSITION_LABELS_FULL = {
  1: '1号位 · 大哥',
  2: '2号位 · 中单',
  3: '3号位 · 劣单',
  4: '4号位 · 游走',
  5: '5号位 · 酱油',
};

function renderPositionSection(playerStat, pos) {
  if (!playerStat) {
    return `<div class="team-players-section" data-position="${pos}">
      <div class="team-players-section-header">${POSITION_LABELS_FULL[pos]}</div>
      <div class="team-player-empty">该位置无数据</div>
    </div>`;
  }
  const winRate = playerStat.games > 0
    ? ((playerStat.wins / playerStat.games) * 100).toFixed(0)
    : '—';
  const heroChips = Array.from(playerStat.heroStats.entries())
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 5)
    .map(([heroId, hs]) => {
      const name = window.BP.getHeroName(heroId) || heroId;
      const wr = hs.games > 0 ? ((hs.wins / hs.games) * 100).toFixed(0) : '—';
      const cls = hs.games > 0 && (hs.wins / hs.games) >= 0.5 ? 'positive' : 'negative';
      return `<div class="team-player-hero-chip ${cls}">
        <span class="team-player-hero-name">${escapeHtml(name)}</span>
        <span class="team-player-hero-stats">${hs.games}场 ${wr}%</span>
      </div>`;
    }).join('');

  const targets = Array.from(playerStat.heroStats.entries())
    .map(([heroId, hs]) => ({ heroId, count: hs.games }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const counters = recommendUnifiedCounters(targets, 6);
  const counterChips = counters.map(c => {
    const wr = c.totalScore.toFixed(1);
    return `<div class="team-player-counter-chip">
      <span class="team-player-counter-name">${escapeHtml(c.heroName)}</span>
      <span class="team-player-counter-score">${wr}</span>
    </div>`;
  }).join('');

  return `<div class="team-players-section" data-position="${pos}">
    <div class="team-players-section-header">${POSITION_LABELS_FULL[pos]}</div>
    <div class="team-player-header">
      <span class="team-player-name">${escapeHtml(playerStat.name)}</span>
      <span class="team-player-stats">
        <span>${playerStat.games}场</span>
        <span>胜率 ${winRate}%</span>
        <span>KDA ${playerStat.avgKda.toFixed(2)}</span>
        <span>GPM ${playerStat.gpm.toFixed(0)}</span>
        <span>XPM ${playerStat.xpm.toFixed(0)}</span>
      </span>
    </div>
    <div class="team-player-heroes">${heroChips || '<div class="team-player-empty">无招牌英雄</div>'}</div>
    <div class="team-player-counters">
      <div class="team-player-counters-label">⚔️ 克制该选手常驻英雄（按场次加权）</div>
      <div class="team-player-counter-list">${counterChips || '<div class="team-player-empty">无明显克制</div>'}</div>
    </div>
  </div>`;
}

function renderPositionSections(playerStats) {
  if (!playerStats || playerStats.size === 0) {
    return '<div class="team-players-empty">无选手数据</div>';
  }
  const html = [];
  for (const pos of [1, 2, 3, 4, 5]) {
    const candidates = Array.from(playerStats.values()).filter(s => s.mainPos === pos);
    if (candidates.length === 0) {
      html.push(renderPositionSection(null, pos));
      continue;
    }
    candidates.sort((a, b) => b.games - a.games);
    html.push(renderPositionSection(candidates[0], pos));
  }
  return html.join('');
}

function renderCounters({ unifiedTop, unifiedCounters, matchCount, teamName, matchStats, playerStats }) {
  const card = document.getElementById('teamCountersCard');
  if (!card) return;

  let html = `<div class="team-result-title">📊 战队分析 · ${escapeHtml(teamName)}</div>`;
  html += `<div class="team-result-subtitle">基于最近 ${matchCount} 场可识别比赛</div>`;

  html += renderStatsOverviewHtml(matchStats);
  html += renderPositionSections(playerStats);

  if (unifiedTop.length > 0) {
    html += `<div class="team-section-subtitle">📊 全队常驻英雄 TOP ${unifiedTop.length}</div>`;
    html += `<div class="team-unified-grid">`;
    for (const t of unifiedTop) {
      const name = window.BP.getHeroName(t.heroId) || t.heroId;
      const alias = (window.BP.getHeroById(t.heroId)?.alias || [])[0] || '';
      const positions = (window.BP.getHeroById(t.heroId)?.roles || [])
        .map(p => p + '号位')
        .join('/');
      html += `<div class="team-unified-chip">
        <div class="team-unified-chip-name">${escapeHtml(name)}</div>
        <div class="team-unified-chip-alias">${escapeHtml(alias)}</div>
        <div class="team-unified-chip-pos">${escapeHtml(positions)}</div>
        <div class="team-unified-chip-count">${t.count} 场</div>
      </div>`;
    }
    html += `</div>`;
  }

  if (unifiedCounters.length > 0) {
    html += `<div class="team-section-subtitle">⚔️ 克制推荐（按 play count 加权，越常玩权重越高）</div>`;
    html += `<div class="team-counter-grid">`;
    const totalPlays = unifiedTop.reduce((s, t) => s + t.count, 0);
    for (const c of unifiedCounters) {
      const alias = (window.BP.getHeroById(c.heroId)?.alias || [])[0] || '';
      const positions = (window.BP.getHeroById(c.heroId)?.roles || [])
        .map(p => p + '号位')
        .join('/');
      // Sum of play-counts of the team's heroes this candidate counters.
      // Reflects "how many of the team's recent games does this counter apply to".
      const coveredPlays = c.targetsCovered.reduce((s, hid) => {
        const t = unifiedTop.find(x => x.heroId === hid);
        return s + (t ? t.count : 0);
      }, 0);
      html += `<div class="team-counter-card">
        <div class="team-counter-card-name">${escapeHtml(c.heroName)}</div>
        <div class="team-counter-card-alias">${escapeHtml(alias)}</div>
        <div class="team-counter-card-pos">${escapeHtml(positions)}</div>
        <div class="team-counter-card-stats">
          <span class="team-counter-card-score">${c.totalScore.toFixed(1)}</span>
          <span class="team-counter-card-hits">覆盖 ${c.hits}/10 英雄 · ${coveredPlays} 场</span>
        </div>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="team-counter-empty">无明显克制组合</div>`;
  }

  card.innerHTML = html;
}

function renderStatsOverviewHtml(s) {
  if (!s || (s.wins + s.losses === 0)) return '';
  const total = s.wins + s.losses;
  const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(0) : '—';
  const radTotal = s.radWins + s.radLosses;
  const direTotal = s.direWins + s.direLosses;
  const radRate = radTotal > 0 ? ((s.radWins / radTotal) * 100).toFixed(0) : '—';
  const direRate = direTotal > 0 ? ((s.direWins / direTotal) * 100).toFixed(0) : '—';

  const durations = s.durations || [];
  const avgDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const minDur = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDur = durations.length > 0 ? Math.max(...durations) : 0;

  const avgKills = s.ourKills.length > 0 ? (s.ourKills.reduce((a, b) => a + b, 0) / s.ourKills.length) : 0;
  const avgDeaths = s.ourDeaths.length > 0 ? (s.ourDeaths.reduce((a, b) => a + b, 0) / s.ourDeaths.length) : 0;
  // Kills per minute = our kills per game / avg game duration minutes
  const kpm = avgDur > 0 ? (avgKills / (avgDur / 60)) : 0;

  const items = [
    { label: '战绩', value: `${s.wins}胜 ${s.losses}负`, sub: `胜率 ${winRate}%` },
    { label: '天辉', value: `${s.radWins}胜 ${s.radLosses}负`, sub: radTotal > 0 ? `胜率 ${radRate}%` : '—' },
    { label: '夜魇', value: `${s.direWins}胜 ${s.direLosses}负`, sub: direTotal > 0 ? `胜率 ${direRate}%` : '—' },
    { label: '平均时长', value: fmtDuration(avgDur), sub: `短 ${fmtDuration(minDur)} / 长 ${fmtDuration(maxDur)}` },
    { label: '场均击杀', value: avgKills.toFixed(1), sub: `死亡 ${avgDeaths.toFixed(1)}` },
    { label: '每分钟人头', value: kpm.toFixed(2), sub: `本队 ${avgKills.toFixed(1)} ÷ ${fmtDuration(avgDur)}` },
  ];

  return `
    <div class="team-section-subtitle">📈 比赛数据概览</div>
    <div class="team-stats-grid">
      ${items.map(it => `
        <div class="team-stat-tile">
          <div class="team-stat-label">${escapeHtml(it.label)}</div>
          <div class="team-stat-value">${escapeHtml(it.value)}</div>
          <div class="team-stat-sub">${escapeHtml(it.sub)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPosKdaTableHtml(s) {
  if (!s || !s.pos) return '';
  const rows = [1, 2, 3, 4, 5].map(pos => {
    const p = s.pos[pos];
    if (!p || p.games === 0) {
      return `<tr>
        <td class="team-pos-tbl-pos">${POSITION_LABELS[pos]}</td>
        <td colspan="3" class="team-pos-tbl-empty">无数据</td>
      </tr>`;
    }
    const avgKda = (p.kdaSum / p.games).toFixed(2);
    const avgKills = (p.kills / p.games).toFixed(1);
    const avgDeaths = (p.deaths / p.games).toFixed(1);
    const avgAssists = (p.assists / p.games).toFixed(1);
    const participation = p.partDen > 0 ? ((p.partNum / p.partDen) * 100).toFixed(0) : '—';
    return `<tr>
      <td class="team-pos-tbl-pos">${POSITION_LABELS[pos]}</td>
      <td class="team-pos-tbl-games">${p.games} 场</td>
      <td class="team-pos-tbl-kda">${avgKda} <span class="team-pos-tbl-kda-sub">(${avgKills}/${avgDeaths}/${avgAssists})</span></td>
      <td class="team-pos-tbl-part">${participation}%</td>
    </tr>`;
  }).join('');

  return `
    <div class="team-section-subtitle">🎯 位置表现（KDA / 参战率）</div>
    <table class="team-pos-tbl">
      <thead>
        <tr>
          <th>位置</th>
          <th>场次</th>
          <th>平均 KDA</th>
          <th>参战率</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderWardHeatmaps({ radMap, direMap, radWardsTotal, direWardsTotal }) {
  // Update side counts
  const radCountEl = document.getElementById('teamWardmapRadCount');
  const direCountEl = document.getElementById('teamWardmapDireCount');
  if (radCountEl) radCountEl.textContent = `${radWardsTotal} 个`;
  if (direCountEl) direCountEl.textContent = `${direWardsTotal} 个`;

  // Render each side's map
  const sides = document.querySelectorAll('.team-wardmap-wrap');
  sides.forEach(wrap => {
    const side = wrap.dataset.side;
    const map = side === 'radiant' ? radMap : direMap;
    const canvas = wrap.querySelector('canvas');
    if (!canvas) return;
    drawWardmapOnto(wrap, canvas, map);
  });
}

function drawWardmapOnto(wrap, canvas, map) {
  const entries = Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, WARD_TOP_N);
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0) || 1;

  const rect = wrap.getBoundingClientRect();
  const cssW = Math.max(rect.width, 200);
  // Image is 8878x8356 = ~1.0625:1 (slightly wider than tall). Use the same
  // aspect ratio so dots land exactly on the map content, not on any
  // letterbox/cropped black bars.
  const cssH = cssW * (8356 / 8878);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (entries.length === 0) return;

  // The user's map image is 1.06:1 but the playable map area is 1:1 centered
  // horizontally — there are ~3% black bars on each side. OpenDota's minimap
  // coords are 0-128, but to keep dots within the actual map content (not
  // the black bars), we map x into the inner 0.03-0.97 range.
  // Y is unconstrained because the image height == map height.
  const X_MIN = 0.03, X_MAX = 0.97;
  const Y_MIN = 0.00, Y_MAX = 1.00;

  for (const e of entries) {
    const px = (X_MIN + (e.x / 128) * (X_MAX - X_MIN)) * cssW;
    const py = (Y_MIN + (e.y / 128) * (Y_MAX - Y_MIN)) * cssH;
    const r = 3 + Math.min(12, e.count * 1.0);
    const alpha = 0.30 + 0.55 * (e.count / max);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`;
    ctx.fill();
  }
}

window.initTeam = initTeam;
window.Team = Team;

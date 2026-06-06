# 战队分析 · 选手面板 + 眼位图修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有战队分析的"位置表现表格"替换为按 1-5 位置组织的选手 section（每位选手含招牌英雄、胜率、KDA、克推），并修复眼位热力图坐标错误。

**Architecture:** 纯增量改动 `scripts/team.js` + `style.css`。复用 `identifyOurSide`、`ourPlayers`、`assignPositionsForMatch`、`recommendUnifiedCounters` 等现有函数。新增 `aggregatePlayerStats` 聚合 + `renderPositionSection(s)` 渲染。眼位图修复：先实测 OpenDota 真实坐标范围，再改常量。

**Tech Stack:** 原生 JS（无框架），Playwright 浏览器测试，OpenDota REST API，HTML5 Canvas。

---

## 文件改动清单

| 文件 | 改动类型 | 责任 |
|------|----------|------|
| `scripts/team.js` | 修改 | 新增聚合+渲染函数；替换 1 个调用；修正眼位图常量 |
| `style.css` | 修改 | 新增选手卡片样式（不修改任何现有选择器）|
| `test_team.js` | 新建 | Playwright 端到端测试（参考 test_bp.js 风格）|
| `index.html` | **不修改** | 选手卡片 HTML 由 team.js 注入 |
| `bp_agent.js` / `bp.js` / `quiz.js` / `app.js` / `questions.json` / `heroes_knowledge.json` | **不修改** | 用户明确要求 |

---

## Task 1: 探测 OpenDota 真实 obs_log 坐标范围

**Files:**
- Create: `/tmp/probe_wards.js`（临时探测脚本，不入仓）

- [ ] **Step 1: 编写探测脚本**

写一个临时 Node 脚本 `probe_wards.js`，调用 OpenDota `/api/teams/{id}/matches` 拉一支战队的最近 1 场比赛，再调 `/api/matches/{match_id}` 取 `players[].obs_log`，打印出首个 ward 的原始 `x, y` 和所有 ward 的 min/max。

```javascript
// /tmp/probe_wards.js
const TEAM_ID = 15; // LGD, 一支公开数据丰富的战队
const fetchJson = (url) => fetch(url).then(r => r.json());

(async () => {
  const matches = await fetchJson(`https://api.opendota.com/api/teams/${TEAM_ID}/matches`);
  const matchId = matches[0].match_id;
  console.log('match_id:', matchId);
  const m = await fetchJson(`https://api.opendota.com/api/matches/${matchId}`);
  const wards = [];
  for (const p of m.players || []) {
    for (const w of (p.obs_log || [])) {
      const x = (typeof w.x === 'number') ? w.x : (w.pos && w.pos.x);
      const y = (typeof w.y === 'number') ? w.y : (w.pos && w.pos.y);
      if (typeof x === 'number' && typeof y === 'number') wards.push({ x, y });
    }
  }
  console.log('total wards:', wards.length);
  if (wards.length === 0) {
    console.log('NO WARDS FOUND');
    return;
  }
  const xs = wards.map(w => w.x);
  const ys = wards.map(w => w.y);
  console.log('x range:', Math.min(...xs), '~', Math.max(...xs));
  console.log('y range:', Math.min(...ys), '~', Math.max(...ys));
  console.log('first 3 wards:', wards.slice(0, 3));
})();
```

- [ ] **Step 2: 运行探测脚本**

Run: `cd /tmp && node probe_wards.js`
Expected: 输出 x/y 范围。常见可能：
- `x range: -8192 ~ 8192`（Dota2 世界坐标，原 64-192 完全错）
- `x range: 64 ~ 192`（如果是 normalized，原值就对）
- 其它范围（视 OpenDota 实际格式）

- [ ] **Step 3: 把结果写到 plan 任务备注里**

把脚本输出的 x/y 范围记下来，Task 9 修正常量时要直接用上。

---

## Task 2: 写失败的 Playwright 端到端测试

**Files:**
- Create: `/Users/nzm/Desktop/nzmdota2project_v2/test_team.js`

- [ ] **Step 1: 写测试文件**

```javascript
// test_team.js
// End-to-end test for the new player panel feature.
// 1. Loads team tab
// 2. Selects a curated team (LGD)
// 3. Cicks "开始分析"
// 4. Waits for results
// 5. Asserts the 5 player sections are present, in position order,
//    each with name + hero chips + counter chips.

const { chromium } = require('playwright');

const TIMEOUT = 90000;  // 20 matches * ~3s/each + roster + buffer

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[ERROR] ${e.message}`));

  await page.goto('http://localhost:8765/#replay', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#teamChips .team-chip:not([disabled])', { timeout: 10000 });

  console.log('--- click LGD chip ---');
  await page.click('#teamChips .team-chip[data-team-id="15"]');
  await page.waitForTimeout(300);

  console.log('--- click analyze button ---');
  await page.click('#teamAnalyzeBtn');

  console.log('--- waiting for results (up to 90s) ---');
  await page.waitForSelector('.team-players-section', { timeout: TIMEOUT });

  // Assert 5 sections, in order 1..5
  const sectionPositions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.team-players-section'))
      .map(s => s.dataset.position);
  });
  console.log('section positions:', sectionPositions);
  if (sectionPositions.length !== 5) {
    throw new Error(`Expected 5 sections, got ${sectionPositions.length}`);
  }
  if (sectionPositions.join(',') !== '1,2,3,4,5') {
    throw new Error(`Sections not in order: ${sectionPositions.join(',')}`);
  }

  // Assert each section has a player header + at least one hero chip
  for (let i = 1; i <= 5; i++) {
    const sel = `.team-players-section[data-position="${i}"]`;
    const hasName = await page.locator(`${sel} .team-player-name`).count();
    const hasHeroChip = await page.locator(`${sel} .team-player-hero-chip`).count();
    const hasCounter = await page.locator(`${sel} .team-player-counter-chip`).count();
    console.log(`pos ${i}: name=${hasName} heroes=${hasHeroChip} counters=${hasCounter}`);
    if (hasName < 1) throw new Error(`pos ${i} missing player name`);
    if (hasHeroChip < 1) throw new Error(`pos ${i} missing hero chips`);
    if (hasCounter < 1) throw new Error(`pos ${i} missing counter chips`);
  }

  // Assert the old position table is gone
  const oldTableCount = await page.locator('.team-pos-tbl').count();
  console.log('old position table count (should be 0):', oldTableCount);
  if (oldTableCount !== 0) throw new Error('Old position table still rendered');

  console.log('--- last 20 console logs ---');
  logs.slice(-20).forEach(l => console.log(' ', l));

  console.log('TEST PASSED');
  await browser.close();
})().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: 启动本地服务器**

在另一个终端：
Run: `cd /Users/nzm/Desktop/nzmdota2project_v2 && npx http-server -p 8765 --cors -c-1`
Expected: 服务启动，监听 8765

- [ ] **Step 3: 运行测试，预期失败**

Run: `cd /Users/nzm/Desktop/nzmdota2project_v2 && node test_team.js`
Expected: 失败，因为 `.team-players-section` 元素还不存在。

---

## Task 3: 实现 `aggregatePlayerStats`

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/scripts/team.js:684-737` 之后插入新函数

- [ ] **Step 1: 找到插入点**

定位到 `aggregateMatchStats` 函数结束的位置（line 737，`return result;` 之后），新函数插入在它后面。

- [ ] **Step 2: 添加 `aggregatePlayerStats` 函数**

在 `aggregateMatchStats` 之后插入：

```javascript
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
  // Compute mainPos + averages
  for (const stat of result.values()) {
    stat.mainPos = modeOrNull(stat.positions);
    if (!stat.mainPos) stat.mainPos = modeOrNull(stat.laneRoles);
    stat.gpm = stat.gpmN > 0 ? stat.gpmSum / stat.gpmN : 0;
    stat.xpm = stat.xpmN > 0 ? stat.xpmSum / stat.xpmN : 0;
    stat.avgKda = stat.games > 0
      ? (stat.kills + stat.assists) / Math.max(stat.deaths, stat.games)  // ≈ KDA per game, deaths floored
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
```

- [ ] **Step 3: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add scripts/team.js
git commit -m "feat(team): 添加 aggregatePlayerStats 函数"
```

---

## Task 4: 实现 `renderPositionSection` 和 `renderPositionSections`

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/scripts/team.js`（在 `renderPosKdaTableHtml` 之前）

- [ ] **Step 1: 添加 `renderPositionSection`**

在 `renderPosKdaTableHtml` 函数之前插入：

```javascript
// ==================== PLAYER CARD RENDERING ====================
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
      const cls = hs.wins / Math.max(hs.games, 1) >= 0.5 ? 'positive' : 'negative';
      return `<div class="team-player-hero-chip ${cls}">
        <span class="team-player-hero-name">${escapeHtml(name)}</span>
        <span class="team-player-hero-stats">${hs.games}场 ${wr}%</span>
      </div>`;
    }).join('');

  // Counter recommendations: pass player's heroStats as targets
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
  // Group players by mainPos, in order 1..5
  const html = [];
  for (const pos of [1, 2, 3, 4, 5]) {
    // Find the player with mainPos === pos and most games
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
```

- [ ] **Step 2: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add scripts/team.js
git commit -m "feat(team): 添加选手位置 section 渲染函数"
```

---

## Task 5: 在 renderCounters 中替换旧表格

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/scripts/team.js:801-861`（`renderCounters` 函数）

- [ ] **Step 1: 找到 `renderCounters` 中的旧调用**

定位到 `renderCounters({...})` 函数（约 line 801），找到这一行：
```javascript
html += renderPosKdaTableHtml(matchStats);
```

- [ ] **Step 2: 替换为新调用**

把那一行替换为：
```javascript
html += renderPositionSections(playerStats);
```

- [ ] **Step 3: 修改 `renderCounters` 函数签名，新增 `playerStats` 参数**

把函数签名从
```javascript
function renderCounters({ unifiedTop, unifiedCounters, matchCount, teamName, matchStats }) {
```
改为
```javascript
function renderCounters({ unifiedTop, unifiedCounters, matchCount, teamName, matchStats, playerStats }) {
```

- [ ] **Step 4: 在 `startAnalysis` step 4 中传入 `playerStats`**

定位到 `startAnalysis` 中 step 4 段（约 line 336-349）。在 `aggregateMatchStats` 调用后，添加：

```javascript
const playerStats = aggregatePlayerStats(usable, Team._rosterSet, heroIdMap);
```

并修改 `renderCounters({...})` 调用，把 `playerStats` 加入参数对象：

```javascript
renderCounters({
  unifiedTop,
  unifiedCounters,
  matchCount: usable.length,
  teamName,
  matchStats,
  playerStats,
});
```

- [ ] **Step 5: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add scripts/team.js
git commit -m "feat(team): 替换位置表现表格为选手 section"
```

---

## Task 6: 添加 CSS 样式

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/style.css`（在文件末尾追加新样式块）

- [ ] **Step 1: 追加选手卡片样式**

在 style.css 文件末尾添加（**不修改任何现有选择器**）：

```css
/* ==================== TEAM PLAYER SECTIONS ==================== */
.team-players-section {
  background: rgba(15, 18, 30, 0.6);
  border: 1px solid rgba(240, 165, 0, 0.15);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.team-players-section-header {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-gold, #f0a500);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}

.team-player-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.team-player-name {
  font-size: 18px;
  font-weight: 700;
  color: #e8e8e8;
}

.team-player-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: #a0a8b8;
}

.team-player-stats span {
  white-space: nowrap;
}

.team-player-heroes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.team-player-hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(30, 35, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  font-size: 13px;
}

.team-player-hero-chip.positive {
  border-color: rgba(0, 212, 170, 0.4);
}

.team-player-hero-chip.negative {
  border-color: rgba(255, 71, 87, 0.4);
}

.team-player-hero-name {
  color: #e8e8e8;
  font-weight: 500;
}

.team-player-hero-stats {
  color: #a0a8b8;
  font-size: 12px;
}

.team-player-counters {
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  padding-top: 12px;
}

.team-player-counters-label {
  font-size: 13px;
  color: #a0a8b8;
  margin-bottom: 8px;
}

.team-player-counter-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.team-player-counter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(233, 69, 96, 0.12);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 8px;
  font-size: 13px;
}

.team-player-counter-name {
  color: #e8e8e8;
  font-weight: 500;
}

.team-player-counter-score {
  color: var(--accent-red, #e94560);
  font-weight: 600;
}

.team-player-empty,
.team-players-empty {
  color: #6a7080;
  font-size: 13px;
  font-style: italic;
  padding: 8px 0;
}

/* Mobile */
@media (max-width: 768px) {
  .team-player-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .team-player-stats {
    gap: 8px;
  }
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add style.css
git commit -m "style(team): 添加选手位置 section 样式"
```

---

## Task 7: 跑端到端测试验证

**Files:**
- Read: `/Users/nzm/Desktop/nzmdota2project_v2/test_team.js`

- [ ] **Step 1: 确认本地服务器还在跑**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/`
Expected: 200（或 304）。如不是 200，重新启动 `npx http-server -p 8765 --cors -c-1`

- [ ] **Step 2: 跑测试**

Run: `cd /Users/nzm/Desktop/nzmdota2project_v2 && node test_team.js`
Expected: 看到 "section positions: 1,2,3,4,5" + "TEST PASSED"

- [ ] **Step 3: 如果失败，定位修复**

如果某个 section 显示 "无招牌英雄" 或 "无明显克制"，检查：
- 该选手在 20 场里是否真的用过英雄
- counter_matrix.csv 是否覆盖该英雄
- 浏览器 console 是否有报错

修复后重新跑测试直到通过。

- [ ] **Step 4: 提交测试文件**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add test_team.js
git commit -m "test(team): 添加选手面板端到端测试"
```

---

## Task 8: 眼位图坐标修正（基于 Task 1 实测）

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/scripts/team.js:28-31`（常量定义）

- [ ] **Step 1: 读取 Task 1 探测的真实范围**

从 Task 1 步骤 3 的结果中读取 x/y 实际范围。

- [ ] **Step 2: 更新常量**

把脚本开头的：
```javascript
// OpenDota's obs_log / sen_log use Dota 2 world coordinates (roughly 64-192 in both
// axes for the standard map). Map them to a normalized 0-1 range for canvas drawing.
const WARD_WORLD_MIN = 64;
const WARD_WORLD_MAX = 192;
```

替换为实际值（示例，**按 Task 1 实际结果填**）：
```javascript
// OpenDota's obs_log / sen_log use Dota 2 world coordinates (实测范围: X_MIN ~ X_MAX)。
// Map them to a normalized 0-1 range for canvas drawing.
const WARD_WORLD_MIN = <实际值>;
const WARD_WORLD_MAX = <实际值>;
```

- [ ] **Step 3: 检查并调整 `X_MIN` / `X_MAX`**

定位到 `drawWardmapOnto` 函数（约 line 988-991）：
```javascript
const X_MIN = 0.03, X_MAX = 0.97;
const Y_MIN = 0.00, Y_MAX = 1.00;
```

如果实测的眼位仍有少数偏出底图，**微调**这两个值（X_MIN 增大 / X_MAX 减小）。如果完全对得上，不动。

- [ ] **Step 4: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add scripts/team.js
git commit -m "fix(team): 修正眼位图坐标范围常量"
```

---

## Task 9: 视觉验证眼位图

**Files:**
- Read: `/Users/nzm/Desktop/nzmdota2project_v2/scripts/team.js`

- [ ] **Step 1: 浏览器手测**

打开浏览器访问 `http://localhost:8765/#replay`，选一支战队跑分析。

- [ ] **Step 2: 检查眼位热力图**

向下滚动到"🗺️ 高频眼位热力图"区域，确认：
- 蓝点都在底图（dota_map_7.40.jpg）范围内
- 蓝点大小合理（高频点大、低频点小）
- 天辉方 / 夜魇方两个图都正常

- [ ] **Step 3: 修复任何异常**

如果蓝点仍然偏出，回头调整 `X_MIN` / `X_MAX` 或 `WARD_WORLD_MIN/MAX`。

---

## Task 10: 回归测试

**Files:**
- Read: `/Users/nzm/Desktop/nzmdota2project_v2/test_bp.js`

- [ ] **Step 1: 跑 BP 测试**

Run: `cd /Users/nzm/Desktop/nzmdota2project_v2 && node test_bp.js`
Expected: 完成 BP 流程，无报错（保证新代码没破坏 BP 模块）

- [ ] **Step 2: 浏览器手测 BP + 答题模块**

浏览器访问：
- `http://localhost:8765/#bp` - 选英雄、看推荐
- `http://localhost:8765/#quiz` - 答题流程

Expected: 两个模块都正常工作。

---

## Task 11: 最终提交与文档同步

**Files:**
- Modify: `/Users/nzm/Desktop/nzmdota2project_v2/CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md**

在「文件变更记录」表格中添加新行：
```
| 2026-06-06 | scripts/team.js | 选手个人数据面板 + 眼位图修复 |
| 2026-06-06 | style.css | 选手卡片样式 |
| 2026-06-06 | test_team.js | 端到端测试 |
```

- [ ] **Step 2: 提交**

```bash
cd /Users/nzm/Desktop/nzmdota2project_v2
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md 记录本次改进"
```

- [ ] **Step 3: 查看 git log 确认**

Run: `git log --oneline -15`
Expected: 看到本次的若干 commit（选手聚合函数、渲染、替换、样式、测试、眼位修复、文档）。

---

## 风险与回退

| 风险 | 缓解 / 回退 |
|------|-------------|
| OpenDota 限流（429）导致端到端测试失败 | 重试 1-2 次；改用其他已收录的战队 |
| 推荐克制英雄数量为 0 | 显示 "无明显克制" 占位 |
| 选手 0 场 | section 显示 "该位置无数据" |
| 眼位坐标修正后仍偏 | 微调 X_MIN/X_MAX；最坏情况 `git revert` 还原 |
| 推荐函数本身有 bug | `recommendUnifiedCounters` 不在本计划改动范围内；如有问题转交单独 plan |

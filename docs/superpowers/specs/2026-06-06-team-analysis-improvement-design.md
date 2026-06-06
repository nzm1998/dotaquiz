# 战队分析 · 选手面板 + 眼位图修复 设计

日期：2026-06-06
范围：仅修改 `scripts/team.js`、`style.css`。不修改 BP / quiz / 其他模块任何文件。

## 背景

现有战队分析功能（`scripts/team.js`）已实现：精选战队选择、20 场比赛拉取、战绩概览、位置 KDA 表格、全队常驻英雄 TOP10、克制推荐、假眼热力图（天辉/夜魇双图）。

两个待改进点：
1. **选手维度信息缺失**：当前只按位置聚合 KDA，看不到每位选手的招牌英雄和总胜率
2. **眼位图坐标错误**：大量眼位点绘制在底图外，说明 `WARD_WORLD_MIN/MAX` 数值不对

## 目标

### 目标 1：5 个选手按位置展示 + 克制推荐

将现有的「位置表现表格」（`renderPosKdaTableHtml`）替换为 5 个**位置 section**（按 1→2→3→4→5 顺序），每个 section 展示该位置的：
- 选手基本信息（账号/名称）
- 该选手战绩（场数、总胜率、平均 KDA）
- 该选手招牌英雄 TOP 5（场次 + 该英雄胜率）
- 针对该选手常驻英雄池的**克制推荐**（使用频率加权）

### 目标 2：眼位热力图坐标修正

修正 `WARD_WORLD_MIN/MAX` 常量，使眼位点准确落在底图范围内。

## 实施细节

### 改动 1：选手聚类

新增函数 `aggregatePlayerStats(matches, rosterSet, heroIdMap)`：
- 输入：20 场已识别为战队的 matches + 战队 roster + heroIdMap
- 输出：Map<account_id, playerStat>，每个 playerStat 包含：
  ```javascript
  {
    accountId,
    name: string,                // personaname || name || account_id 前 8 位
    mainPos: 1-5 | null,        // assignPositionsForMatch 分配结果中众数
    games: number,              // 该选手在 20 场里实际登场场数
    wins: number,
    kills, deaths, assists,     // 累计
    gpm, xpm,                   // 平均
    heroStats: Map<heroId, {    // 该选手用过的英雄
      games, wins,
    }>
  }
  ```

实现要点：
- 复用 `identifyOurSide` / `ourPlayers` / `assignPositionsForMatch`
- 对每位选手的 `lane_role` 同样统计，用于 mainPos fallback
- `gpm` / `xpm` 来自 OpenDota `p.gold_per_min` / `p.xp_per_min`（无则按 0 处理）

### 改动 2：每位置 section 渲染

新增 `renderPositionSection(playerStat, pos)` — 单 section HTML：
```
┌─ 1号位 · 大哥 ────────────────────────────┐
│ [👤] Nigma.小何   18场 67%胜率  5.2 KDA  │
│ 招牌英雄：                                 │
│  [PA] 6场 83%  [TB] 4场 75%                │
│  [SPE] 3场 67% [AM] 2场 50% [PL] 2场 0%   │
│ ──────────────────────────────────────    │
│ ⚔️ 克制该选手常驻英雄（按场次加权）：        │
│  [LC] 3.0  [Axe] 2.5  [Lion] 2.0           │
│  覆盖 3/5 英雄 · 17 场适用                  │
└───────────────────────────────────────────┘
```

新增 `renderPositionSections(playerStatsMap)` — 5 个 section 按位置 1→2→3→4→5 顺序串起来。

### 改动 3：每位选手克制推荐

复用 `recommendUnifiedCounters(targets, k)`，调用方式：
```javascript
const targets = Array.from(playerStat.heroStats.entries())
  .map(([heroId, stat]) => ({ heroId, count: stat.games }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 10);
const counters = recommendUnifiedCounters(targets, 6);
```

**注意**：`recommendUnifiedCounters` 当前在 `targets.map(t => t.heroId)` 时 set 了 `targetIds`，并对 `cand` 跳过这些 target。**无需修改**该函数本体，因为它已经是「按场次加权的克制推荐」，完全匹配需求 1(c)。

### 改动 4：替换 `renderPosKdaTableHtml` 调用

在 `renderCounters()` 中：
- 删除 `html += renderPosKdaTableHtml(matchStats);`
- 改为 `html += renderPositionSections(playerStats);`
- 在 `startAnalysis()` step 4 中增加 `const playerStats = aggregatePlayerStats(usable, Team._rosterSet, heroIdMap);`
- 在 `renderCounters({ ..., playerStats })` 调用时传入

**保留** `renderPosKdaTableHtml` 函数本身不删（避免外部依赖误删），仅删除调用。

### 改动 5：CSS 新增

新增样式类（不修改任何现有选择器）：
- `.team-players-section` — 容器
- `.team-players-section-header` — 位置标题
- `.team-player-header` — 选手信息行（头像+名+战绩）
- `.team-player-heroes` — 招牌英雄列表
- `.team-player-hero-chip` — 单个英雄 chip
- `.team-player-counters` — 克制推荐区
- `.team-player-counter-chip` — 单个克制 chip

沿用现有色板（`--success` / `--error`）：
- 胜率 >= 50%：绿色
- 胜率 < 50%：红色

### 改动 6：眼位图坐标修正

**前置步骤**：在 `aggregateWardsBySide` 内，临时加一行 `console.log` 输出第一个 match 的第一个 ward 原始 `x, y` 值（仅开发期一次）。

**修正方式**：
- 读取实际数据后，修正 `WARD_WORLD_MIN/MAX` 为真实范围
- 同时重新验证 `X_MIN` / `X_MAX`（当前 0.03-0.97）是否需要调整
- 确认 `WARD_GRID`（当前 4）是否合理
- 测试一个真实战队分析，确认眼位落在底图内

预期：常量化后删除调试 log。

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `scripts/team.js` | 新增 3 个函数 + 替换 1 个调用 + 1 处常量修正 |
| `style.css` | 新增 ~50-80 行选手卡片样式 |
| `index.html` | **无改动**（HTML 由 team.js 注入到 `#teamCountersCard`）|
| 其它文件 | **无改动** |

## 边界处理

| 场景 | 行为 |
|------|------|
| 选手 0 场 | section 显示「无数据」 |
| 选手惯打位未确定 | fallback 到 `lane_role` 众数，仍未知显示「—」 |
| 招牌英雄 < 5 个 | 显示实际有的数量 |
| 克制推荐 < 1 个 | section 显示「无明显克制」 |
| OpenDota 无 `personaname` | fallback 到 `name` / `account_id` 前 8 位 |
| roster 有 6+ 人（轮换） | 每位选手一个 sub-section，按场数排序 |

## 不做的事（YAGNI）

- ❌ 不做选手间横向对比
- ❌ 不做点选手后过滤其他卡片
- ❌ 不做时间线/经济曲线
- ❌ 不做与 BP 建议的联动
- ❌ 不改现有战绩概览 / 全队常驻英雄 / 眼位热力图（眼位图本身只修坐标，不改其他逻辑）
- ❌ 不改 BP/quiz/其他模块任何代码

## 测试

### 单元测试（`test_bp.js` 风格）
- 验证 `aggregatePlayerStats` 对 0/1/多场、有人无人、位置冲突等场景
- 验证惯打位众数算法
- 验证招牌英雄排序

### 手测
- 选 1-2 支战队（CN + EU 各一）跑分析
- 检查 5 个 section 顺序正确
- 检查每 section 选手、KDA、胜率、招牌英雄、克制推荐
- 检查移动端 375px / 768px / 1280px 排版
- 跑眼位图，确认所有眼位点都在底图内

### 回归
- 原有战绩概览（胜率/时长/KPM）正常
- 全队常驻英雄 TOP10 正常
- 克制推荐（全队维度）正常
- 假眼热力图（坐标修正后）正常
- BP 模块、答题模块均不受影响

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 眼位图新坐标仍不对 | 用 console.log 取真实数据再调 |
| 选手惯打位误判（轮换） | 暴露为「主位 (次位) 」显示，不隐藏 |
| 20 场里同一选手出现 < 5 场 | 仍正常显示，胜率不折算 |
| OpenDota 字段缺失 | 全部字段都有 fallback |

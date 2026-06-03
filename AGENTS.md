# AGENTS.md - Dota2 工具站

## 项目背景

Dota2 趣味答题 + BP建议 双模块工具网站，位于 `~/Desktop/nzmdota2project_v2`。

---

## 架构说明

### 文件结构

```
nzmdota2project_v2/
├── index.html           # 主HTML入口
├── scripts/
│   ├── app.js          # 共享状态、路由、音频控制
│   ├── quiz.js         # 答题模块
│   ├── bp.js           # BP建议模块
│   └── replay.js       # 复盘模块
├── bp_agent.js         # BP算法核心（位置感知加权计算）
├── replay_agent.js     # AI 复盘分析核心（MiniMax API）
├── questions.json      # 题库
├── heroes_knowledge.json  # 英雄知识数据
├── firebase-config.js # Firebase配置
└── style.css          # 全局样式
```

### 路由设计

- `#home` - 首页
- `#quiz` - 答题模块
- `#bp` - BP建议模块
- `#replay` - 录像复盘模块

---

## 答题模块

### 难度系统

| 难度 | 说明 |
|------|------|
| 初学者 🌱 | 每轮5题，优先抽取未答题 |
| 老刀斯林 ⚔️ | 每轮5题，高难度题目比例更高 |

### 称号系统

| 正确率 | 称号 |
|--------|------|
| >= 90% | 👑 老刀斯林 |
| 80-89% | 🔥 真刀斯林 |
| 60-79% | 🛡️ 刀斯林 |
| 40-59% | 🤔 假刀斯林 |
| 20-39% | ☁️ 云玩家 |
| < 20% | 💀 云玩家本云 |

---

## BP模块

### 评分算法（统一量纲）

三个维度统一到同一量纲后相加：

| 维度 | 原始范围 | 转换方式 |
|------|----------|----------|
| 英雄平均强度 | 40-60% | `win_rate×100 - 50`，如 48%→-2 |
| 克制程度 | -20~+20 | 直接使用 |
| 配合程度 | -20~+20 | 直接使用 |

```javascript
WEIGHTS: {
  winRateDeviation: 1.0,  // 胜率偏离权重
  counter: 0.5,           // 克制权重
  synergy: 0.5,            // 配合权重
},

totalStrength = 1.0 × (win_rate×100-50) + 0.5 × totalCounterScore + 0.5 × totalSynergyScore
```

### 位置感知加权计算

```javascript
COUNTER_MULTIPLIERS: {
  1: { 3: 1.5, 4: 1.5 },
  2: { 2: 2.0 },
  3: { 5: 1.8 },
  4: { 3: 1.5 },
  5: { 1: 1.5 },
},

SYNERGY_MULTIPLIERS: {
  1: { 5: 1.8 },
  5: { 1: 1.8 },
  3: { 4: 1.8 },
  4: { 3: 1.8 },
  2: { 4: 1.5, 5: 1.5 }, // 2号位与4、5号位配合加权
},
```

### 英雄头像特殊映射

部分英雄的 Steam CDN 图片文件名与 heroId 不同，在 `scripts/bp.js` 的 `HERO_IMG_MAP` 中配置：

| 英雄 | heroId | CDN 文件名 |
|------|--------|-----------|
| 冥魂大帝 | wraith_king | skeleton_king |
| 伐木机 | timbersaw | shredder |
| 拉席克 | leshrac | dota_react/leshrac |
| 破晓辰星 | dawnbreaker | dota_react/dawnbreaker |
| 凯 | kez | dota_react/kez |
| 拉尔戈 | largo | dota_react/largo |
| 玛西 | marci | dota_react/marci |
| 琼英碧灵 | muerta | dota_react/muerta |
| 先知 | natures_prophet | dota_react/furion |
| 獸 | primal_beast | dota_react/primal_beast |
| 痛苦女王 | queen_of_pain | dota_react/qop |
| 戏命师 | ringmaster | dota_react/ringmaster |
| 孽主 | underlord | dota_react/abyssal_underlord |
| 风行者 | windranger | dota_react/windrunner |

### BP四个Tab

| Tab | 说明 |
|-----|------|
| 🟢 我方推荐 | 适合我方阵容的英雄 |
| 🔴 我方慎选 | 不适合我方阵容的英雄 |
| 🔵 敌方预测 | 敌方可能选择的英雄 |
| ⚫ 敌方规避 | 敌方可能不会选的英雄 |

### counter_matrix.csv 更新流程

`counter_matrix.csv` 是 BP 克制分的底层矩阵，更新时遵循下列规则：

- 只维护对角线左下三角，不手动填写右上三角。
- 每一行的第一个字段是当前英雄名，后续只填写它在表头中左侧那些英雄的克制值。
- 例如 `育母蜘蛛` 在表头中的位置靠近末尾，因此该行只填到 `幽鬼` 为止；右侧的 `远古冰魄`、`宙斯`、`主宰`、`卓尔游侠` 保持空白。
- 用户提供的数据通常是“当前英雄对阵全英雄克制指数，按数值高到低排序”，录入时必须重新按 CSV 表头顺序重排，不能按用户提供顺序直接粘贴。
- 英雄名必须使用 `counter_matrix.csv` 表头中的现有中文名，不自行标准化、不改别名。
- 写入前先确认：
  1. 当前英雄在表头中的列位置。
  2. 左侧英雄数量是否等于本行应填写的数值数量。
  3. 用户数据里若包含当前英雄右侧的对手英雄，这些值本轮不写入，留待对应英雄行更新。
- 写入后再校验：
  1. 该行字段数应等于“当前英雄表头位置 + 1”。
  2. 末尾不应越过对角线，不能把右侧列写进去。
  3. 抽查最后几个已填写字段，确认它们与表头对应关系正确。

当前已明确确认的例子：

- `育母蜘蛛` 行已按上述规则重写，只填写左下三角，未写入右侧的 `远古冰魄`、`宙斯`、`主宰`、`卓尔游侠`。

---

## 复盘模块

### 功能概述
输入 Dota2 比赛 ID 或上传本地 .dem 文件，AI 生成专业复盘报告（眼位分析为核心）。

### 分析维度
- 眼位分析：从 DOTA_UM_MinimapEvent 解析真实眼位坐标（type 64=Observer, type 32=Sentry）
- 阵容分析：双方阵容优劣、核心英雄表现、克制关系
- 选手行为路径：发育轨迹、走位意识、打钱效率
- 团队节奏：推进节奏、团战时机、决策质量
- 胜负因素：导致比赛结果的关键因素
- 改进建议：给两队各提供2-3条具体建议

### 技术方案
- 方案A（已上线）：比赛 ID → OpenDota API → MiniMax AI → 报告
- 方案B（已上线）：.dem 文件解析 → OpenDota API (obs_placed/sen_placed) → MiniMax AI → 眼位报告
- 方案C（未完成）：Python + clarity 解析 + Node.js API + MongoDB

### 数据流程（方案B）
```
用户上传 .dem 文件
        ↓
  server_demo_parse.mjs 解析：
  - DOTA_UM_MinimapEvent 获取眼位坐标 (type 64/32)
  - ENTITY_PACKET 获取英雄位置轨迹
  - DOTA_UM_CombatLogDataHltv 获取击杀/技能事件
        ↓
  OpenDota API 获取（补充）：
  - 阵容数据 (players, heroes)
  - KDA, gold, xp 等
        ↓
  MiniMax AI 生成分析报告
        ↓
  前端渲染报告
```

### 眼位坐标解析（突破 - 2026-05-24）

**之前错误结论**: MODIFIER_ADD 事件无法区分 ward 和 buff，无法从 demo 解析眼位坐标。

**突破**: 使用 `DOTA_UM_MinimapEvent`（type=481）可获取带坐标的眼位事件：

```javascript
parser.registerPreInterceptor(InterceptorStage.MESSAGE_PACKET, (demoPacket, messagePacket) => {
  if (messagePacket.type._code === 'DOTA_UM_MinimapEvent') {
    const data = messagePacket.data;
    // data.eventType: 64=Observer, 32=Sentry, 4=Glyph等
    // data.x, data.y: 世界坐标（无需转换）
    // data.entityHandle: 英雄实体 handle
  }
});
```

**MinimapEvent eventType 实测含义**（比赛 8820791846）:

| eventType | 事件数 | 含义 |
|-----------|--------|------|
| 4096 | 334 | 技能特效 |
| 32 | 142 | Sentry 放置 |
| 4 | 119 | Glyph/建筑相关 |
| 8192 | 116 | 弹道 |
| **64** | 74 | **Observer 放置** |

**英雄关联**: 通过 `ENTITY_PACKET` 建立 `handle → heroName` 映射：

```javascript
const entityHandleMap = new Map();
parser.registerPreInterceptor(InterceptorStage.ENTITY_PACKET, (demoPacket, messagePacket, events) => {
  for (const event of events) {
    const entity = event.entity;
    const clazz = entity._class;
    if (clazz && clazz._name?.startsWith('CDOTA_Unit_Hero_')) {
      const heroName = clazz._name.replace('CDOTA_Unit_Hero_', '');
      const handle = entity._handle || ((1 << 17) | entity._index);
      entityHandleMap.set(handle, heroName);
    }
  }
});
```

**坐标验证**:
- MinimapEvent 坐标: X [-1865, 2155], Y [-1833, 2081]（minimap 坐标系）
- 转换为世界坐标需乘以 8: worldX = minimapX * 8
- 转换后范围: X [-14920, 17240], Y [-14664, 16648]
- 与英雄轨迹世界坐标范围一致

**重要**: type 32 不纯粹是 Sentry，还包含 glyph、ability effects 等事件。应以 type 64（Observer）为准，type 32 仅参考。

**与 OpenDota API 对比**（比赛 8820791846）:
- API: Observer 66, Sentry 121
- Demo 解析: Observer 74 (type 64), type 32 事件 142 个
- type 64 与 OpenDota Observer 总数匹配（74 vs 66）

### 英雄轨迹数据（方案B扩展）
从 .dem 文件提取英雄位置数据用于战术分析：

```
Field Path (CBodyComponent):
  14|0 = m_cellX
  14|1 = m_cellY
  14|2 = m_cellZ

坐标转换（已修正）:
  worldX = (cellX - 128) * 128
  worldY = (cellY - 128) * 128
  worldZ = (cellZ - 128) * 128

实体类名:
  - 英雄单位: CDOTA_Unit_Hero_{HeroName}
  - 示例: CDOTA_Unit_Hero_Lich, CDOTA_Unit_Hero_Phoenix

Tick 转秒: Dota2 约 30 tick/秒，tick 间间隔约 0.033 秒。
```

**位置数据采样**: 通过 DEMO_PACKET 拦截器获取 `demoPacket.tick`，在 ENTITY_PACKET 拦截器中使用 `currentTick` 作为时间戳。

**位置数据局限性**: ENTITY_PACKET 只在实体状态变化时触发，70分钟比赛约产生 ~100-400 个位置点/英雄。这是 demo 压缩策略，不是解析器 bug。

**轨迹插值**: 已实现 `interpolateTrajectories()` 函数，将低频位置数据均匀插值为指定 fps 的轨迹：

```javascript
function interpolateTrajectories(positionBuffer, positionHistory, targetFps = 10) {
  // 使用均匀采样：在整个比赛时长内，每隔 1/targetFps 秒采样一次
  // 找到包含目标 tick 的两个原始点，线性插值
}
```

**实测数据**（比赛 8820791846，88分钟）：
- 原始: ~100-500 点/英雄
- 插值后（10 fps）: ~53000 点/英雄

**重要限制**: 线性插值假设英雄匀速运动，实际英雄行为包括站立、TP、Push、Retreat 等，不是匀速的。插值数据是平滑近似，不是真实帧级数据。

### 安全措施
- **API 密钥**: 统一管理在 `config/api_keys.js`
- **前端无密钥**: `replay_agent.js` 已移除，不再前端加载
- **后端处理**: 所有 API 调用（OpenDota/MiniMax）在服务器端完成

---

## 技术细节

### 英雄位置数据

`heroes_knowledge.json` 中的 `roles` 字段是用户手动配置的常见位置（1-5号位），**不要用 OpenDota 等外部数据覆盖**。

### 安全措施

- 所有 innerHTML 动态内容使用 `escapeHtml()` 转义
- 评论提交时转义用户输入

### Firestore 超时处理

- 超时时间：10 秒
- `accuracyLoadFailed` 5 分钟后自动重置
- 网络恢复后可正常重试

### Firebase 说明

- 中国大陆需要代理（端口7897）才能访问
- 答题功能不依赖 Firebase，可独立工作
- 正确率统计和评论区需要 Firebase

### 本地 Demo 文件

**路径**: `/Users/nzm/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/replays/8820791846.dem`

**用途**: 本地解析测试，用于验证轨迹插值等功能。

### 移动端适配

- 375px / 768px / 1280px 断点
- BP 模块英雄位置网格自适应

---

## 外部技能

### B站视频解析 (bilibili)

`~/.Codex/scripts/bilibili.sh`，基于 yt-dlp：

```bash
~/.Codex/scripts/bilibili.sh info "URL"        # 视频信息
~/.Codex/scripts/bilibili.sh download "URL"     # 下载视频
~/.Codex/scripts/bilibili.sh subtitle "URL"     # 下载字幕
~/.Codex/scripts/bilibili.sh search "关键词"     # 搜索
```

### 视频分析工作流

```bash
# 1. 下载 B站视频
~/.Codex/scripts/bilibili.sh download "BV号" /tmp/analysis

# 2. 提取关键帧（每5秒一帧）
ffmpeg -i video.mp4 -vf "fps=1/5" frames/frame_%03d.jpg

# 3. 提取音频 + Whisper 语音转文字
ffmpeg -i video.mp4 -vn -ar 16000 -ac 1 audio.wav
whisper audio.wav --model small --language zh --output_format txt

# 4. 帧布局分析（需要 sharp）
node -e "const sharp=require('sharp'); ..."
```

### 对标参考工具

B站 UP主 **SenSen不息** 的 Dota2 比赛分析工具（BV1rhrQBEExQ，2026-01-17）：
- 功能：眼位分析 + 英雄行动路线 + BP分析 + 对线模拟
- 相关文章：[什么值得买-第一篇](https://post.smzdm.com/p/a50qrnnk/) | [第二篇-BP](https://post.smzdm.com/p/azzgqd6p/)
- 对标状态：眼位、轨迹、热力图已完成；对线模拟未实现；UI 需确认细节
- 详见 memory: [[reference-tool-sensen]]

---

## 设计规范

### 颜色（深色电竞主题）

```css
--canvas: #0a0a12;
--accent-red: #e94560;
--accent-gold: #f0a500;
--success: #00d4aa;
--error: #ff4757;
```

### 动效

- `cubic-bezier(0.16, 1, 0.3, 1)`
- `fadeInUp` 0.5-0.6s

---

## 文件变更记录

| 日期 | 变更 |
|------|------|
| 2026-05-24 | **突破**：使用 DOTA_UM_MinimapEvent 解析眼位坐标（type 64=Observer, type 32 不纯粹是 Sentry） |
| 2026-05-24 | 修正 MinimapEvent 坐标转换：minimap坐标 * 8 = 世界坐标 |
| 2026-05-24 | 新增 `rawTrajectory` 原始低频轨迹数据（100-400点/英雄，不插值） |
| 2026-05-24 | 实测验证：88分钟比赛轨迹数据有效，插值后每英雄约53000点 |
| 2026-05-24 | 实现轨迹插值函数 `interpolateTrajectories()`（均匀采样，10fps） |
| 2026-05-24 | 修正英雄位置坐标转换公式：`(cellX-128)*128` 而非 `cellX*128` |
| 2026-05-24 | API 密钥统一管理在 config/api_keys.js，前端无密钥暴露 |
| 2026-05-23 | 新增录像复盘模块（方案A：比赛ID + OpenDota API + MiniMax AI） |
| 2026-05-23 | XSS 修复（escapeHtml） |
| 2026-05-23 | Firestore 超时优化（10s + 自动重置） |
| 2026-05-23 | Empty catch 改为 console.warn |
| 2026-05-23 | 移动端适配完善 |
| 2026-05-23 | 选项顺序固定为 ABCD |
| 2026-05-22 | 深色电竞主题重构 |
| 2026-05-22 | 位置感知加权计算 |

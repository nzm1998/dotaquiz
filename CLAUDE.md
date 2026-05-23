# CLAUDE.md - Dota2 工具站

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

### 位置感知加权计算

```javascript
WEIGHTS: {
  baseWinRate: 5,
  baseCounter: 1.0,
  baseSynergy: 1.0,
},

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
},
```

### BP四个Tab

| Tab | 说明 |
|-----|------|
| 🟢 我方推荐 | 适合我方阵容的英雄 |
| 🔴 我方慎选 | 不适合我方阵容的英雄 |
| 🔵 敌方预测 | 敌方可能选择的英雄 |
| ⚫ 敌方规避 | 敌方可能不会选的英雄 |

---

## 复盘模块

### 功能概述
输入 Dota2 比赛 ID，通过 OpenDota API 获取数据，调用 MiniMax AI 生成专业复盘报告。

### 分析维度
- 阵容分析：双方阵容优劣、核心英雄表现、克制关系
- 选手行为路径：发育轨迹、走位意识、打钱效率
- 眼位分析：（暂无数据，方案B/C支持）
- 团队节奏：推进节奏、团战时机、决策质量
- 胜负因素：导致比赛结果的关键因素
- 改进建议：给两队各提供2-3条具体建议

### 技术方案
- 方案A（已上线）：比赛 ID → OpenDota API → MiniMax AI → 报告
- 方案B（未完成）：+ 本地 .dem 文件解析（node-demparser）
- 方案C（未完成）：Python + clarity 解析 + Node.js API + MongoDB

---

## 技术细节

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

### 移动端适配

- 375px / 768px / 1280px 断点
- BP 模块英雄位置网格自适应

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
| 2026-05-23 | 新增录像复盘模块（方案A：比赛ID + OpenDota API + MiniMax AI） |
| 2026-05-23 | XSS 修复（escapeHtml） |
| 2026-05-23 | Firestore 超时优化（10s + 自动重置） |
| 2026-05-23 | Empty catch 改为 console.warn |
| 2026-05-23 | 移动端适配完善 |
| 2026-05-23 | 选项顺序固定为 ABCD |
| 2026-05-22 | 深色电竞主题重构 |
| 2026-05-22 | 位置感知加权计算 |
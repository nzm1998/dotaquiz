# CLAUDE.md - Dota2 工具站

## 项目背景

Dota2 趣味答题 + BP建议 双模块工具网站，位于 `~/Desktop/nzmdota2project_v2`。

---

## 架构说明

### 当前架构（2026-05-22 重构）

```
nzmdota2project_v2/
├── index.html           # 主HTML入口
├── scripts/
│   ├── app.js          # 共享状态、路由、音频控制
│   ├── quiz.js         # 答题模块
│   └── bp.js           # BP建议模块
├── bp_agent.js         # BP算法核心（位置感知加权计算）
├── questions.json      # 题库（20道题）
├── heroes_knowledge.json  # 英雄知识数据
├── firebase-config.js # Firebase配置
└── style.css          # 全局样式
```

### 路由设计

- `#home` - 首页
- `#quiz` - 答题模块
- `#bp` - BP建议模块

### 答题流程

1. 加载动画 → 难度选择页 → 答题页 → 单题结果页 → 最终结果页

### BP建议流程

1. 输入我方/敌方阵容（5个位置）
2. 可选：选择我的位置
3. 点击计算 → 显示4个Tab的推荐英雄

---

## 答题模块详情

### 难度系统

| 难度 | 说明 |
|------|------|
| 初学者 🌱 | 每轮5题，优先抽取未答题 |
| 老刀斯林 ⚔️ | 每轮5题，高难度题目比例更高 |

### 称号系统

| 正确率 | 称号 | 点评 |
|--------|------|------|
| >= 90% | 👑 老刀斯林 | 真正的刀塔传奇！ |
| 80-89% | 🔥 真刀斯林 | 经验丰富的老玩家！ |
| 60-79% | 🛡️ 刀斯林 | 不错的刀斯林！ |
| 40-59% | 🤔 假刀斯林 | 云玩家实锤了！ |
| 20-39% | ☁️ 云玩家 | 你真的打过刀塔吗？ |
| < 20% | 💀 云玩家本云 | 你怕不是只看过视频吧？ |

### 正确率统计

- 使用 Firebase Firestore 存储
- Collection: `question_stats` - 每题独立文档
- 字段: `correct` (答对次数), `total` (总回答次数)

### 评论区

- Firebase Firestore real-time listeners
- 每题独立 collection: `comments/{questionId}/items`
- 最多显示20条，按时间倒序

---

## BP模块详情

### 位置感知加权计算

```javascript
WEIGHTS: {
  baseWinRate: 5,        // 基础胜率 × 5
  baseCounter: 1.0,      // 克制系数
  baseSynergy: 1.0,      // 配合系数
},

COUNTER_MULTIPLIERS: {
  1: { 3: 1.5, 4: 1.5 },   // 1号位：防敌方3、4号位
  2: { 2: 2.0 },             // 中单：中单克制最重要
  3: { 5: 1.8 },             // 3号位：敌方5号位走一路
  4: { 3: 1.5 },             // 4号位：敌方3号位走一路
  5: { 1: 1.5 },             // 5号位：敌方1号位走一路
},

SYNERGY_MULTIPLIERS: {
  1: { 5: 1.8 },   // 1号位与5号位走一路
  5: { 1: 1.8 },   // 5号位与1号位走一路
  3: { 4: 1.8 },   // 3号位与4号位走一路
  4: { 3: 1.8 },   // 4号位与3号位走一路
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

## Firebase 说明

### 访问限制
- **中国大陆**：需要代理（端口7897）才能访问 Firebase Firestore
- **海外用户**：Firebase 正常访问

### 功能依赖

| 功能 | 依赖 Firebase | 其他用户能否正常使用 |
|------|--------------|---------------------|
| 题目加载 | ❌ | ✅ 都能用 |
| 答题流程 | ❌ | ✅ 都能用 |
| 正确率统计 | ✅ | ⚠️ 无数据（首次作答前） |
| 评论区 | ✅ | ⚠️ 评论加载失败 |

### Firestore 数据结构

```javascript
// question_stats collection
doc(id: "1") = { correct: 5, total: 10 }

// comments collection
doc(id: "q1") → subcollection "items"
  doc() = { text: "评论内容", author: "匿名", timestamp: serverTimestamp }
```

---

## 设计规范

### 颜色（深色电竞主题）

```css
--canvas: #0a0a12;        /* 深色背景 */
--accent-red: #e94560;     /* Dota2红 */
--accent-gold: #f0a500;   /* 金色 */
--success: #00d4aa;        /* 正确绿 */
--error: #ff4757;          /* 错误红 */
```

### 动效

- 缓动曲线: `cubic-bezier(0.16, 1, 0.3, 1)`
- 动画: `fadeInUp` 0.5-0.6s
- 悬停: `translateY(-8px) scale(1.02)` + glow shadows

---

## 文件变更记录

| 日期 | 文件 | 变更 |
|------|------|------|
| 2026-05-23 | style.css | 深色电竞主题重构 |
| 2026-05-23 | scripts/quiz.js | 加载动画 + 选项随机打乱 |
| 2026-05-23 | scripts/bp.js | 骨架屏加载 |
| 2026-05-23 | scripts/app.js | 路由初始化优化 |
| 2026-05-22 | bp_agent.js | 新增位置感知加权计算 |
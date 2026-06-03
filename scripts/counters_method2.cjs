/**
 * 方案2：基于 OpenDota 全量数据的英雄克制关系
 * 数据源：picks_bans 表（500万+条 BP 记录）
 * 计算方式：SQL 聚合，服务器端完成，浏览器直连
 */

const OPENDOTA = 'https://api.opendota.com/api';
const fs = require('fs');
const MIN_GAMES = 50; // 最低样本量
const WIN_RATE_THRESHOLD = 0.50; // 胜率超过此值视为克制

// 获取所有英雄列表
async function getAllHeroes() {
  const res = await fetch(`${OPENDOTA}/heroes`);
  return res.json();
}

// 用 SQL 直接在 OpenDota 服务器端计算某英雄的克制关系
async function getCountersForHero(heroId) {
  const sql = encodeURIComponent(`
    SELECT
      pb2.hero_id AS enemy_id,
      COUNT(*) AS games,
      SUM(CASE WHEN (pb1.team = 0 AND m.radiant_win) OR (pb1.team = 1 AND NOT m.radiant_win) THEN 1 ELSE 0 END) AS wins
    FROM picks_bans pb1
    JOIN picks_bans pb2 ON pb1.match_id = pb2.match_id AND pb1.team != pb2.team AND pb2.is_pick = true
    JOIN matches m ON pb1.match_id = m.match_id
    WHERE pb1.hero_id = ${heroId} AND pb1.is_pick = true AND pb1.match_id > 1700000000
    GROUP BY pb2.hero_id
    HAVING COUNT(*) >= ${MIN_GAMES}
    ORDER BY wins DESC
  `);
  const res = await fetch(`${OPENDOTA}/explorer?sql=${sql}`);
  return res.json();
}

// 用 SQL 直接在 OpenDota 服务器端计算某英雄的协同关系
// 协同 = 同队胜利时同时在场
async function getSynergiesForHero(heroId) {
  const sql = encodeURIComponent(`
    SELECT
      pb2.hero_id AS ally_id,
      COUNT(*) AS games,
      SUM(CASE WHEN (pb1.team = 0 AND m.radiant_win) OR (pb1.team = 1 AND NOT m.radiant_win) THEN 1 ELSE 0 END) AS wins
    FROM picks_bans pb1
    JOIN picks_bans pb2 ON pb1.match_id = pb2.match_id AND pb1.team = pb2.team AND pb1.hero_id < pb2.hero_id AND pb2.is_pick = true
    JOIN matches m ON pb1.match_id = m.match_id
    WHERE pb1.hero_id = ${heroId} AND pb1.is_pick = true AND pb1.match_id > 1700000000
    GROUP BY pb2.hero_id
    HAVING COUNT(*) >= ${MIN_GAMES}
    ORDER BY wins DESC
  `);
  const res = await fetch(`${OPENDOTA}/explorer?sql=${sql}`);
  return res.json();
}

// 计算并组装单个英雄的完整数据
async function processHero(heroId, heroName, heroNameCn, nameMap) {
  const [counterData, synergyData] = await Promise.all([
    getCountersForHero(heroId),
    getSynergiesForHero(heroId)
  ]);

  const counters = (counterData.rows || [])
    .filter(r => r.wins / r.games >= WIN_RATE_THRESHOLD)
    .map(r => ({
      hero_id: r.enemy_id,
      hero_name: nameMap[r.enemy_id] || `Hero_${r.enemy_id}`,
      win_rate: parseFloat((r.wins / r.games * 100).toFixed(1)),
      games: r.games
    }));

  const synergies = (synergyData.rows || [])
    .map(r => ({
      hero_id: r.ally_id,
      hero_name: nameMap[r.ally_id] || `Hero_${r.ally_id}`,
      win_rate: parseFloat((r.wins / r.games * 100).toFixed(1)),
      games: r.games
    }));

  return { hero_id: heroId, name: heroName, name_cn: heroNameCn, counters, synergies };
}

// 主程序
async function main() {
  console.log('正在获取英雄列表...');
  const heroes = await getAllHeroes();
  const nameMap = {};
  heroes.forEach(h => nameMap[h.id] = h.localized_name);

  // 加载中文名对照
  let heroNameCn = {};
  try {
    const hk = require('../heroes_knowledge.json');
    for (const [k, v] of Object.entries(hk.heroes)) {
      const id = k.match(/(\d+)$/)?.[1];
      if (id) heroNameCn[parseInt(id)] = v.name;
    }
  } catch (e) {
    console.log('未找到 heroes_knowledge.json，中文名留空');
  }

  const results = [];
  const total = heroes.length;

  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    const cnName = heroNameCn[h.id] || '';
    process.stdout.write(`[${i + 1}/${total}] ${h.localized_name}... `);

    try {
      const data = await processHero(h.id, h.localized_name, cnName, nameMap);
      results.push(data);
      console.log(`✓ counters:${data.counters.length} synergies:${data.synergies.length}`);
    } catch (e) {
      console.log('✗ 错误:', e.message);
      results.push({ hero_id: h.id, name: h.localized_name, name_cn: cnName, counters: [], synergies: [], error: e.message });
    }

    // 遵守 API 限速 60 req/min，每次请求间隔 1.1 秒
    if (i < heroes.length - 1) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  fs.writeFileSync('./counters_method2.json', JSON.stringify({
    generated_at: new Date().toISOString(),
    source: 'OpenDota picks_bans + matches (match_id > 1700000000)',
    min_games: MIN_GAMES,
    win_rate_threshold: WIN_RATE_THRESHOLD,
    heroes: results
  }, null, 2));

  console.log(`\n完成！数据已保存到 counters_method2.json，共 ${results.length} 个英雄`);
}

main().catch(console.error);
/**
 * 方法2：从大量比赛数据中统计英雄克制/协同关系
 * 数据来源：OpenDota API（浏览器直连，无需后端）
 */

const OPENDOTA = 'https://api.opendota.com/api';

// 获取英雄名称映射
async function getHeroNameMap() {
  const res = await fetch(`${OPENDOTA}/heroes`);
  const heroes = await res.json();
  const map = {};
  for (const h of heroes) map[h.id] = h.localized_name;
  return map;
}

// 获取队伍近 N 场比赛
async function getTeamMatches(teamId, limit = 500) {
  const res = await fetch(`${OPENDOTA}/teams/${teamId}/matches?limit=${limit}`);
  return res.json();
}

// 获取单场比赛详情（仅需 picks_bans 和 radiant_win）
async function getMatchDraft(matchId) {
  const res = await fetch(`${OPENDOTA}/matches/${matchId}?significant=0`);
  const m = await res.json();
  return {
    match_id: matchId,
    radiant_win: m.radiant_win,
    picks_bans: m.picks_bans || [],
    radiant_heroes: [],
    dire_heroes: []
  };
}

// 从 picks_bans 中提取双方阵容
function extractLineups(draft) {
  for (const pb of draft.picks_bans) {
    if (pb.is_pick) {
      if (pb.team === 0) draft.radiant_heroes.push(pb.hero_id);
      else draft.dire_heroes.push(pb.hero_id);
    }
  }
  return draft;
}

// 统计英雄协同：同时出现在胜方阵容的次数
// counter[heroA][heroB] = heroA在胜利时，heroB同时在场的次数
async function buildStats(teamId, heroNameMap) {
  console.log('正在获取队伍比赛列表...');
  const matches = await getTeamMatches(teamId);
  console.log(`获取到 ${matches.length} 场比赛，开始拉取 BP 数据...`);

  const stats = {
    total_matches: 0,
    hero_games: {},      // heroId -> 出场次数
    hero_wins: {},       // heroId -> 胜利次数
    hero_with: {},       // heroId -> { allyId -> 协同胜利次数 }
    hero_vs: {},         // heroId -> { enemyId -> 对阵胜利次数 }
    radiant_picks: {},   // heroId -> Radiant方出场次数
    dire_picks: {}       // heroId -> Dire方出场次数
  };

  let done = 0;
  for (const m of matches) {
    try {
      const draft = await getMatchDraft(m.match_id);
      extractLineups(draft);

      if (draft.radiant_heroes.length === 0 || draft.dire_heroes.length === 0) {
        done++;
        continue;
      }

      stats.total_matches++;
      const winners = draft.radiant_win ? 'radiant' : 'dire';
      const winningHeroes = winners === 'radiant' ? draft.radiant_heroes : draft.dire_heroes;
      const losingHeroes = winners === 'radiant' ? draft.dire_heroes : draft.radiant_heroes;

      // 统计每个英雄的出场和胜负
      for (const hid of [...draft.radiant_heroes, ...draft.dire_heroes]) {
        if (!stats.hero_games[hid]) {
          stats.hero_games[hid] = 0;
          stats.hero_wins[hid] = 0;
          stats.hero_with[hid] = {};
          stats.hero_vs[hid] = {};
          stats.radiant_picks[hid] = 0;
          stats.dire_picks[hid] = 0;
        }
        stats.hero_games[hid]++;
        if (hid < 200) stats.radiant_picks[hid]++;
        else stats.dire_picks[hid]++;

        if (winningHeroes.includes(hid)) {
          stats.hero_wins[hid]++;
        }
      }

      // 协同胜利：胜利方英雄两两组合
      for (const a of winningHeroes) {
        for (const b of winningHeroes) {
          if (a !== b) {
            if (!stats.hero_with[a]) stats.hero_with[a] = {};
            stats.hero_with[a][b] = (stats.hero_with[a][b] || 0) + 1;
          }
        }
      }

      // 对阵胜利：胜利方英雄对失利方英雄
      for (const a of winningHeroes) {
        for (const b of losingHeroes) {
          if (!stats.hero_vs[a]) stats.hero_vs[a] = {};
          stats.hero_vs[a][b] = (stats.hero_vs[a][b] || 0) + 1;
        }
      }

      done++;
      if (done % 50 === 0) console.log(`已处理 ${done}/${matches.length} 场比赛...`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      done++;
      continue;
    }
  }

  return stats;
}

// 计算某英雄的克制英雄列表（胜率 > 50% 时为克制）
function getCounters(heroId, stats) {
  const games = stats.hero_games[heroId] || 0;
  if (games === 0) return [];

  const vs = stats.hero_vs[heroId] || {};
  const counters = [];
  for (const [enemyId, wins] of Object.entries(vs)) {
    const total = stats.hero_games[parseInt(enemyId)] || 0;
    if (total < 20) continue; // 样本太少跳过
    const winRate = wins / total;
    if (winRate > 0.50) {
      counters.push({ hero_id: parseInt(enemyId), win_rate: winRate, games: total });
    }
  }
  counters.sort((a, b) => b.win_rate - a.win_rate);
  return counters;
}

// 计算某英雄的协同英雄列表
function getSynergies(heroId, stats) {
  const games = stats.hero_wins[heroId] || 0;
  if (games === 0) return [];

  const withMap = stats.hero_with[heroId] || {};
  const synergies = [];
  for (const [allyId, wins] of Object.entries(withMap)) {
    const total = stats.hero_games[parseInt(allyId)] || 0;
    if (total < 20) continue;
    const synergyRate = wins / games; // 该英雄胜利时，ally 同时在场的比例
    if (synergyRate > 0.3) { // 超过 30% 的胜利局都有此队友
      synergies.push({ hero_id: parseInt(allyId), synergy_rate: synergyRate, games });
    }
  }
  synergies.sort((a, b) => b.synergy_rate - a.synergy_rate);
  return synergies;
}

// 主程序
async function main(teamName, teamId) {
  const heroNameMap = await getHeroNameMap();
  console.log(`加载了 ${Object.keys(heroNameMap).length} 个英雄`);

  const stats = await buildStats(teamId, heroNameMap);
  console.log(`\n统计完成！总计 ${stats.total_matches} 场有效比赛`);

  // 输出几个英雄的克制和协同关系作为示例
  const sampleHeroes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  console.log('\n=== 示例：前10个英雄的克制/协同关系 ===');
  for (const hid of sampleHeroes) {
    const name = heroNameMap[hid] || `Hero_${hid}`;
    const games = stats.hero_games[hid] || 0;
    const wins = stats.hero_wins[hid] || 0;
    const winRate = games > 0 ? (wins / games * 100).toFixed(1) + '%' : 'N/A';
    console.log(`\n【${name}】 出场:${games} 胜率:${winRate}`);

    const counters = getCounters(hid, stats).slice(0, 5);
    if (counters.length > 0) {
      console.log('  克制:', counters.map(c => `${heroNameMap[c.hero_id] || c.hero_id}(${(c.win_rate*100).toFixed(1)}%)`).join(', '));
    }

    const synergies = getSynergies(hid, stats).slice(0, 5);
    if (synergies.length > 0) {
      console.log('  协同:', synergies.map(s => `${heroNameMap[s.hero_id] || s.hero_id}(${(s.synergy_rate*100).toFixed(1)}%)`).join(', '));
    }
  }

  // 保存完整统计数据
  const fs = require('fs');
  fs.writeFileSync(`counter_stats_${teamName}.json`, JSON.stringify(stats, null, 2));
  console.log(`\n统计数据已保存到 counter_stats_${teamName}.json`);
}

main('team_spirit', 7119388).catch(console.error);
// ==================== DEMO PARSER SERVER ====================
// 使用 @deademx/dota2 解析 Dota2 .dem 文件
// 功能：战斗日志、击杀事件、眼位追踪、玩家名字解析

import { createReadStream } from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { Parser, ParserConfiguration, InterceptorStage } from '@deademx/dota2';
import { OPENDOTA_API_KEY, MINIMAX_API_KEY, MINIMAX_API_URL, MINIMAX_MODEL } from './config/api_keys.js';

// ==================== 名字解析 ====================
// String Table 索引到名字的映射 (模块级别，全局唯一)
const entityNames = new Map();     // entityId -> playerName/heroName
const playerEntities = new Map();  // entityId -> {name, playerId, team}

// 战斗日志事件类型
const COMBATLOG_TYPE = {
  0: 'INVALID',
  1: 'KILL',
  2: 'DEAD',
  3: 'BUYBACK',
  4: 'PURCHASE',
  5: 'GOLD',
  6: 'GIVE_GOLD',
  7: 'BECOME_VISIBLE',
  8: 'FIRST_BLOOD',
  9: 'DISCONNECT',
  10: 'INTERRUPT_CHANNEL',
  11: 'INVOKER_ABILITY',
  12: 'STOLABILITY',
  13: 'HERO_REVIVE',
  14: 'COUNTER',
  15: 'VICTORY',
  16: 'DEFEAT',
  17: 'ABILITY',
  18: 'GENERIC',
  19: 'MODIFIER_ADD',
  20: 'MODIFIER_REMOVE',
};

// ==================== 轨迹插值函数 ====================
/**
 * 将低频位置数据插值为均匀采样的高频轨迹
 *
 * @param {Object} positionBuffer - 原始低频位置数据 {entityId: [{x,y,z,tick,className}, ...]}
 * @param {Object} positionHistory - 输出目标 {entityId: [{x,y,z,time,tick}, ...]}
 * @param {number} targetFps - 目标采样率（帧/秒），默认 10 fps（战术分析足够）
 *
 * 注意：这是数学插值，不是真实帧级数据。Dota2 demo 只存储实体状态变化（delta），
 * 不存储每帧位置。线性插值假设英雄匀速运动，但实际英雄有站立/突然移动/tp/被控制等
 * 非匀速行为。DEM_USERCmd 每帧输入数据在此 demo 中不存在。
 */
function interpolateTrajectories(positionBuffer, positionHistory, targetFps = 10) {
  const GAME_FPS = 30; // Dota2 内部 tick 率

  for (const [entityId, positions] of Object.entries(positionBuffer)) {
    if (!positions || positions.length < 2) {
      if (positions && positions.length > 0) {
        positionHistory[entityId] = positions.map(p => ({
          x: p.x,
          y: p.y,
          z: p.z,
          time: p.tick / GAME_FPS,
          tick: p.tick,
          hero: p.className // Preserve hero name
        }));
      }
      continue;
    }

    // 按 tick 排序
    positions.sort((a, b) => a.tick - b.tick);

    // Preserve hero name from first position
    const heroName = positions[0].className;

    const firstTick = positions[0].tick;
    const lastTick = positions[positions.length - 1].tick;
    const durationSec = (lastTick - firstTick) / GAME_FPS;
    const totalSamples = Math.ceil(durationSec * targetFps);

    const result = [];

    // 均匀采样：跨越整个比赛时长，每隔 1/targetFps 秒采样一次
    for (let i = 0; i < totalSamples; i++) {
      const targetTick = firstTick + Math.round((i / (totalSamples - 1)) * (lastTick - firstTick));

      // 找到包含 targetTick 的两个原始点
      let curr = positions[0];
      let next = positions[1];
      for (let j = 1; j < positions.length; j++) {
        if (positions[j].tick >= targetTick) {
          next = positions[j];
          curr = positions[j - 1];
          break;
        }
        curr = positions[j];
        next = positions[j + 1] || curr;
      }

      // 线性插值（这是近似值，不是真实帧数据）
      const tickDiff = next.tick - curr.tick;
      const ratio = tickDiff > 0 ? (targetTick - curr.tick) / tickDiff : 0;
      result.push({
        x: curr.x + (next.x - curr.x) * ratio,
        y: curr.y + (next.y - curr.y) * ratio,
        z: curr.z + (next.z - curr.z) * ratio,
        time: targetTick / GAME_FPS,
        tick: targetTick,
        hero: heroName
      });
    }

    positionHistory[entityId] = result;
  }
}

// ==================== 解析函数 ====================
async function parseDemoFile(filePath) {
  const config = new ParserConfiguration();
  config.collectcombatlogentries = true;

  const parser = new Parser(config);

  // 数据收集
  const result = {
    matchInfo: {
      matchId: extractMatchId(filePath),
      duration: 0,
      radiantWin: false,
      gameTime: 0,
    },
    players: [],
    teamStats: {
      radiant: { kills: 0, deaths: 0, assists: 0 },
      dire: { kills: 0, deaths: 0, assists: 0 },
    },
    events: {
      kills: [],
      deaths: [],
      purchases: [],
      wardPlacements: [],
      wardDestroys: [],
      runePickups: [],
      heroRevives: [],
      minimapEvents: [],  // 所有 minimap event (含坐标)
    },
    combatLog: [],
    stats: {
      totalCombatEvents: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalPurchases: 0,
    },
    stringTables: {
      players: {},
      heroes: {},
    },
    entityMapping: {
      entities: {},    // entityId -> name
      players: {},    // entityId -> {name, playerId, team}
    },
    positionHistory: {},  // entityId -> [{x,y,z,time},...]
    rawTrajectory: {},    // 原始低频轨迹数据（未插值）
  };

  // CBodyComponent field paths for position (cell coordinates)
  // Field paths: 14|0 = m_cellX, 14|1 = m_cellY, 14|2 = m_cellZ
  const CELL_X = '14|0';
  const CELL_Y = '14|1';
  const CELL_Z = '14|2';

  // 位置采样率控制：每 N 个 DEM_PACKET 采样一次（降低数据量）
  // Dota2 demo 约 30tick/秒，设置为 30 意味着每秒记录 1 次位置
  let packetCounter = 0;
  const SAMPLES_PER_PACKET = 1; // 每个包都尝试采样

  // 当前游戏 tick（从 DEM_PACKET 获取）
  let currentTick = 0;

  // Register DEMO_PACKET interceptor to track tick
  parser.registerPreInterceptor(InterceptorStage.DEMO_PACKET, (demoPacket) => {
    // 获取当前 tick，这是真正的游戏时间单位
    currentTick = demoPacket.tick || 0;
    packetCounter++;
  });

  // Entity handle -> hero name 映射（用于 minimap event 关联）
  const entityHandleMap = new Map();  // handle -> heroName

  // Register ENTITY_PACKET interceptor to build handle -> hero mapping
  parser.registerPreInterceptor(InterceptorStage.ENTITY_PACKET, (demoPacket, messagePacket, events) => {
    for (const event of events) {
      const entity = event.entity;
      if (!entity) continue;
      const clazz = entity._class;
      if (!clazz || !clazz._serializer) continue;
      const className = clazz._name;
      if (className && className.startsWith('CDOTA_Unit_Hero_')) {
        const heroName = className.replace('CDOTA_Unit_Hero_', '');
        const handle = entity._handle || ((1 << 17) | entity._index);
        entityHandleMap.set(handle, heroName);
      }
    }
  });

  parser.registerPreInterceptor(InterceptorStage.MESSAGE_PACKET, (demoPacket, messagePacket) => {
    const type = messagePacket.type._code;

    // DOTA_UM_MinimapEvent - 眼位、信号等事件（带坐标）
    if (type === 'DOTA_UM_MinimapEvent') {
      const data = messagePacket.data;
      const eventType = data.eventType;
      const handle = data.entityHandle;
      const heroName = entityHandleMap.get(handle) || 'unknown';

      // type 64 = ward placement, type 32 = sentry placement, type 4 = glyph?
      // type 4096 = ability effect, type 8192 = projectile
      const minimapEvent = {
        eventType: eventType,
        entityHandle: handle,
        hero: heroName,
        x: data.x,
        y: data.y,
        duration: data.duration,
        tick: currentTick,
        time: Math.floor(currentTick / 30),  // Dota2 ~30 ticks/sec
      };
      result.events.minimapEvents.push(minimapEvent);

      // 分类 ward 放置事件（基于 eventType）
      if (eventType === 64) {  // Observer ward placement
        result.events.wardPlacements.push(minimapEvent);
      } else if (eventType === 32) {  // Sentry ward placement
        result.events.wardPlacements.push(minimapEvent);
      }
    }

    // DOTA_UM_ChatEvent - 包含击杀等信息
    if (type === 'DOTA_UM_ChatEvent') {
      const data = messagePacket.data;
      if (data && data.type === 0) { // Kill
        // Chat event data: { type, timestamp, value (killer), key (victim), playerid1, playerid2 }
        result.events.kills.push({
          time: data.timestamp || 0,
          killerPlayerId: data.value,
          victimPlayerId: data.key,
        });
      }
    }

    // DOTA_UM_CombatLogDataHltv - 详细战斗日志
    if (type === 'DOTA_UM_CombatLogDataHltv') {
      const entry = messagePacket.data;
      result.stats.totalCombatEvents++;

      const event = {
        type: entry.type,
        typeName: COMBATLOG_TYPE[entry.type] || `TYPE_${entry.type}`,
        timestamp: entry.timestamp || 0,
        timestampRaw: entry.timestampRaw || 0,
        attackerName: entry.attackerName,
        targetName: entry.targetName,
        attackerHero: entry.attackerHero,
        targetHero: entry.targetHero,
        inflictorName: entry.inflictorName,
        value: entry.value,
        gold: entry.gold,
        xp: entry.xp,
        isAttackerHero: entry.isAttackerHero,
        isTargetHero: entry.isTargetHero,
        attackerTeam: entry.attackerTeam,
        targetTeam: entry.targetTeam,
        health: entry.health,
        // Modifier events for ward tracking
        modifierAbility: entry.modifierAbility,
        stackCount: entry.stackCount,
        // Hero death
        heroDeath: entry.heroDeath || false,
        lastHits: entry.lastHits,
        isTargetBuilding: entry.isTargetBuilding,
      };

      result.combatLog.push(event);

      // 分类统计
      switch (entry.type) {
        case 1: // KILL
          result.stats.totalKills++;
          break;
        case 2: // DEAD
          result.stats.totalDeaths++;
          break;
        case 4: // PURCHASE
          result.stats.totalPurchases++;
          // 物品购买事件
          result.events.purchases.push(event);
          break;
        case 15: // VICTORY
          result.matchInfo.radiantWin = entry.targetTeam === 2; // 2 = radiant
          break;
        case 17: // ABILITY
          // 注意：ward 相关逻辑已移至 DOTA_UM_MinimapEvent 处理
          break;
        case 19: // MODIFIER_ADD
          // 注意：ward 相关逻辑已移至 DOTA_UM_MinimapEvent 处理
          // 不再从 modifier 追踪眼位（不准确）
          break;
        case 20: // MODIFIER_REMOVE
          // 注意：ward 相关逻辑已移至 DOTA_UM_MinimapEvent 处理
          break;
        case 13: // HERO_REVIVE
          result.events.heroRevives.push(event);
          break;
      }

      // 队伍统计
      if (entry.type === 1 && entry.attackerTeam) {
        if (entry.attackerTeam === 2) {
          result.teamStats.radiant.kills++;
        } else if (entry.attackerTeam === 3) {
          result.teamStats.dire.kills++;
        }
      }
      if (entry.type === 2 && entry.targetTeam) {
        if (entry.targetTeam === 2) {
          result.teamStats.radiant.deaths++;
        } else if (entry.targetTeam === 3) {
          result.teamStats.dire.deaths++;
        }
      }
    }
  });

  // Register ENTITY_PACKET interceptor for hero position tracking
  // 位置数据存储: entityId -> [{x, y, z, tick}, ...]
  const positionBuffer = {};  // 原始位置数据（低频，来自 mutation）

  parser.registerPreInterceptor(InterceptorStage.ENTITY_PACKET, (demoPacket, messagePacket, events) => {
    // 累积同一个包中同一英雄的位置数据
    const heroPositions = {};

    for (const event of events) {
      const entity = event.entity;
      const mutations = event.mutations;
      const clazz = entity._class;

      if (!clazz || !clazz._serializer) continue;

      const className = clazz._name;

      // Only track hero units (CDOTA_Unit_Hero_*)
      if (!className.startsWith('CDOTA_Unit_Hero_')) continue;

      const heroName = className.replace('CDOTA_Unit_Hero_', '').toLowerCase();

      // 初始化或累积该英雄的坐标
      if (!heroPositions[heroName]) {
        heroPositions[heroName] = { x: null, y: null, z: null, tick: currentTick };
      }

      for (const mutation of mutations) {
        const fp = mutation.fieldPath;
        if (!fp || typeof fp !== 'object') continue;

        const fpStr = fp.toString();
        const value = mutation.value;

        if (typeof value !== 'number' || value === 0) continue;

        if (fpStr === CELL_X) {
          heroPositions[heroName].x = value;
        } else if (fpStr === CELL_Y) {
          heroPositions[heroName].y = value;
        } else if (fpStr === CELL_Z) {
          heroPositions[heroName].z = value;
        }
      }
    }

    // 处理累积的位置数据（同一个 DEMO_PACKET 中的多个更新）
    for (const [heroName, pos] of Object.entries(heroPositions)) {
      if (pos.x !== null && pos.y !== null && pos.z !== null) {
        // 使用 heroName 作为 key，避免 entityId 重复的问题
        if (!positionBuffer[heroName]) {
          positionBuffer[heroName] = [];
        }
        positionBuffer[heroName].push({
          x: (pos.x - 128) * 128,
          y: (pos.y - 128) * 128,
          z: (pos.z - 128) * 128,
          tick: pos.tick,
          className: heroName
        });
      }
    }
  });

  // 解析完成后进行轨迹插值
  await parser.parse(createReadStream(filePath));
  await parser.dispose();

  // 进行轨迹插值：将低频位置数据插值为每秒 10 帧的完整轨迹
  interpolateTrajectories(positionBuffer, result.positionHistory, 10);

  // 保存原始低频轨迹数据（用于真实轨迹展示）
  result.rawTrajectory = positionBuffer;

  // 计算时长 (最后一次时间戳)
  if (result.combatLog.length > 0) {
    const lastEvent = result.combatLog[result.combatLog.length - 1];
    result.matchInfo.duration = Math.floor(lastEvent.timestamp || 0);
  }

  // 计算队伍总助攻
  calculateAssists(result);

  return result;
}

// 从文件路径提取 match ID
function extractMatchId(filePath) {
  const filename = filePath.split('/').pop().replace('.dem', '');
  const matchId = parseInt(filename, 10);
  return isNaN(matchId) ? null : matchId;
}

// 判断是否是 ward 相关技能/能力
function isWardAbility(nameOrId) {
  if (!nameOrId) return false;
  // inflictorName 是 ability ID (数字)，modifierAbility 也是
  if (typeof nameOrId === 'number') {
    // Dota2 中常见的眼位相关 ability ID
    // 这些 ID 需要通过游戏资源确定，这里使用出现频率最高的几个
    const wardAbilityIds = [88, 39, 81, 103, 163, 164, 232, 274, 310, 324, 330, 373, 435, 443, 547, 79, 25];
    return wardAbilityIds.includes(nameOrId);
  }
  // 字符串判断（旧逻辑）
  if (typeof nameOrId !== 'string') return false;
  const lower = nameOrId.toLowerCase();
  return lower.includes('ward') ||
         lower.includes('observer') ||
         lower.includes('sentry') ||
         lower.includes('place') ||
         lower.includes('deplant');
}

// 判断是否是 ward 放置技能
function isWardPlacementAbility(nameOrId) {
  if (!nameOrId) return false;
  if (typeof nameOrId === 'number') {
    // 高频 ward IDs 可能是放置眼位
    const wardPlacementIds = [88, 39, 81];
    return wardPlacementIds.includes(nameOrId);
  }
  if (typeof nameOrId !== 'string') return false;
  const lower = nameOrId.toLowerCase();
  return lower.includes('place') || lower.includes('plant') ||
         lower.includes('observer') || lower.includes('sentry');
}

// 判断是否是 ward 移除技能
function isWardRemoveAbility(nameOrId) {
  if (!nameOrId) return false;
  if (typeof nameOrId === 'number') {
    // 眼位移除相关的 IDs (deplant/destroy)
    return false; // 需要更多数据来确定
  }
  if (typeof nameOrId !== 'string') return false;
  const lower = nameOrId.toLowerCase();
  return lower.includes('deplant') || lower.includes('destroy') ||
         lower.includes('remove');
}

// 计算助攻数 (从击杀事件反推)
function calculateAssists(result) {
  // 击杀事件中记录了 killer，通过击杀来统计 assist
  // 这里简化处理，实际应该从事件详情中提取
}

// ==================== OpenDota API 调用 ====================
// 获取英雄名称映射
async function fetchHeroNameMap() {
  return new Promise((resolve, reject) => {
    const url = `https://api.opendota.com/api/heroes?api_key=${OPENDOTA_API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const heroes = JSON.parse(data);
          const map = {};
          heroes.forEach(h => {
            map[h.id] = h.name_localized || h.name.replace('npc_dota_hero_', '');
          });
          resolve(map);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 获取比赛详细信息
async function fetchMatchData(matchId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.opendota.com/api/matches/${matchId}?api_key=${OPENDOTA_API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 生成眼位分析报告
async function generateVisionReport(demoResult, matchId) {
  try {
    const [heroMap, matchData] = await Promise.all([
      fetchHeroNameMap(),
      fetchMatchData(matchId)
    ]);

    // 建立 player_slot 到英雄名称的映射
    const playerInfo = {};
    // 眼位统计（使用 OpenDota 真实数据，不使用 demo modifier 追踪）
    const wardByTeam = { radiant: 0, dire: 0 };
    const wardByHero = {};

    if (matchData.players) {
      matchData.players.forEach(p => {
        const entityId = p.player_slot;
        const team = p.player_slot < 128 ? 'radiant' : 'dire';
        playerInfo[entityId] = {
          name: p.personaname || 'unknown',
          hero: heroMap[p.hero_id] || `hero_${p.hero_id}`,
          hero_id: p.hero_id,
          team: team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          obs_placed: p.obs_placed || 0,
          sen_placed: p.sen_placed || 0
        };

        // 累计队伍眼位
        if (team === 'radiant') {
          wardByTeam.radiant += (p.obs_placed || 0) + (p.sen_placed || 0);
        } else {
          wardByTeam.dire += (p.obs_placed || 0) + (p.sen_placed || 0);
        }

        // 按英雄统计
        const heroKey = heroMap[p.hero_id] || `hero_${p.hero_id}`;
        wardByHero[heroKey] = (wardByHero[heroKey] || 0) + (p.obs_placed || 0) + (p.sen_placed || 0);
      });
    }

    // 计算总眼位
    const totalObs = (matchData.players || []).reduce((sum, p) => sum + (p.obs_placed || 0), 0);
    const totalSen = (matchData.players || []).reduce((sum, p) => sum + (p.sen_placed || 0), 0);

    // 生成报告
    const report = {
      matchId: matchId,
      duration: matchData.duration,
      radiantWin: matchData.radiant_win,
      players: playerInfo,
      teamStats: {
        radiant: { kills: matchData.radiant_kills || 0, deaths: matchData.dire_kills || 0 },
        dire: { kills: matchData.dire_kills || 0, deaths: matchData.radiant_kills || 0 }
      },
      visionStats: {
        // 使用 OpenDota 真实眼位数据
        totalObs: totalObs,
        totalSen: totalSen,
        totalWards: totalObs + totalSen,
        wardByTeam: wardByTeam,
        radiantAdvantage: wardByTeam.radiant - wardByTeam.dire,
        obsByHero: {},
        senByHero: {}
      },
      heroStats: [],
      summary: ''
    };

    // 添加每个英雄的 obs/sen 统计
    if (matchData.players) {
      matchData.players.forEach(p => {
        const hero = heroMap[p.hero_id] || `hero_${p.hero_id}`;
        report.visionStats.obsByHero[hero] = (report.visionStats.obsByHero[hero] || 0) + (p.obs_placed || 0);
        report.visionStats.senByHero[hero] = (report.visionStats.senByHero[hero] || 0) + (p.sen_placed || 0);
      });
    }

    // 添加英雄统计
    Object.entries(playerInfo).forEach(([slot, info]) => {
      report.heroStats.push(info);
    });

    // 生成摘要
    const wardDiff = wardByTeam.dire - wardByTeam.radiant;
    const winner = matchData.radiant_win ? '天辉' : '夜魇';
    report.summary = `比赛时长 ${Math.floor(matchData.duration / 60)}分${matchData.duration % 60}秒，${winner}获胜。` +
      `总眼位：观察守卫 ${totalObs} 个，透视守卫 ${totalSen} 个。` +
      `夜魇队伍眼位领先 ${wardDiff} 次。`;

    return report;

  } catch (error) {
    console.error('生成眼位报告失败:', error);
    throw error;
  }
}

// ==================== MiniMax AI 分析 ====================
async function generateAIVisionReport(visionData) {
  const { matchId, duration, radiantWin, players, visionStats, teamStats } = visionData;

  const radiantPlayers = Object.values(players).filter(p => p.team === 'radiant');
  const direPlayers = Object.values(players).filter(p => p.team === 'dire');

  const prompt = `请分析以下 Dota2 比赛的眼位数据，生成一份专业的眼位分析报告。

## 比赛基本信息
- 比赛ID: ${matchId}
- 比赛时长: ${Math.floor(duration / 60)}分${duration % 60}秒
- 结果: ${radiantWin ? '天辉' : '夜魇'}胜利

## 眼位数据统计（来自 OpenDota API）
- 观察守卫 (Observer) 总数: ${visionStats.totalObs} 个
- 透视守卫 (Sentry) 总数: ${visionStats.totalSen} 个
- 天辉队伍总眼位: ${visionStats.wardByTeam.radiant} 次
- 夜魇队伍总眼位: ${visionStats.wardByTeam.dire} 次
- 眼位净差: ${Math.abs(visionStats.radiantAdvantage)} 次

## 队伍统计
- 天辉: ${teamStats.radiant.kills} 击杀, ${teamStats.radiant.deaths} 死亡
- 夜魇: ${teamStats.dire.kills} 击杀, ${teamStats.dire.deaths} 死亡

## 天辉阵容
${radiantPlayers.map(p => `- ${p.name} (${p.hero}): KDA ${p.kills}/${p.deaths}/${p.assists}，观察:${p.obs_placed || 0} 透视:${p.sen_placed || 0}`).join('\n')}

## 夜魇阵容
${direPlayers.map(p => `- ${p.name} (${p.hero}): KDA ${p.kills}/${p.deaths}/${p.assists}，观察:${p.obs_placed || 0} 透视:${p.sen_placed || 0}`).join('\n')}

## 分析要求

请生成一份 JSON 格式的眼位分析报告，包含以下维度：

1. **整体眼位评价**: 双方眼位控制的整体评价
2. **关键眼位时段**: 比赛中关键时段的眼位布置分析 (如开局、中期、后期)
3. **队伍眼位策略**: 天辉和夜魇各自的眼位策略分析
4. **英雄眼位贡献**: 各英雄对眼位控制的贡献度分析
5. **眼位改进建议**: 给两支队伍各提供 2-3 条眼位改进建议

请以 JSON 格式输出，结构如下：
{
  "overallVision": "整体眼位评价",
  "keyMoments": [
    {"time": "时段", "event": "眼位事件描述", "impact": "影响分析"}
  ],
  "radiantStrategy": "天辉队伍眼位策略分析",
  "direStrategy": "夜魇队伍眼位策略分析",
  "heroContribution": [
    {"hero": "英雄名", "player": "选手名", "contribution": "眼位贡献分析", "rating": 8.5}
  ],
  "radiantSuggestions": ["建议1", "建议2", "建议3"],
  "direSuggestions": ["建议1", "建议2", "建议3"],
  "winFactor": "获胜方的关键眼位因素"
}`;

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的 Dota2 眼位分析师，擅长分析比赛中的视野控制和眼位策略。回答时只输出 JSON，不要有其他内容。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`MiniMax API 请求失败: ${response.status} - ${err}`);
  }

  const result = await response.json();

  // 解析 AI 返回的 JSON
  try {
    // content is an array: [{type: 'thinking', text: ...}, {type: 'text', text: ...}]
    let rawText = '';
    if (Array.isArray(result.content)) {
      const textItem = result.content.find(item => item.type === 'text');
      rawText = textItem?.text || '';
    } else if (typeof result.content === 'string') {
      rawText = result.content;
    }

    // Remove markdown code blocks if present
    rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Try to find JSON in the text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { overallVision: rawText || 'AI 分析完成' };
  } catch (e) {
    console.error('解析 AI 响应失败:', e);
    return { overallVision: 'AI 分析完成（部分数据解析失败）' };
  }
}

// ==================== 空间分析引擎 (Phase 2) ====================
// 眼位热力图、英雄轨迹统计、团队热力图
// 具体实现在 Phase 2 中填充

function computeWardHeatmap(demoResult) {
  const minimapEvents = demoResult?.events?.minimapEvents || [];
  const wards = minimapEvents.filter(e => e.eventType === 64 || e.eventType === 32);
  if (wards.length === 0) return null;

  const GRID_SIZE = 40;
  const CELL_SIZE = 800;
  const OFFSET = 16000;
  const grid = {};

  wards.forEach(w => {
    const worldX = (w.x || 0) * 8;
    const worldY = (w.y || 0) * 8;
    const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((worldX + OFFSET) / CELL_SIZE)));
    const gy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((worldY + OFFSET) / CELL_SIZE)));
    const key = `${gx},${gy}`;
    if (!grid[key]) {
      grid[key] = { gx, gy, obsCount: 0, senCount: 0, totalCount: 0,
        worldCenterX: (gx * CELL_SIZE + CELL_SIZE / 2) - OFFSET,
        worldCenterY: (gy * CELL_SIZE + CELL_SIZE / 2) - OFFSET };
    }
    if (w.eventType === 64) grid[key].obsCount++;
    else grid[key].senCount++;
    grid[key].totalCount++;
  });

  const cells = Object.values(grid);
  const maxCount = Math.max(...cells.map(c => c.totalCount), 1);
  cells.forEach(c => { c.density = c.totalCount / maxCount; });

  // Hot spots: cells with count >= 3 and density >= 0.3
  const hotSpots = cells
    .filter(c => c.totalCount >= 3 && c.density >= 0.3)
    .sort((a, b) => b.totalCount - a.totalCount);

  // Temporal buckets: 10-min intervals
  const duration = demoResult?.matchInfo?.duration || 3600;
  const bucketCount = Math.ceil(duration / 600);
  const temporalBuckets = [];
  for (let i = 0; i < bucketCount; i++) {
    const startSec = i * 600;
    const endSec = (i + 1) * 600;
    const bucketWards = wards.filter(w => {
      const timeSec = (w.tick || 0) / 30;
      return timeSec >= startSec && timeSec < endSec;
    });
    temporalBuckets.push({
      bucket: `${Math.floor(startSec / 60)}-${Math.floor(endSec / 60)}min`,
      obsCount: bucketWards.filter(w => w.eventType === 64).length,
      senCount: bucketWards.filter(w => w.eventType === 32).length,
    });
  }

  return { gridSize: GRID_SIZE, cellWorldSize: CELL_SIZE, cells, hotSpots, temporalBuckets,
    totalObs: wards.filter(w => w.eventType === 64).length,
    totalSen: wards.filter(w => w.eventType === 32).length };
}

function computeHeroTrajectoryStats(demoResult) {
  const positionHistory = demoResult?.positionHistory || {};
  const heroNames = Object.keys(positionHistory).filter(k => k && !k.includes('_'));
  if (heroNames.length === 0) return null;

  const stats = {};
  const LANES = {
    topLane: { x: [5000, 15000], y: [2000, 8000] },
    midLane: { x: [-2000, 2000], y: [-2000, 2000] },
    botLane: { x: [-15000, -5000], y: [-8000, -2000] },
    radiantJungle: { x: [-3000, 5000], y: [3000, 10000] },
    direJungle: { x: [-5000, 3000], y: [-10000, -3000] },
    roshPit: { x: [-2000, 2000], y: [-2000, 2000] },
    radiantFountain: { x: [8000, 15000], y: [8000, 15000] },
    direFountain: { x: [-15000, -8000], y: [-15000, -8000] },
  };

  function getZone(x, y) {
    for (const [name, zone] of Object.entries(LANES)) {
      if (x >= zone.x[0] && x <= zone.x[1] && y >= zone.y[0] && y <= zone.y[1]) return name;
    }
    return 'other';
  }

  heroNames.forEach(heroName => {
    const positions = positionHistory[heroName] || [];
    if (positions.length < 2) {
      stats[heroName] = { heroName, lanePresence: {}, rotations: { count: 0, transitions: [] },
        simplifiedPath: [], totalTimeSec: 0 };
      return;
    }

    const zoneTime = {};
    let prevZone = null;
    const transitions = [];

    positions.forEach((p, i) => {
      const zone = getZone(p.x, p.y);
      zoneTime[zone] = (zoneTime[zone] || 0) + (1 / 10); // 10fps → each point = 0.1s

      if (prevZone && prevZone !== zone) {
        const isLane = ['topLane', 'midLane', 'botLane'].includes(zone);
        const wasLane = ['topLane', 'midLane', 'botLane'].includes(prevZone);
        if (isLane || wasLane) {
          transitions.push({ from: prevZone, to: zone, atTime: p.time });
        }
      }
      prevZone = zone;
    });

    const totalTime = Object.values(zoneTime).reduce((a, b) => a + b, 0) || 1;
    const lanePresence = {};
    Object.entries(zoneTime).forEach(([zone, time]) => {
      lanePresence[zone] = { timeSec: Math.round(time), percentage: Math.round((time / totalTime) * 1000) / 10 };
    });

    // Simplify path: sample every ~100th point (~10 second intervals)
    const simplifyInterval = Math.max(1, Math.floor(positions.length / 500));
    const simplifiedPath = positions.filter((_, i) => i % simplifyInterval === 0);

    stats[heroName] = {
      heroName,
      lanePresence,
      rotations: { count: transitions.length, transitions: transitions.slice(0, 30) },
      simplifiedPath,
      totalTimeSec: Math.round(totalTime),
      pointCount: positions.length,
    };
  });

  return stats;
}

function computeTeamHeatmap(demoResult) {
  const positionHistory = demoResult?.positionHistory || {};
  const GRID_SIZE = 40;
  const CELL_SIZE = 800;
  const OFFSET = 16000;

  // Team assignment heuristic: based on common Dota2 convention
  // Radiant heroes typically play on the top-right side, Dire on bottom-left
  // Since we don't have team data from demo alone, we use OpenDota data when available
  // For now, return raw per-hero heatmap data
  const heroGrids = {};

  Object.entries(positionHistory).forEach(([heroName, positions]) => {
    if (!heroName || heroName.includes('_')) return;
    if (!Array.isArray(positions) || positions.length === 0) return;

    const grid = {};
    positions.forEach(p => {
      const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.x + OFFSET) / CELL_SIZE)));
      const gy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((p.y + OFFSET) / CELL_SIZE)));
      const key = `${gx},${gy}`;
      grid[key] = (grid[key] || 0) + 1;
    });

    const cells = Object.entries(grid).map(([key, count]) => {
      const [gx, gy] = key.split(',').map(Number);
      const timeSec = count / 10; // 10fps
      return { gx, gy, timeSec, worldCenterX: (gx * CELL_SIZE + CELL_SIZE / 2) - OFFSET,
        worldCenterY: (gy * CELL_SIZE + CELL_SIZE / 2) - OFFSET };
    });

    const maxTime = Math.max(...cells.map(c => c.timeSec), 1);
    cells.forEach(c => { c.density = c.timeSec / maxTime; });

    heroGrids[heroName] = { cells, maxTimeSec: Math.round(maxTime), totalPoints: positions.length };
  });

  return heroGrids;
}

/**
 * 空间分析总入口
 * @param {Object} demoResult - parseDemoFile() 的完整返回结果
 * @returns {Object} 包含 wardHeatmap, heroStats, teamHeatmap, summary
 */
function computeSpatialAnalysis(demoResult) {
  const wardHeatmap = computeWardHeatmap(demoResult);
  const heroStats = computeHeroTrajectoryStats(demoResult);
  const teamHeatmap = computeTeamHeatmap(demoResult);

  const summaryParts = [];
  if (wardHeatmap) {
    summaryParts.push(`眼位：${wardHeatmap.totalObs} Observer + ${wardHeatmap.totalSen} Sentry，${wardHeatmap.hotSpots.length} 个热点区域`);
  }
  if (heroStats) {
    const heroes = Object.keys(heroStats);
    summaryParts.push(`${heroes.length} 个英雄轨迹已分析`);
  }

  return { wardHeatmap, heroStats, teamHeatmap, summary: summaryParts.join('；') };
}

// ==================== 模块导出 ====================
// 当作为库被 import 时导出这些函数
// 当直接运行时启动 HTTP 服务器（向后兼容）

export {
  parseDemoFile,
  extractMatchId,
  generateVisionReport,
  generateAIVisionReport,
  interpolateTrajectories,
  computeSpatialAnalysis,
  computeWardHeatmap,
  computeHeroTrajectoryStats,
  computeTeamHeatmap,
  fetchMatchData,
  fetchHeroNameMap,
};

// 直接运行时启动服务器（向后兼容旧的工作流）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('node:http');
  const PORT = 3000;

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    // ... (保留旧的端点逻辑作为向后兼容)

    if (req.method === 'POST' && req.url === '/parse-demo') {
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', async () => {
        try {
          const { filePath } = JSON.parse(Buffer.concat(body).toString());
          if (!filePath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No file path provided' })); return; }
          console.log(`[${new Date().toISOString()}] Parsing: ${filePath}`);
          const result = await parseDemoFile(filePath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { matchInfo: result.matchInfo, teamStats: result.teamStats,
            events: { totalKills: result.events.kills.length || result.stats.totalKills, wardPlacements: result.events.wardPlacements.length },
            stats: result.stats, wardEvents: result.events.wardPlacements.slice(0, 50),
            combatLogSample: result.combatLog.slice(0, 100), message: '解析完成' } }));
        } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
      });
    } else if (req.method === 'POST' && req.url === '/demo-trajectory') {
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', async () => {
        try {
          const { filePath } = JSON.parse(Buffer.concat(body).toString());
          if (!filePath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No file path provided' })); return; }
          console.log(`[${new Date().toISOString()}] Trajectory: ${filePath}`);
          const result = await parseDemoFile(filePath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { matchId: result.matchInfo.matchId, duration: result.matchInfo.duration,
            radiantWin: result.matchInfo.radiantWin, positionHistory: result.positionHistory,
            rawTrajectory: result.rawTrajectory || {}, combatLog: result.combatLog.slice(0, 500),
            teamStats: result.teamStats, stats: result.stats, minimapEvents: result.events.minimapEvents || [],
            wardPlacements: result.events.wardPlacements || [] } }));
        } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
      });
    } else if (req.method === 'POST' && req.url === '/full-vision-report') {
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', async () => {
        try {
          const { filePath } = JSON.parse(Buffer.concat(body).toString());
          if (!filePath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No file path provided' })); return; }
          console.log(`[${new Date().toISOString()}] Full vision: ${filePath}`);
          const result = await parseDemoFile(filePath);
          const matchId = extractMatchId(filePath);
          const visionData = await generateVisionReport(result, matchId);
          const aiReport = await generateAIVisionReport(visionData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { ...visionData, aiAnalysis: aiReport } }));
        } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else { res.writeHead(404); res.end(); }
  });

  server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Demo parser server (standalone) running on port ${PORT}`);
  });
}
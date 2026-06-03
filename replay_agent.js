// ==================== REPLAY AGENT ====================
// AI 分析核心 - 使用 MiniMax API 生成复盘报告
// API 密钥已移至 config/api_keys.js

import { MINIMAX_API_KEY, MINIMAX_API_URL, MINIMAX_MODEL } from './config/api_keys.js';

async function analyzeReplay(matchData) {
  const prompt = buildAnalysisPrompt(matchData);

  try {
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
            content: '你是一个专业的 Dota2 战术分析师，擅长分析比赛录像数据，提供深入的战术建议、选手表现评估和团队策略分析。你的分析报告应该结构清晰、数据驱动、具有实战指导意义。回答时只输出 JSON，不要有其他内容。'
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
      throw new Error(`API 请求失败: ${response.status} - ${err}`);
    }

    const result = await response.json();
    return parseAnalysisResponse(result);
  } catch (error) {
    console.error('分析失败:', error);
    throw error;
  }
}

async function analyzeVisionReport(visionData) {
  const prompt = buildVisionPrompt(visionData);

  try {
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
            content: '你是一个专业的 Dota2 眼位分析师，擅长分析比赛中的视野控制和眼位策略。你的分析报告应该结构清晰、数据驱动、具有实战指导意义。回答时只输出 JSON，不要有其他内容。'
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
      throw new Error(`API 请求失败: ${response.status} - ${err}`);
    }

    const result = await response.json();
    return parseAnalysisResponse(result);
  } catch (error) {
    console.error('眼位分析失败:', error);
    throw error;
  }
}

function buildVisionPrompt(visionData) {
  const { matchId, duration, radiantWin, players, visionStats, teamStats, summary } = visionData;

  const radiantPlayers = Object.values(players).filter(p => p.team === 'radiant');
  const direPlayers = Object.values(players).filter(p => p.team === 'dire');

  return `请分析以下 Dota2 比赛的眼位数据，生成一份专业的眼位分析报告。

## 比赛基本信息
- 比赛ID: ${matchId}
- 比赛时长: ${Math.floor(duration / 60)}分${duration % 60}秒
- 结果: ${radiantWin ? '天辉' : '夜魇'}胜利

## 眼位数据统计
- 总眼位放置事件: ${visionStats.totalWardPlacements} 次 (来自 modifier 事件追踪)
- 天辉队伍眼位: ${visionStats.wardByTeam.radiant} 次
- 夜魇队伍眼位: ${visionStats.wardByTeam.dire} 次
- 眼位净差: 夜魇领先 ${Math.abs(visionStats.radiantAdvantage)} 次

## 队伍统计
- 天辉: ${teamStats.radiant.kills} 击杀, ${teamStats.radiant.deaths} 死亡
- 夜魇: ${teamStats.dire.kills} 击杀, ${teamStats.dire.deaths} 死亡

## 天辉阵容
${radiantPlayers.map(p => `
- ${p.name} (${p.hero}): KDA ${p.kills}/${p.deaths}/${p.assists}`).join('\n')}

## 夜魇阵容
${direPlayers.map(p => `
- ${p.name} (${p.hero}): KDA ${p.kills}/${p.deaths}/${p.assists}`).join('\n')}

## 分析要求

请生成一份 JSON 格式的眼位分析报告，包含以下维度：

1. **整体眼位评价**: 双方眼位控制的整体评价
2. **关键眼位时段**: 比赛中几个关键时段的眼位布置分析 (如开局、中期、后期)
3. **队伍眼位策略**: 天辉和夜魇各自的眼位策略分析
4. **英雄眼位贡献**: 各英雄对眼位控制的贡献度分析
5. **眼位改进建议**: 给两支队伍各提供 2-3 条眼位改进建议

请以 JSON 格式输出，结构如下：
{
  "overallVision": "整体眼位评价",
  "keyMoments": [
    {"time": "时段如 0-10分钟", "event": "眼位事件描述", "impact": "影响分析"}
  ],
  "radiantStrategy": "天辉队伍眼位策略分析",
  "direStrategy": "夜魇队伍眼位策略分析",
  "heroContribution": [
    {"hero": "英雄名", "player": "选手名", "contribution": "眼位贡献分析", "rating": 8.5}
  ],
  "radiantSuggestions": ["建议1", "建议2", "建议3"],
  "direSuggestions": ["建议1", "建议2", "建议3"],
  "winFactor": "夜魇获胜的眼位因素"
}

请确保分析专业、客观、具有实战指导价值。`;
}

function buildAnalysisPrompt(matchData) {
  const { matchInfo, players, overview } = matchData;

  return `请分析以下 Dota2 比赛录像数据，生成一份专业的复盘报告。

## 比赛基本信息
- 比赛ID: ${matchInfo.match_id}
- 比赛时长: ${Math.floor(matchInfo.duration / 60)}分${matchInfo.duration % 60}秒
- 所在赛季: ${matchInfo.lobby_type || '未知'}
- 结果: 天辉胜利 ${matchInfo.radiant_win ? '是' : '否'}

## 阵容信息
${players.map(p => `
【${p.team === 'radiant' ? '天辉' : '夜魇'}】${p.player_slot < 128 ? '天辉' : '夜魇'} - ${p.hero_name || p.hero_id}
- 最终装备: ${(p.items || []).map(i => i.item_name).filter(Boolean).join(', ') || '无'}
- KDA: ${p.kills}/${p.deaths}/${p.assists}
- 补兵: ${p.lane_kills || 0} 正补 / ${p.neutral_kills || 0} 反补
- 金钱: ${p.gold_spent || 0}
- 经验: ${p.xp_spent || 0}`).join('\n')}

## 比赛概述
${overview || '无详细概述数据'}

## 分析要求

请生成一份 JSON 格式的复盘报告，包含以下维度：

1. **阵容分析**: 分析双方阵容的优劣、核心英雄表现、克制关系
2. **选手行为路径**: 分析关键选手的发育轨迹、走位意识、打钱效率
3. **眼位分析**: 基于队伍行为模式分析眼位分布（如果有 ward_log 数据）
4. **团队节奏**: 分析双方推进节奏、团战时机选择、决策质量
5. **胜负因素**: 总结导致比赛结果的关键因素
6. **改进建议**: 给两支队伍各提供2-3条具体改进建议

请以 JSON 格式输出，结构如下：
{
  "summary": "比赛概述（2-3句话）",
  "lineupAnalysis": "阵容分析内容",
  "playerAnalysis": [
    {"player": "选手名", "hero": "英雄", "behavior": "行为路径分析", "rating": 8.5}
  ],
  "visionAnalysis": "眼位分析内容（若无数据则说明）",
  "teamRhythm": "团队节奏分析",
  "winFactors": ["因素1", "因素2", "因素3"],
  "radiantSuggestions": ["建议1", "建议2", "建议3"],
  "direSuggestions": ["建议1", "建议2", "建议3"],
  "keyMoments": [
    {"time": "时间点", "event": "事件描述", "impact": "影响分析"}
  ]
}

请确保分析专业、客观、具有实战指导价值。`;
}

function parseAnalysisResponse(apiResult) {
  try {
    let rawText = '';
    if (apiResult.content && Array.isArray(apiResult.content)) {
      const textItem = apiResult.content.find(t => t.type === 'text');
      rawText = textItem?.text || '';
    } else if (typeof apiResult.content === 'string') {
      rawText = apiResult.content;
    }

    // Remove markdown code blocks if present
    rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Try to find JSON in the text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { summary: rawText || '分析完成' };
  } catch (error) {
    console.error('解析响应失败:', error);
    return {
      summary: '分析完成（部分数据解析失败）',
      error: error.message
    };
  }
}

// 导出全局函数
window.ReplayAgent = {
  analyzeReplay,
  analyzeVisionReport
};
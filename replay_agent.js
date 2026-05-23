// ==================== REPLAY AGENT ====================
// AI 分析核心 - 使用 MiniMax API 生成复盘报告

const MINIMAX_API_URL = 'https://api.minimaxi.com/anthropic/v1/messages';
const MINIMAX_API_KEY = 'sk-cp-REq0jYvrzI5bbP3bc-DqphNMI52N2z9RFVQxr7WFephFOhEAo6UFJk_j68qjksxzuC1MPs0YQOemVvb4pZB-q7nJUYVr-OYHlPssgfT5Iw6S2E9uYtPChhE';
const MODEL_NAME = 'MiniMax-M2.7';

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
        model: MODEL_NAME,
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
- 经验: ${p.xp_spent || 0}
`).join('\n')}

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
  analyzeReplay
};
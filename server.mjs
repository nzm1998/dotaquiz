// ==================== UNIFIED DOTA2 REPLAY SERVER ====================
// Express + multer 统一服务入口
// 导入 server_demo_parse.mjs 的解析函数，提供 REST API

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import {
  parseDemoFile,
  extractMatchId,
  generateVisionReport,
  generateAIVisionReport,
  computeSpatialAnalysis,
  fetchMatchData,
  fetchHeroNameMap,
} from './server_demo_parse.mjs';
import { MINIMAX_API_KEY, MINIMAX_API_URL, MINIMAX_MODEL } from './config/api_keys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Multer config - store .dem files in uploads/
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

// ==================== API Endpoints ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Parse demo - returns summary
app.post('/api/parse-demo', upload.single('demo'), async (req, res) => {
  try {
    let demPath = req.file ? req.file.path : req.body?.filePath;
    if (!demPath) return res.status(400).json({ error: 'No demo file. Upload as "demo" field or send { filePath } JSON.' });
    console.log(`[parse-demo] Parsing: ${demPath}`);
    const result = await parseDemoFile(demPath);

    res.json({
      success: true,
      data: {
        matchInfo: result.matchInfo,
        teamStats: result.teamStats,
        events: {
          totalKills: result.events.kills.length || result.stats.totalKills,
          wardPlacements: result.events.wardPlacements.length,
          totalCombatEvents: result.stats.totalCombatEvents,
        },
        stats: result.stats,
        combatLogSample: result.combatLog.slice(0, 100),
        message: '解析完成',
      },
    });

    if (req.file) { try { fs.unlinkSync(demPath); } catch (e) {} }
  } catch (error) {
    console.error('[parse-demo] Error:', error.message);
    if (req.file) cleanupFile(req.file);
    res.status(500).json({ error: error.message });
  }
});

// Demo trajectory - returns full position data + minimap events
app.post('/api/demo-trajectory', upload.single('demo'), async (req, res) => {
  try {
    let demPath = null;

    if (req.file) {
      demPath = req.file.path;
    } else if (req.body && req.body.filePath) {
      demPath = req.body.filePath;
    }

    if (!demPath) {
      return res.status(400).json({ error: 'No demo file provided' });
    }

    console.log(`[demo-trajectory] Parsing: ${demPath}`);
    const result = await parseDemoFile(demPath);

    res.json({
      success: true,
      data: {
        matchId: result.matchInfo.matchId,
        duration: result.matchInfo.duration,
        radiantWin: result.matchInfo.radiantWin,
        positionHistory: result.positionHistory,
        rawTrajectory: result.rawTrajectory || {},
        combatLog: result.combatLog.slice(0, 500),
        teamStats: result.teamStats,
        stats: result.stats,
        minimapEvents: result.events.minimapEvents || [],
        wardPlacements: result.events.wardPlacements || [],
      },
    });

    if (req.file) {
      try { fs.unlinkSync(demPath); } catch (e) {}
    }
  } catch (error) {
    console.error('[demo-trajectory] Error:', error.message);
    if (req.file) cleanupFile(req.file);
    res.status(500).json({ error: error.message });
  }
});

// Spatial analysis - trajectory + ward heatmap + hero stats + team heatmap
// Supports both: multipart upload AND JSON { filePath } for standalone analysis.html
app.post('/api/spatial-analysis', upload.single('demo'), async (req, res) => {
  try {
    let demPath = null;

    if (req.file) {
      demPath = req.file.path;
    } else if (req.body && req.body.filePath) {
      demPath = req.body.filePath;
    }

    if (!demPath) {
      return res.status(400).json({ error: 'No demo file provided (upload as "demo" field or send { filePath: "..." })' });
    }

    console.log(`[spatial-analysis] Parsing: ${demPath}`);
    const result = await parseDemoFile(demPath);

    // Compute spatial analysis
    console.log(`[spatial-analysis] Computing spatial metrics...`);
    const spatial = computeSpatialAnalysis(result);

    // Sample trajectory data (full data is ~55MB for 88min game)
    const sampledHistory = {};
    const sampledRaw = {};
    if (result.positionHistory) {
      Object.entries(result.positionHistory).forEach(([hero, positions]) => {
        if (!hero || !Array.isArray(positions)) return;
        const interval = Math.max(1, Math.floor(positions.length / 200));
        sampledHistory[hero] = positions.filter((_, i) => i % interval === 0);
      });
    }
    if (result.rawTrajectory) {
      Object.entries(result.rawTrajectory).forEach(([hero, positions]) => {
        if (!hero || !Array.isArray(positions)) return;
        const interval = Math.max(1, Math.floor(positions.length / 100));
        sampledRaw[hero] = positions.filter((_, i) => i % interval === 0);
      });
    }

    res.json({
      success: true,
      data: {
        matchInfo: result.matchInfo,
        teamStats: result.teamStats,
        positionHistory: sampledHistory,
        rawTrajectory: sampledRaw,
        minimapEvents: result.events.minimapEvents || [],
        wardPlacements: result.events.wardPlacements || [],
        combatLogSample: result.combatLog.slice(0, 200),
        spatialAnalysis: spatial,
      },
    });

    console.log(`[spatial-analysis] Complete: ${spatial.summary}`);
    // Only delete temp upload files
    if (req.file) {
      try { fs.unlinkSync(demPath); } catch (e) {}
    }
  } catch (error) {
    console.error('[spatial-analysis] Error:', error.message);
    if (req.file) cleanupFile(req.file);
    res.status(500).json({ error: error.message });
  }
});

// Vision report - OpenDota enriched + AI analysis
app.post('/api/vision-report', upload.single('demo'), async (req, res) => {
  try {
    let demPath = req.file ? req.file.path : req.body?.filePath;
    if (!demPath) return res.status(400).json({ error: 'No demo file. Upload as "demo" field or send { filePath } JSON.' });

    console.log(`[vision-report] Parsing: ${demPath}`);
    const result = await parseDemoFile(demPath);
    const matchId = extractMatchId(demPath);

    if (!matchId) {
      if (req.file) { try { fs.unlinkSync(demPath); } catch (e) {} }
      return res.status(400).json({ error: 'Cannot extract match ID from filename. Use format: 8820791846.dem' });
    }

    console.log(`[vision-report] Getting OpenDota data for match ${matchId}...`);
    const visionData = await generateVisionReport(result, matchId);
    const aiReport = await generateAIVisionReport(visionData);

    res.json({
      success: true,
      data: { ...visionData, aiAnalysis: aiReport },
    });

    if (req.file) { try { fs.unlinkSync(demPath); } catch (e) {} }
  } catch (error) {
    console.error('[vision-report] Error:', error.message);
    if (req.file) cleanupFile(req.file);
    res.status(500).json({ error: error.message });
  }
});

// Analyze by match ID - server-side MiniMax call (方案A)
app.post('/api/analyze-match', async (req, res) => {
  try {
    const { matchId } = req.body;
    if (!matchId || !/^\d+$/.test(String(matchId))) {
      return res.status(400).json({ error: 'Invalid match ID' });
    }

    console.log(`[analyze-match] Fetching OpenDota data for ${matchId}...`);
    const matchData = await fetchMatchData(matchId);
    if (!matchData || matchData.error) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Build hero name map
    const heroMap = await fetchHeroNameMap();

    // Build players data
    const players = (matchData.players || []).map(p => ({
      account_id: p.account_id,
      player_slot: p.player_slot,
      team: p.player_slot < 128 ? 'radiant' : 'dire',
      hero_id: p.hero_id,
      hero_name: heroMap[p.hero_id] || `Hero_${p.hero_id}`,
      personaname: p.personaname || 'Unknown',
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      assists: p.assists || 0,
      gold_spent: p.gold_spent || 0,
      xp_spent: p.xp_spent || 0,
      level: p.level || 0,
      net_worth: p.net_worth || 0,
    }));

    const matchInfo = {
      match_id: matchData.match_id,
      duration: matchData.duration,
      radiant_win: matchData.radiant_win,
    };

    const overview = `天辉 ${matchData.radiant_kills || 0} : ${matchData.dire_kills || 0} 夜魇，` +
      `时长 ${Math.floor(matchData.duration / 60)}分${matchData.duration % 60}秒`;

    // Build AI prompt and call MiniMax
    const prompt = buildMatchAnalysisPrompt(matchInfo, players, overview);

    console.log(`[analyze-match] Calling MiniMax AI...`);
    const aiReport = await callMiniMax(prompt, '你是一个专业的 Dota2 战术分析师，擅长分析比赛录像数据。回答时只输出 JSON，不要有其他内容。');

    res.json({
      success: true,
      data: { matchInfo, players, overview, aiReport },
    });
  } catch (error) {
    console.error('[analyze-match] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AI Helper Functions ====================

function buildMatchAnalysisPrompt(matchInfo, players, overview) {
  const radiantPlayers = players.filter(p => p.team === 'radiant');
  const direPlayers = players.filter(p => p.team === 'dire');

  return `请分析以下 Dota2 比赛数据，生成一份专业的复盘报告。

## 比赛基本信息
- 比赛ID: ${matchInfo.match_id}
- 比赛时长: ${Math.floor(matchInfo.duration / 60)}分${matchInfo.duration % 60}秒
- 结果: 天辉${matchInfo.radiant_win ? '胜利' : '失败'}

## 天辉阵容
${radiantPlayers.map(p => `- ${p.personaname} (${p.hero_name}): KDA ${p.kills}/${p.deaths}/${p.assists}, 经济 ${p.net_worth}, 等级 ${p.level}`).join('\n')}

## 夜魇阵容
${direPlayers.map(p => `- ${p.personaname} (${p.hero_name}): KDA ${p.kills}/${p.deaths}/${p.assists}, 经济 ${p.net_worth}, 等级 ${p.level}`).join('\n')}

## 比赛概述
${overview}

## 分析要求
请生成 JSON 格式复盘报告：
{
  "summary": "比赛概述（2-3句话）",
  "lineupAnalysis": "阵容分析",
  "playerAnalysis": [{"player": "选手名", "hero": "英雄", "behavior": "行为分析", "rating": 8.5}],
  "teamRhythm": "团队节奏分析",
  "winFactors": ["因素1", "因素2", "因素3"],
  "radiantSuggestions": ["建议1", "建议2"],
  "direSuggestions": ["建议1", "建议2"],
  "keyMoments": [{"time": "时间点", "event": "事件描述", "impact": "影响"}]
}`;
}

async function callMiniMax(prompt, systemPrompt) {
  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${err}`);
  }

  const result = await response.json();
  let rawText = '';
  if (Array.isArray(result.content)) {
    const textItem = result.content.find(t => t.type === 'text');
    rawText = textItem?.text || '';
  } else if (typeof result.content === 'string') {
    rawText = result.content;
  }

  rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return { summary: rawText || 'AI 分析完成' };
}

// ==================== Helpers ====================

function cleanupFile(file) {
  if (file && file.path) {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) {}
  }
}

// ==================== Start Server ====================

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Dota2 Replay Server running on http://localhost:${PORT}`);
  console.log(`  POST /api/parse-demo        - 解析demo摘要`);
  console.log(`  POST /api/demo-trajectory   - 轨迹 + 眼位事件`);
  console.log(`  POST /api/spatial-analysis  - 轨迹 + 空间分析（热力图）`);
  console.log(`  POST /api/vision-report     - 眼位报告 + AI分析`);
  console.log(`  POST /api/analyze-match     - 比赛ID AI复盘`);
  console.log(`  GET  /api/health            - 健康检查`);
});

export default app;

// ==================== REPLAY MODULE ====================
// OpenDota API 公开接口，浏览器端直接调用
// 注意：私有 API key 应配置在服务器端 (config/api_keys.js)

const OPENDOTA_API = 'https://api.opendota.com/api';
const SERVER_API = 'http://localhost:3000';

let replayInitialized = false;
let heroNameMap = {};
let selectedMatches = [];
let allMatches = [];
let matchDataMap = {};
let currentFilters = { obs: true, sen: true };
let playerFilter = new Set();
let displayMode = 'global';
let matchDataCache = {};

async function initReplay() {
  if (replayInitialized) return;
  replayInitialized = true;

  const app = document.getElementById('replay-screen');
  app.innerHTML = `
    <div class="replay-container">
      <header class="replay-header">
        <h1 class="replay-header-title">🎬 录像解析复盘</h1>
        <p class="replay-header-subtitle">上传比赛或输入比赛 ID，AI 生成专业复盘报告</p>
      </header>

      <div class="replay-input-section">
        <div class="replay-card">
          <div class="replay-card-header">
            <span class="replay-card-icon">🔍</span>
            <span class="replay-card-title">通过比赛 ID 分析</span>
          </div>
          <div class="replay-input-group">
            <input type="text" id="matchIdInput" class="replay-input" placeholder="输入 Dota2 比赛 ID (如 3827416321)" maxlength="20">
            <button class="replay-btn" id="analyzeByIdBtn" onclick="analyzeByMatchId()">
              <span>🔍</span> 分析
            </button>
          </div>
          <div class="replay-hint">
            <span>💡 提示：比赛 ID 可在 Steam 比赛历史或 OpenDota 中找到</span>
          </div>
        </div>

        <div class="replay-card">
          <div class="replay-card-header">
            <span class="replay-card-icon">📁</span>
            <span class="replay-card-title">上传本地录像</span>
          </div>
          <div class="replay-upload-area" id="uploadArea">
            <div class="replay-upload-icon">📤</div>
            <div class="replay-upload-text">拖拽 .dem 文件到此处或点击选择</div>
            <div class="replay-upload-hint">自动提取比赛 ID（需先启动解析服务器 node server.js）</div>
            <input type="file" id="demFileInput" class="replay-upload-input" accept=".dem">
          </div>
        </div>

        <div class="replay-card">
          <div class="replay-card-header">
            <span class="replay-card-icon">👥</span>
            <span class="replay-card-title">战队分析</span>
          </div>
          <div class="replay-input-group">
            <input type="text" id="teamSearchInput" class="replay-input" placeholder="输入战队名称 (如 XG, Spirit)" maxlength="50">
            <button class="replay-btn" id="teamSearchBtn" onclick="window.searchTeamDirect()">
              <span>🔍</span> 搜索
            </button>
          </div>
          <div class="replay-hint">
            <span>💡 查看战队近期比赛的眼位叠加数据</span>
          </div>
        </div>
      </div>

      <div id="teamResultsSection" style="display:none"></div>
      <div id="teamLoading" class="replay-loading" style="display:none"></div>
      <div id="teamError" class="replay-error" style="display:none"></div>

      <div id="teamAnalysisArea" style="display:none" class="team-analysis-area">
        <div class="team-map-section">
          <div class="team-map-header">
            <div class="team-map-stats">
              <div class="team-map-stat obs">
                <div class="tms-num" id="totalObs">0</div>
                <div class="tms-label">Observer</div>
              </div>
              <div class="team-map-stat sen">
                <div class="tms-num" id="totalSen">0</div>
                <div class="tms-label">Sentry</div>
              </div>
            </div>
            <div class="team-map-controls">
              <button class="team-filter-btn active" id="btnObs" onclick="window.toggleWardFilter('obs')">
                <span style="color:#ffd700">●</span> OBS
              </button>
              <button class="team-filter-btn active" id="btnSen" onclick="window.toggleWardFilter('sen')">
                <span style="color:#4a9eff">●</span> SEN
              </button>
            </div>
          </div>
          <div class="team-canvas-wrap">
            <canvas id="teamMapCanvas" width="600" height="600" style="display:block;"></canvas>
            <div class="team-time-slider-row">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="font-size:0.7rem;color:#888;">显示：</span>
                <button class="team-filter-btn" id="btnHeatmap" onclick="window.toggleHeatmap()">
                  🗺️ 热力图
                </button>
              </div>
              <input type="range" id="timeRangeSlider" min="1" max="70" value="70" style="width:100%;" oninput="window.applyTimeFilter(this.value)">
              <div id="timeRangeLabel" style="font-size:0.7rem;color:#ffd700;text-align:center;margin-top:2px;">全程</div>
            </div>
          </div>
          <div class="team-analysis-controls">
            <div class="tac-row">
              <span style="font-size:0.75rem;color:#888">选手筛选</span>
            </div>
            <div id="playerFilterPanel" class="player-filter-panel" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            </div>
            <div class="tac-row" style="margin-top:8px;">
              <span style="font-size:0.7rem;color:#888">显示模式：</span>
              <button id="btnGlobal" class="pf-checkbox active" onclick="window.setDisplayMode('global')">全局</button>
              <button id="btnRealtime" class="pf-checkbox" onclick="window.setDisplayMode('realtime')">实时</button>
            </div>
          </div>
        </div>
        <div class="team-right-panel">
          <div class="team-panel-back" onclick="window.backToMatchList()">← 返回比赛列表</div>
          <div id="teamStatsPanel"></div>
        </div>
      </div>

      <div class="replay-loading" id="replayLoading" style="display: none;">
        <div class="replay-loading-spinner"></div>
        <div class="replay-loading-text" id="loadingText">正在获取比赛数据...</div>
      </div>

      <div class="replay-error" id="replayError" style="display: none;">
        <div class="replay-error-icon">❌</div>
        <div class="replay-error-text" id="errorText"></div>
        <button class="replay-btn-secondary" onclick="retryAnalysis()">重试</button>
      </div>

      <div class="replay-result" id="replayResult" style="display: none;"></div>
    </div>
  `;

  setupUploadArea();
  window.initTeamModule && window.initTeamModule();
}

function setupUploadArea() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('demFileInput');

  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => {
    if (!fileInput.disabled) {
      fileInput.click();
    }
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleDemUpload(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleDemUpload(e.target.files[0]);
    }
  });
}

function updateLoadingText(text) {
  const el = document.getElementById('loadingText');
  if (el) el.textContent = text;
}

function showLoading() {
  document.getElementById('replayLoading').style.display = 'flex';
  document.getElementById('replayError').style.display = 'none';
  document.getElementById('replayResult').style.display = 'none';
}

function showError(message) {
  document.getElementById('replayLoading').style.display = 'none';
  document.getElementById('replayError').style.display = 'flex';
  document.getElementById('errorText').textContent = message;
  document.getElementById('replayResult').style.display = 'none';
}

function showResult() {
  document.getElementById('replayLoading').style.display = 'none';
  document.getElementById('replayError').style.display = 'none';
  document.getElementById('replayResult').style.display = 'block';
}

async function analyzeByMatchId() {
  const input = document.getElementById('matchIdInput');
  const matchId = input.value.trim();

  if (!matchId) {
    showError('请输入比赛 ID');
    return;
  }

  if (!/^\d+$/.test(matchId)) {
    showError('比赛 ID 必须是数字');
    return;
  }

  showLoading();
  updateLoadingText('正在获取比赛数据...');

  try {
    // Use server-side endpoint (avoids API key exposure)
    const response = await fetch(`${SERVER_API}/api/analyze-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `服务器错误: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) throw new Error(result.error || '分析失败');

    renderAnalysisReport(result.data.aiReport, result.data);
    showResult();
  } catch (error) {
    showError(error.message || '分析失败，请重试');
  }
}

async function loadMatchData(matchId) {
  // Load hero name map first
  await loadHeroNameMap();

  const response = await fetch(`${OPENDOTA_API}/matches/${matchId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('未找到该比赛，请检查 ID 是否正确');
    }
    throw new Error('获取比赛数据失败，请稍后重试');
  }

  const data = await response.json();

  // Build players data - resolve hero names
  const players = [];
  for (const p of (data.players || [])) {
    players.push({
      account_id: p.account_id,
      player_slot: p.player_slot,
      team: p.player_slot < 128 ? 'radiant' : 'dire',
      hero_id: p.hero_id,
      hero_name: heroNameMap[p.hero_id] || `Hero_${p.hero_id}`,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      gold_spent: p.gold_spent || 0,
      xp_spent: p.xp_spent || 0,
      level: p.level || 0,
      net_worth: p.net_worth || 0
    });
  }

  return {
    matchInfo: {
      match_id: data.match_id,
      duration: data.duration,
      lobby_type: data.lobby_type,
      radiant_win: data.radiant_win,
      radiant_gold_advantage: data.radiant_gold_advantage,
      radiant_xp_advantage: data.radiant_xp_advantage
    },
    players,
    overview: buildOverview(data)
  };
}

function buildOverview(data) {
  const radiantKills = (data.players || [])
    .filter(p => p.player_slot < 128)
    .reduce((sum, p) => sum + (p.kills || 0), 0);

  const direKills = (data.players || [])
    .filter(p => p.player_slot >= 128)
    .reduce((sum, p) => sum + (p.kills || 0), 0);

  return `天辉 ${radiantKills} : ${direKills} 夜魇，比赛时长 ${Math.floor(data.duration / 60)}分${data.duration % 60}秒。` +
    `经济优势：天辉 ${data.radiant_gold_advantage || 0}，经验优势：${data.radiant_xp_advantage || 0}`;
}

function renderAnalysisReport(report, matchData) {
  const container = document.getElementById('replayResult');

  const keyMoments = report.keyMoments || [];
  const playerAnalysis = report.playerAnalysis || [];
  const matchInfo = matchData?.matchInfo || {};
  const players = matchData?.players || [];
  const overview = matchData?.overview || '';

  const keyMomentsHtml = keyMoments
    .map(m => `
      <div class="moment-item">
        <span class="moment-time">${escapeHtml(m.time || '')}</span>
        <span class="moment-event">${escapeHtml(m.event || '')}</span>
        <span class="moment-impact">${escapeHtml(m.impact || '')}</span>
      </div>
    `).join('') || '<div class="empty">暂无关键事件数据</div>';

  const playerAnalysisHtml = playerAnalysis
    .map(p => `
      <div class="player-card">
        <div class="player-header">
          <span class="player-name">${escapeHtml(p.player || '未知')}</span>
          <span class="player-hero">${escapeHtml(p.hero || '')}</span>
          <span class="player-rating">评分 ${p.rating || '?'}/10</span>
        </div>
        <div class="player-behavior">${escapeHtml(p.behavior || '')}</div>
      </div>
    `).join('') || '<div class="empty">暂无选手分析数据</div>';

  // Players summary table
  const playersTableHtml = players.map(p => `
    <tr>
      <td style="color:${p.team === 'radiant' ? '#00d4aa' : '#e94560'}">${p.team === 'radiant' ? '天辉' : '夜魇'}</td>
      <td>${escapeHtml(p.personaname || 'Unknown')}</td>
      <td><strong>${escapeHtml(p.hero_name || '')}</strong></td>
      <td>${p.kills}/${p.deaths}/${p.assists}</td>
      <td>Lv${p.level}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="report-header">
      <h2 class="report-title">📊 AI 复盘报告</h2>
      <button class="report-back-btn" onclick="backToReplay()">← 重新分析</button>
    </div>

    <div class="report-summary">
      <div class="report-section-title">📋 比赛概述</div>
      <div class="report-content">${escapeHtml(report.summary || overview || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">👥 选手数据</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead><tr style="color:#666;border-bottom:1px solid #252540">
            <th>阵营</th><th>选手</th><th>英雄</th><th>K/D/A</th><th>等级</th>
          </tr></thead>
          <tbody>${playersTableHtml}</tbody>
        </table>
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">⚔️ 阵容分析</div>
      <div class="report-content">${escapeHtml(report.lineupAnalysis || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">🎯 选手行为路径</div>
      <div class="player-analysis-grid">
        ${playerAnalysisHtml}
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">📈 团队节奏</div>
      <div class="report-content">${escapeHtml(report.teamRhythm || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">🏆 胜负因素</div>
      <ul class="win-factors-list">
        ${(report.winFactors || []).map(f => `<li>${escapeHtml(f)}</li>`).join('') || '<li>暂无数据</li>'}
      </ul>
    </div>

    <div class="report-suggestions">
      <div class="suggestion-card radiant">
        <div class="suggestion-title">🌟 天辉队伍建议</div>
        <ul class="suggestion-list">
          ${(report.radiantSuggestions || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>暂无建议</li>'}
        </ul>
      </div>
      <div class="suggestion-card dire">
        <div class="suggestion-title">🌙 夜魇队伍建议</div>
        <ul class="suggestion-list">
          ${(report.direSuggestions || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>暂无建议</li>'}
        </ul>
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">⏱️ 关键时刻</div>
      <div class="moments-timeline">
        ${keyMomentsHtml}
      </div>
    </div>
  `;
}

function backToReplay() {
  document.getElementById('replayResult').style.display = 'none';
  document.getElementById('replayLoading').style.display = 'none';
  document.getElementById('replayError').style.display = 'none';
}

function retryAnalysis() {
  const matchId = document.getElementById('matchIdInput').value.trim();
  if (matchId) {
    document.getElementById('matchIdInput').value = matchId;
    analyzeByMatchId();
  } else {
    document.getElementById('replayError').style.display = 'none';
  }
}

async function handleDemUpload(file) {
  if (!file.name.endsWith('.dem')) {
    showError('请上传 .dem 格式的录像文件');
    return;
  }

  showLoading();
  updateLoadingText('正在上传录像文件...');

  try {
    const matchId = file.name.replace('.dem', '').replace(/.*\//, '');
    if (!/^\d+$/.test(matchId)) {
      showError('无法从文件名提取比赛 ID，请手动输入比赛 ID 进行分析');
      return;
    }

    document.getElementById('matchIdInput').value = matchId;

    // Upload once via FormData - get spatial analysis (trajectory + heatmap + minimap)
    const formData = new FormData();
    formData.append('demo', file);

    updateLoadingText(`已提取比赛 ID: ${matchId}，正在解析录像（约需 30 秒）...`);

    const res = await fetch(`${SERVER_API}/api/spatial-analysis`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `服务器错误 (${res.status})`);
    }

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || '录像解析失败');
    }

    updateLoadingText('解析完成，正在生成报告...');

    // Store spatial data for map view
    window._lastSpatialData = result.data;

    // Render spatial report (ward heatmap + hero trajectories + lane presence)
    renderSpatialReport(result.data);
    showResult();

    // Try AI vision report in background (uses match ID, no re-upload needed)
    tryVisionReport(matchId);

  } catch (error) {
    console.warn('解析出错:', error.message);
    showError(error.message || '无法解析录像文件。请确保已启动解析服务器 (node server.mjs)，或直接输入比赛 ID 进行分析。');
  }
}

// 后台获取 AI 眼位报告，不阻塞空间分析结果展示
async function tryVisionReport(matchId) {
  try {
    const res = await fetch(`${SERVER_API}/api/analyze-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    });

    if (!res.ok) return;
    const result = await res.json();
    if (!result.success || !result.data || !result.data.aiReport) return;

    // Insert AI analysis section into existing report
    const container = document.getElementById('replayResult');
    if (!container) return;
    const section = document.createElement('div');
    section.innerHTML = `
      <div class="report-section" style="margin-top:20px">
        <div class="report-section-title">🤖 AI 战术分析</div>
        <div class="report-content">
          <p>${escapeHtml(result.data.aiReport.summary || '')}</p>
          <p><strong>阵容分析：</strong>${escapeHtml(result.data.aiReport.lineupAnalysis || '')}</p>
          <p><strong>团队节奏：</strong>${escapeHtml(result.data.aiReport.teamRhythm || '')}</p>
          ${(result.data.aiReport.winFactors || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </div>
      </div>
    `;
    container.appendChild(section);
  } catch (e) {
    console.warn('AI analysis unavailable:', e.message);
  }
}

function renderVisionReport(report, visionData, spatialData) {
  const container = document.getElementById('replayResult');

  const heroContrib = report.heroContribution || [];
  const radiantSuggs = report.radiantSuggestions || [];
  const direSuggs = report.direSuggestions || [];
  const keyMoments = report.keyMoments || [];

  const heroContribHtml = heroContrib.map(h => `
    <div class="player-card">
      <div class="player-header">
        <span class="player-name">${escapeHtml(h.player || '')}</span>
        <span class="player-hero">${escapeHtml(h.hero || '')}</span>
        <span class="player-rating">贡献评分 ${h.rating || '?'}/10</span>
      </div>
      <div class="player-behavior">${escapeHtml(h.contribution || '')}</div>
    </div>
  `).join('') || '<div class="empty">暂无英雄贡献数据</div>';

  const keyMomentsHtml = keyMoments.map(m => `
    <div class="moment-item">
      <span class="moment-time">${escapeHtml(m.time || '')}</span>
      <span class="moment-event">${escapeHtml(m.event || '')}</span>
      <span class="moment-impact">${escapeHtml(m.impact || '')}</span>
    </div>
  `).join('') || '<div class="empty">暂无关键时刻数据</div>';

  // Spatial analysis summary
  let spatialSummaryHtml = '';
  if (spatialData && spatialData.spatialAnalysis) {
    const sa = spatialData.spatialAnalysis;
    const wardHm = sa.wardHeatmap;
    const heroStats = sa.heroStats;

    spatialSummaryHtml = `
      <div class="report-section">
        <div class="report-section-title">🗺️ 空间数据分析</div>
        <div class="report-content">
          <p>${escapeHtml(sa.summary || '')}</p>
          ${wardHm ? `
          <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:#0d0d14;padding:12px;border-radius:6px">
              <strong>👁️ 眼位热力</strong>
              <p style="font-size:0.8rem;color:#888">Observer: ${wardHm.totalObs} | Sentry: ${wardHm.totalSen}</p>
              <p style="font-size:0.8rem;color:#888">热点区域: ${wardHm.hotSpots ? wardHm.hotSpots.length : 0} 个</p>
            </div>
            ${heroStats ? `
            <div style="background:#0d0d14;padding:12px;border-radius:6px">
              <strong>🏃 英雄轨迹</strong>
              <p style="font-size:0.8rem;color:#888">${Object.keys(heroStats).length} 个英雄已分析</p>
              <p style="font-size:0.8rem;color:#888;max-height:80px;overflow-y:auto">
                ${Object.entries(heroStats).slice(0, 5).map(([h, s]) => {
                  const top = Object.entries(s.lanePresence || {}).sort((a, b) => (b[1].percentage || 0) - (a[1].percentage || 0))[0];
                  return `${h}: ${top ? top[0] + ' ' + (top[1].percentage || 0) + '%' : 'N/A'}`;
                }).join('<br>')}
              </p>
            </div>
            ` : ''}
          </div>
          ` : ''}
          <button class="replay-btn" onclick="openMapView()" style="margin-top:12px">🗺️ 打开地图可视化</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="report-header">
      <h2 class="report-title">👁️ AI 眼位分析报告</h2>
      <button class="report-back-btn" onclick="backToReplay()">← 重新分析</button>
    </div>

    <div class="report-summary">
      <div class="report-section-title">📋 比赛信息</div>
      <div class="report-content">${escapeHtml(report.overallVision || report.summary || visionData?.summary || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">⚔️ 胜负因素</div>
      <div class="report-content">${escapeHtml(report.winFactor || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">🛡️ 天辉队伍眼位策略</div>
      <div class="report-content">${escapeHtml(report.radiantStrategy || '无')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">💀 夜魇队伍眼位策略</div>
      <div class="report-content">${escapeHtml(report.direStrategy || '无')}</div>
    </div>

    ${spatialSummaryHtml}

    <div class="report-section">
      <div class="report-section-title">🎯 英雄眼位贡献</div>
      <div class="player-analysis-grid">
        ${heroContribHtml}
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">⏱️ 关键时刻</div>
      <div class="moments-timeline">
        ${keyMomentsHtml}
      </div>
    </div>

    <div class="report-suggestions">
      <div class="suggestion-card radiant">
        <div class="suggestion-title">🌟 天辉队伍建议</div>
        <ul class="suggestion-list">
          ${radiantSuggs.map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>暂无建议</li>'}
        </ul>
      </div>
      <div class="suggestion-card dire">
        <div class="suggestion-title">🌙 夜魇队伍建议</div>
        <ul class="suggestion-list">
          ${direSuggs.map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>暂无建议</li>'}
        </ul>
      </div>
    </div>
  `;
}

// Spatial-only report when AI is unavailable
function renderSpatialReport(spatialData) {
  const container = document.getElementById('replayResult');
  const sa = spatialData.spatialAnalysis || {};
  const wardHm = sa.wardHeatmap || {};
  const heroStats = sa.heroStats || {};

  const heroRows = Object.entries(heroStats).map(([hero, s]) => {
    const topZones = Object.entries(s.lanePresence || {})
      .sort((a, b) => (b[1].percentage || 0) - (a[1].percentage || 0))
      .slice(0, 3);
    return `
      <div class="player-card">
        <div class="player-header">
          <span class="player-name">${escapeHtml(hero)}</span>
          <span class="player-hero">${s.totalTimeSec ? Math.floor(s.totalTimeSec / 60) + '分' : ''}</span>
          <span class="player-rating">转线 ${s.rotations?.count || 0} 次</span>
        </div>
        <div class="player-behavior">
          ${topZones.map(([z, p]) => `${z}: ${p.percentage || 0}%`).join(' | ')}
        </div>
      </div>
    `;
  }).join('') || '<div class="empty">暂无轨迹数据</div>';

  const hotSpotRows = (wardHm.hotSpots || []).slice(0, 10).map(h => `
    <div class="moment-item">
      <span class="moment-time">(${h.worldCenterX?.toFixed(0) || '?'}, ${h.worldCenterY?.toFixed(0) || '?'})</span>
      <span class="moment-event">${h.totalCount} 个眼位</span>
      <span class="moment-impact">密度 ${(h.density * 100).toFixed(0)}%</span>
    </div>
  `).join('') || '<div class="empty">暂无热点数据</div>';

  container.innerHTML = `
    <div class="report-header">
      <h2 class="report-title">🗺️ 空间分析报告</h2>
      <button class="report-back-btn" onclick="backToReplay()">← 重新分析</button>
    </div>

    <div class="report-summary">
      <div class="report-section-title">📋 分析摘要</div>
      <div class="report-content">${escapeHtml(sa.summary || '空间分析完成')}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">👁️ 眼位热点 (Top 10)</div>
      <div class="moments-timeline">${hotSpotRows}</div>
    </div>

    <div class="report-section">
      <div class="report-section-title">⏱️ 眼位时间分布</div>
      <div class="report-content">
        ${(wardHm.temporalBuckets || []).map(b =>
          `<div style="margin:4px 0;font-size:0.8rem">${b.bucket}: 🔵${b.obsCount} 🟡${b.senCount}</div>`
        ).join('')}
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">🏃 英雄活动分析</div>
      <div class="player-analysis-grid">${heroRows}</div>
    </div>

    <div style="text-align:center;padding:20px">
      <button class="replay-btn" onclick="openMapView()">🗺️ 打开完整地图可视化</button>
    </div>
  `;
}

// Open analysis.html with the stored spatial data
function openMapView() {
  const data = window._lastSpatialData;
  if (!data) {
    showError('暂无空间数据，请先上传 .dem 文件');
    return;
  }
  // Store data in sessionStorage so analysis.html can access it
  sessionStorage.setItem('spatialData', JSON.stringify(data));
  window.open('analysis.html', '_blank');
}

// 临时英雄名称映射
const heroNameCache = {};

async function loadHeroNameMap() {
  if (Object.keys(heroNameMap).length > 0) return;
  try {
    const res = await fetch(`${OPENDOTA_API}/heroes`);
    if (res.ok) {
      const heroes = await res.json();
      heroes.forEach(h => {
        heroNameMap[h.id] = h.name_localized || h.name.replace('npc_dota_hero_', '');
      });
    }
  } catch (e) {
    console.warn('Failed to load hero name map:', e);
  }
}

async function getHeroName(heroId) {
  if (heroNameMap[heroId]) return heroNameMap[heroId];

  // Fallback: try heroes_knowledge.json
  try {
    const res = await fetch('heroes_knowledge.json');
    if (res.ok) {
      const data = await res.json();
      const key = `npc_dota_hero_${heroId}`;
      if (data.heroes && data.heroes[key]) {
        return data.heroes[key].name;
      }
    }
  } catch (e) {}

  return `Hero_${heroId}`;
}

function getItemName(itemId) {
  // 简化处理
  return `物品_${itemId}`;
}

// XSS protection
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose init function globally
window.initReplay = initReplay;
window.analyzeByMatchId = analyzeByMatchId;
window.backToReplay = backToReplay;
window.retryAnalysis = retryAnalysis;
window.openMapView = openMapView;
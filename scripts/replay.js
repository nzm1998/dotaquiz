// ==================== REPLAY MODULE ====================
const OPENDOTA_API = 'https://api.opendota.com/api';

let replayInitialized = false;
let heroNameMap = {};

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
            <span class="replay-badge">即将推出</span>
          </div>
          <div class="replay-upload-area" id="uploadArea">
            <div class="replay-upload-icon">📤</div>
            <div class="replay-upload-text">拖拽 .dem 文件到此处或点击选择</div>
            <div class="replay-upload-hint">支持 .dem 格式文件（方案B/C支持）</div>
            <input type="file" id="demFileInput" class="replay-upload-input" accept=".dem" disabled>
          </div>
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
    const matchData = await loadMatchData(matchId);
    updateLoadingText('正在生成 AI 分析报告...');
    const report = await generateAnalysis(matchData);
    renderAnalysisReport(report);
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

async function generateAnalysis(matchData) {
  if (!window.ReplayAgent || !window.ReplayAgent.analyzeReplay) {
    throw new Error('AI 分析模块未加载');
  }
  return await window.ReplayAgent.analyzeReplay(matchData);
}

function renderAnalysisReport(report) {
  const container = document.getElementById('replayResult');

  const keyMoments = Array.isArray(report.keyMoment) ? report.keyMoment : (report.keyMoments || []);
  const playerAnalysis = report.playerAnalysis || [];

  const keyMomentsHtml = (report.keyMoments || [])
    .map(m => `
      <div class="moment-item">
        <span class="moment-time">${escapeHtml(m.time || '')}</span>
        <span class="moment-event">${escapeHtml(m.event || '')}</span>
        <span class="moment-impact">${escapeHtml(m.impact || '')}</span>
      </div>
    `).join('') || '<div class="empty">暂无关键事件数据</div>';

  const playerAnalysisHtml = (report.playerAnalysis || [])
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

  container.innerHTML = `
    <div class="report-header">
      <h2 class="report-title">📊 AI 复盘报告</h2>
      <button class="report-back-btn" onclick="backToReplay()">← 重新分析</button>
    </div>

    <div class="report-summary">
      <div class="report-section-title">📋 比赛概述</div>
      <div class="report-content">${escapeHtml(report.summary || '无')}</div>
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
      <div class="report-section-title">👁️ 眼位分析</div>
      <div class="report-content">${escapeHtml(report.visionAnalysis || '暂无眼位数据（方案B/C支持）')}</div>
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

function handleDemUpload(file) {
  showError('本地 .dem 文件解析功能正在开发中（方案B/C）。请先使用比赛 ID 进行分析。');
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
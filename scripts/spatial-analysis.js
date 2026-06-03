// ==================== SPATIAL ANALYSIS BRIDGE ====================
// 在 SPA 复盘页面中嵌入空间分析预览
// 提供数据桥接：SPA → sessionStorage → analysis.html

(function () {
  'use strict';

  /**
   * 为复盘报告渲染空间分析摘要卡片
   * @param {HTMLElement} container - 要插入摘要的容器
   * @param {Object} spatialData - 来自 /api/spatial-analysis 的数据
   */
  function renderSummaryCard(container, spatialData) {
    if (!container || !spatialData) return;

    const sa = spatialData.spatialAnalysis || {};
    const wardHm = sa.wardHeatmap || {};
    const heroStats = sa.heroStats || {};

    const hotSpotCount = (wardHm.hotSpots || []).length;
    const heroCount = Object.keys(heroStats).length;

    // Top hero zones
    const heroSummaries = Object.entries(heroStats).slice(0, 5).map(([hero, s]) => {
      const top = Object.entries(s.lanePresence || {})
        .sort((a, b) => (b[1].percentage || 0) - (a[1].percentage || 0))[0];
      return `<span style="display:inline-block;margin:2px 6px;font-size:0.8rem">
        <strong>${escapeHtml(hero)}</strong>: ${top ? top[0] : 'N/A'} ${top ? (top[1].percentage || 0) + '%' : ''}
      </span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'report-section';
    card.innerHTML = `
      <div class="report-section-title">🗺️ 空间分析摘要</div>
      <div class="report-content">
        <p>${escapeHtml(sa.summary || '分析完成')}</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0">
          <div style="background:#0d0d14;padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.2rem;color:#4a9eff">${wardHm.totalObs || 0}</div>
            <div style="font-size:0.7rem;color:#666">Observer</div>
          </div>
          <div style="background:#0d0d14;padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.2rem;color:#ffcc00">${wardHm.totalSen || 0}</div>
            <div style="font-size:0.7rem;color:#666">Sentry</div>
          </div>
          <div style="background:#0d0d14;padding:10px;border-radius:6px;text-align:center">
            <div style="font-size:1.2rem;color:#f0a500">${hotSpotCount}</div>
            <div style="font-size:0.7rem;color:#666">热点区域</div>
          </div>
        </div>
        <div style="margin-top:8px">${heroSummaries}</div>
        <button class="replay-btn" onclick="window.openMapView()" style="margin-top:12px">🗺️ 打开完整地图</button>
      </div>
    `;
    container.appendChild(card);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Export to global scope
  window.SpatialBridge = { renderSummaryCard };
})();

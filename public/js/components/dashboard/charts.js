/**
 * Dashboard Charts Module
 * 职责：使用 Chart.js 渲染配额分布图和使用趋势图
 *
 * 调用时机：
 *   - dashboard 组件 init() 时初始化图表
 *   - 筛选器变化时更新图表数据
 *   - $store.data 更新时刷新图表
 *
 * 图表类型：
 *   1. Quota Distribution（饼图）：按模型家族或具体模型显示配额分布
 *   2. Usage Trend（折线图）：显示历史使用趋势
 *
 * 特殊处理：
 *   - 使用 _trendChartUpdateLock 防止并发更新导致的竞争条件
 *   - 通过 debounce 优化频繁更新的性能
 *   - 响应式处理：移动端自动调整图表大小和标签显示
 *
 * @module DashboardCharts
 */
window.DashboardCharts = window.DashboardCharts || {};

// Helper to get CSS variable values (alias to window.utils.getThemeColor)
const getThemeColor = (name) => window.utils.getThemeColor(name);

// Color palette for different families and models
const FAMILY_COLORS = {
  get claude() {
    return getThemeColor("--color-primary");
  },
  get gemini() {
    return getThemeColor("--color-neon-green");
  },
  get other() {
    return getThemeColor("--color-neon-cyan");
  },
};

const MODEL_COLORS = Array.from({ length: 16 }, (_, i) =>
  getThemeColor(`--color-chart-${i + 1}`)
);

// Export constants for filter module
window.DashboardConstants = { FAMILY_COLORS, MODEL_COLORS };

// Module-level lock to prevent concurrent chart updates (fixes race condition)
let _trendChartUpdateLock = false;

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color string
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} rgba color string
 */
window.DashboardCharts.hexToRgba = function (hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return `rgba(${parseInt(result[1], 16)}, ${parseInt(
      result[2],
      16
    )}, ${parseInt(result[3], 16)}, ${alpha})`;
  }
  return hex;
};

/**
 * Check if canvas is ready for Chart creation
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @returns {boolean} True if canvas is ready
 */
function isCanvasReady(canvas) {
  if (!canvas || !canvas.isConnected) return false;
  if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) return false;

  try {
    const ctx = canvas.getContext("2d");
    return !!ctx;
  } catch (e) {
    return false;
  }
}

/**
 * Create a Chart.js dataset with gradient fill
 * @param {string} label - Dataset label
 * @param {Array} data - Data points
 * @param {string} color - Line color
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {boolean} isComparison - Whether this is a comparison dataset
 * @returns {object} Chart.js dataset configuration
 */
window.DashboardCharts.createDataset = function (label, data, color, canvas, isComparison = false) {
  let gradient;

  try {
    // Safely create gradient with fallback
    if (canvas && canvas.getContext && !isComparison) {
      const ctx = canvas.getContext("2d");
      if (ctx && ctx.createLinearGradient) {
        gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, window.DashboardCharts.hexToRgba(color, 0.12));
        gradient.addColorStop(
          0.6,
          window.DashboardCharts.hexToRgba(color, 0.05)
        );
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
    }
  } catch (e) {
    if (window.UILogger) window.UILogger.debug("Gradient fallback:", e.message);
    gradient = null;
  }

  // Fallback to solid color if gradient creation failed
  const backgroundColor = isComparison 
    ? "rgba(0, 0, 0, 0)" 
    : (gradient || window.DashboardCharts.hexToRgba(color, 0.08));

  return {
    label,
    data,
    borderColor: isComparison ? window.DashboardCharts.hexToRgba(color, 0.4) : color,
    backgroundColor: backgroundColor,
    borderWidth: isComparison ? 1.5 : 2.5,
    borderDash: isComparison ? [5, 5] : [],
    tension: 0.35,
    fill: !isComparison,
    pointRadius: isComparison ? 0 : 2.5,
    pointHoverRadius: 6,
    pointBackgroundColor: color,
    pointBorderColor: "rgba(9, 9, 11, 0.8)",
    pointBorderWidth: 1.5,
  };
};

/**
 * Update quota distribution donut chart
 * @param {object} component - Dashboard component instance
 */
window.DashboardCharts.updateCharts = function (component) {
  const canvas = document.getElementById("quotaChart");

  // Safety checks
  if (!canvas) {
    console.debug("quotaChart canvas not found");
    return;
  }

  // FORCE DESTROY: Check for existing chart on the canvas element property
  // This handles cases where Component state is lost but DOM persists
  if (canvas._chartInstance) {
    console.debug("Destroying existing quota chart from canvas property");
    try {
        canvas._chartInstance.destroy();
    } catch(e) { if (window.UILogger) window.UILogger.debug(e); }
    canvas._chartInstance = null;
  }
  
  // Also check component state as backup
  if (component.charts.quotaDistribution) {
     try {
         component.charts.quotaDistribution.destroy();
     } catch(e) { }
     component.charts.quotaDistribution = null;
  }
  
  // Also try Chart.js registry
  if (typeof Chart !== "undefined" && Chart.getChart) {
      const regChart = Chart.getChart(canvas);
      if (regChart) {
          try { regChart.destroy(); } catch(e) {}
      }
  }

  if (typeof Chart === "undefined") {
    if (window.UILogger) window.UILogger.warn("Chart.js not loaded");
    return;
  }
  if (!isCanvasReady(canvas)) {
    if (window.UILogger) window.UILogger.debug("quotaChart canvas not ready, skipping update");
    return;
  }

  // Use UNFILTERED data for global health chart
  const rows = Alpine.store("data").getUnfilteredQuotaData();
  if (!rows || rows.length === 0) return;

  const healthByFamily = {};
  let totalHealthSum = 0;
  let totalModelCount = 0;

  rows.forEach((row) => {
    const family = row.family || "unknown";
    if (!healthByFamily[family]) {
      healthByFamily[family] = { total: 0, weighted: 0 };
    }

    // Calculate average health from quotaInfo (each entry has { pct })
    // Health = average of all account quotas for this model
    const quotaInfo = row.quotaInfo || [];
    let avgHealth = 0;

    if (quotaInfo.length > 0) {
      avgHealth = quotaInfo.reduce((sum, q) => sum + (q.pct || 0), 0) / quotaInfo.length;
    }
    // If quotaInfo is empty, avgHealth remains 0 (depleted/unknown)

    healthByFamily[family].total++;
    healthByFamily[family].weighted += avgHealth;
    totalHealthSum += avgHealth;
    totalModelCount++;
  });

  // Update overall health for dashboard display
  component.stats.overallHealth = totalModelCount > 0
    ? Math.round(totalHealthSum / totalModelCount)
    : 0;

  const familyColors = {
    claude: getThemeColor("--color-primary") || "#da7756",
    gemini: getThemeColor("--color-neon-green") || "#22c55e",
    unknown: getThemeColor("--color-neon-cyan") || "#06b6d4",
  };

  const data = [];
  const colors = [];
  const labels = [];

  const totalFamilies = Object.keys(healthByFamily).length;
  const segmentSize = 100 / totalFamilies;

  Object.entries(healthByFamily).forEach(([family, { total, weighted }]) => {
    const health = weighted / total;
    const activeVal = (health / 100) * segmentSize;
    const inactiveVal = segmentSize - activeVal;

    const familyColor = familyColors[family] || familyColors["unknown"];

    // Get translation keys
    const store = Alpine.store("global");
    const familyKey =
      "family" + family.charAt(0).toUpperCase() + family.slice(1);
    const familyName = store.t(familyKey);

    // Labels using translations if possible
    const activeLabel =
      family === "claude"
        ? store.t("claudeActive")
        : family === "gemini"
        ? store.t("geminiActive")
        : `${familyName} ${store.t("activeSuffix")}`;

    const depletedLabel =
      family === "claude"
        ? store.t("claudeEmpty")
        : family === "gemini"
        ? store.t("geminiEmpty")
        : `${familyName} ${store.t("depleted")}`;

    // Active segment
    data.push(activeVal);
    colors.push(familyColor);
    labels.push(activeLabel);

    // Inactive segment
    data.push(inactiveVal);
    // Use higher opacity (0.6) to ensure the ring color matches the legend more closely
    // while still differentiating "depleted" from "active" (1.0 opacity)
    colors.push(window.DashboardCharts.hexToRgba(familyColor, 0.6));
    labels.push(depletedLabel);
  });

  // Create Chart
  try {
    const newChart = new Chart(canvas, {
       // ... config
       type: "doughnut",
       data: {
         labels: labels,
         datasets: [
           {
             data: data,
             backgroundColor: colors,
             borderColor: getThemeColor("--color-space-950"),
             borderWidth: 0,
             hoverOffset: 0,
             borderRadius: 0,
           },
         ],
       },
       options: {
         responsive: true,
         maintainAspectRatio: false,
         cutout: "85%",
         rotation: -90,
         circumference: 360,
         plugins: {
           legend: { display: false },
           tooltip: { enabled: false },
           title: { display: false },
         },
         animation: {
           // Disable animation for quota chart to prevent "double refresh" visual glitch
           duration: 0
         },
       },
    });
    
    // SAVE INSTANCE TO CANVAS AND COMPONENT
    canvas._chartInstance = newChart;
    component.charts.quotaDistribution = newChart;
    
  } catch (e) {
    console.error("Failed to create quota chart:", e);
  }
};

/**
 * Update usage trend line chart
 * @param {object} component - Dashboard component instance
 */
window.DashboardCharts.updateTrendChart = function (component) {
  // Prevent concurrent updates (fixes race condition on rapid toggling)
  if (_trendChartUpdateLock) {
    if (window.UILogger) window.UILogger.debug("[updateTrendChart] Update already in progress, skipping");
    return;
  }
  _trendChartUpdateLock = true;

  const logger = window.UILogger || console;
  logger.debug("[updateTrendChart] Starting update...");

  const canvas = document.getElementById("usageTrendChart");
  
  // FORCE DESTROY: Check for existing chart on the canvas element property
  if (canvas) {
      if (canvas._chartInstance) {
        console.debug("Destroying existing trend chart from canvas property");
        try {
            canvas._chartInstance.stop();
            canvas._chartInstance.destroy();
        } catch(e) { if (window.UILogger) window.UILogger.debug(e); }
        canvas._chartInstance = null;
      }
      
      // Also try Chart.js registry
      if (typeof Chart !== "undefined" && Chart.getChart) {
          const regChart = Chart.getChart(canvas);
          if (regChart) {
              try { regChart.stop(); regChart.destroy(); } catch(e) {}
          }
      }
  }

  // Also check component state
  if (component.charts.usageTrend) {
    try {
      component.charts.usageTrend.stop();
      component.charts.usageTrend.destroy();
    } catch (e) { }
    component.charts.usageTrend = null;
  }

  // Safety checks
  if (!canvas || typeof Chart === "undefined" || !isCanvasReady(canvas)) {
    _trendChartUpdateLock = false;
    return;
  }

  // Clear canvas
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  } catch (e) { }

  // Use filtered history data (returns { current, previous })
  const { current, previous } = window.DashboardFilters.getFilteredHistoryData(component);
  const hasCurrent = current && Object.keys(current).length > 0;
  
  if (!hasCurrent) {
    component.hasFilteredTrendData = false;
    _trendChartUpdateLock = false;
    return;
  }

  component.hasFilteredTrendData = true;

  // Sort entries for correct order
  const currentEntries = Object.entries(current).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
  const previousEntries = Object.entries(previous).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());

  // Helper to get metric value based on analysisMode
  const getMetricValue = (data, family, model = null) => {
    const familyData = data[family];
    if (!familyData) return 0;

    if (component.analysisMode === 'volume') {
      if (model) {
        const m = familyData[model];
        return typeof m === 'object' ? m.count : (m || 0);
      }
      return familyData._subtotal || 0;
    } 
    
    if (component.analysisMode === 'success') {
      if (model) {
        const m = familyData[model];
        if (typeof m !== 'object') return 100; // Legacy data assumed success
        return m.count > 0 ? Math.round((m.success / m.count) * 100) : 100;
      }
      const total = familyData._subtotal || 0;
      return total > 0 ? Math.round(((familyData._success || total) / total) * 100) : 100;
    }

    if (component.analysisMode === 'latency') {
      if (model) {
        const m = familyData[model];
        if (typeof m !== 'object') return 0;
        return m.count > 0 ? Math.round(m.latency / m.count) : 0;
      }
      const total = familyData._subtotal || 0;
      return total > 0 ? Math.round((familyData._latency || 0) / total) : 0;
    }

    return 0;
  };

  // Build labels and current datasets
  const labels = [];
  const datasets = [];

  // Determine if data spans multiple days
  const timestamps = currentEntries.map(([iso]) => new Date(iso));
  const isMultiDay = timestamps.length > 1 && timestamps[0].toDateString() !== timestamps[timestamps.length - 1].toDateString();

  const formatLabel = (date) => {
    const timeRange = component.timeRange;
    if (timeRange === '7d') return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
    if (isMultiDay || timeRange === 'all') return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Extract labels from current data
  currentEntries.forEach(([iso]) => labels.push(formatLabel(new Date(iso))));

  if (component.displayMode === "family") {
    component.selectedFamilies.forEach((family) => {
      const color = window.DashboardFilters.getFamilyColor(family);
      const label = Alpine.store("global").t("family" + family.charAt(0).toUpperCase() + family.slice(1));
      
      // Current period
      const currentData = currentEntries.map(([_, data]) => getMetricValue(data, family));
      datasets.push(window.DashboardCharts.createDataset(label, currentData, color, canvas));

      // Previous period
      if (component.showComparison && previousEntries.length > 0) {
        const prevData = previousEntries.map(([_, data]) => getMetricValue(data, family));
        datasets.push(window.DashboardCharts.createDataset(`${label} (${Alpine.store('global').t('previous')})`, prevData, color, canvas, true));
      }
    });
  } else {
    component.families.forEach((family) => {
      (component.selectedModels[family] || []).forEach((model, modelIndex) => {
        const color = window.DashboardFilters.getModelColor(family, modelIndex);
        
        // Current period
        const currentData = currentEntries.map(([_, data]) => getMetricValue(data, family, model));
        datasets.push(window.DashboardCharts.createDataset(model, currentData, color, canvas));

        // Previous period
        if (component.showComparison && previousEntries.length > 0) {
          const prevData = previousEntries.map(([_, data]) => getMetricValue(data, family, model));
          datasets.push(window.DashboardCharts.createDataset(`${model} (${Alpine.store('global').t('previous')})`, prevData, color, canvas, true));
        }
      });
    });
  }

  // Update summary metrics for dashboard cards
  const calculateTotalMetric = (entries) => {
    let total = 0, count = 0;
    entries.forEach(([_, data]) => {
        if (component.analysisMode === 'volume') total += data._total || 0;
        else if (component.analysisMode === 'success') {
            const t = data._total || 0;
            if (t > 0) {
                total += (data._success || t) / t;
                count++;
            }
        }
        else if (component.analysisMode === 'latency') {
            const t = data._total || 0;
            if (t > 0) {
                total += (data._latency || 0) / t;
                count++;
            }
        }
    });
    if (component.analysisMode === 'volume') return total;
    return count > 0 ? (total / count) * (component.analysisMode === 'success' ? 100 : 1) : (component.analysisMode === 'success' ? 100 : 0);
  };

  const currentTotal = calculateTotalMetric(currentEntries);
  const previousTotal = calculateTotalMetric(previousEntries);
  
  component.analysisStats = {
      current: currentTotal,
      previous: previousTotal,
      change: previousTotal > 0 ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100) : 0
  };

  try {
    const unit = component.analysisMode === 'success' ? '%' : (component.analysisMode === 'latency' ? 'ms' : '');
    const newChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: getThemeColor("--color-space-950") || "rgba(24, 24, 27, 0.9)",
            titleColor: getThemeColor("--color-text-main"),
            bodyColor: getThemeColor("--color-text-bright"),
            borderColor: getThemeColor("--color-space-border"),
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)}${unit}`
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: getThemeColor("--color-text-muted"), font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: getThemeColor("--color-space-border") + "1a" },
            ticks: { 
                color: getThemeColor("--color-text-muted"), 
                font: { size: 10 },
                callback: (val) => `${val}${unit}`
            },
          },
        },
      },
    });
    
    canvas._chartInstance = newChart;
    component.charts.usageTrend = newChart;
  } catch (e) {
    console.error("Failed to create trend chart:", e);
  } finally {
    _trendChartUpdateLock = false;
  }
};

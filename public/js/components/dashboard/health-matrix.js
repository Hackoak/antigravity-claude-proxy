/**
 * Dashboard Health Matrix Module
 * Handles fetching and visualizing the account x model health matrix
 */
window.DashboardHealthMatrix = window.DashboardHealthMatrix || {};

window.DashboardHealthMatrix.component = () => ({
    matrix: [],
    loading: false,
    expanded: true, // Default to expanded for visibility, user can collapse
    pollInterval: null,

    // 浮动 Tooltip 状态
    tooltip: {
        show: false,
        modelId: '',
        score: 0,
        success: 0,
        failures: 0,
        quotaDisabled: false,
        quotaResetTime: null,
        disabled: false,
        x: 0,
        y: 0
    },

    // Config
    commonModels: window.AppConstants?.MODELS?.HEALTH_MONITOR_MODELS || [
        'claude-opus-4-5-thinking',
        'claude-sonnet-4-5-thinking',
        'gemini-3-flash',
        'gemini-3-pro-high'
    ],

    init() {
        this.loadMatrix();

        // Refresh when dashboard is active
        this.$watch('$store.global.activeTab', (val) => {
            if (val === 'dashboard') {
                this.loadMatrix();
                this.startPolling();
            } else {
                this.stopPolling();
            }
        });

        // Start polling if initially on dashboard
        if (Alpine.store('global').activeTab === 'dashboard') {
            this.startPolling();
        }
    },

    startPolling() {
        this.stopPolling();
        this.pollInterval = setInterval(() => {
            if (!document.hidden) this.loadMatrix(true);
        }, window.utils.jitter(30000, 10)); // 30s poll with jitter
    },

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    },

    async loadMatrix(silent = false) {
        if (!silent) this.loading = true;
        try {
            // Get models from data store if available to be dynamic
            const dataStore = Alpine.store('data');
            const globalStore = Alpine.store('global');
            let models = this.commonModels;

            // If we have tracked models, use top 5 most active
            if (dataStore.models && dataStore.models.length > 0) {
                // We could implement smarter selection here later
                // For now, stick to config or fallback
            }

            const query = models.join(',');
            const { response, newPassword } = await window.utils.request(
                `/api/health/matrix?models=${encodeURIComponent(query)}`,
                {},
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                const data = await response.json();
                // Transform API response to match frontend expected format
                // API returns: { matrix: { accounts: [{email, models: {modelId: healthData}}] } }
                // Frontend expects: [ { account: email, models: [{modelId, healthScore, ...}] } ]
                const apiMatrix = data.matrix || {};
                const accounts = apiMatrix.accounts || [];

                this.matrix = accounts.map(acc => ({
                    account: acc.email,
                    models: this.commonModels.map(modelId => ({
                        modelId,
                        ...(acc.models?.[modelId] || {
                            healthScore: 100,
                            successCount: 0,
                            failCount: 0,
                            disabled: false
                        })
                    }))
                }));
            }
        } catch (error) {
            console.error('Failed to load health matrix:', error);
        } finally {
            if (!silent) this.loading = false;
        }
    },

    getHealthClass(cell) {
        if (cell.disabled) return 'bg-red-500/20 text-red-500 border-red-500/30';
        if (cell.healthScore >= 90) return 'bg-neon-green/10 text-neon-green border-neon-green/20';
        if (cell.healthScore >= 70) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        return 'bg-red-500/10 text-red-400 border-red-500/20';
    },

    formatScore(score) {
        return score === undefined || score === null ? '-' : Math.round(score) + '%';
    },

    // Tooltip handlers
    showTooltip(e, cell) {
        this.tooltip.show = true;
        this.tooltip.modelId = cell.modelId;
        this.tooltip.score = cell.healthScore;
        this.tooltip.success = cell.successCount;
        this.tooltip.failures = cell.failCount;
        this.tooltip.quotaDisabled = cell.quotaDisabled;
        this.tooltip.quotaResetTime = cell.quotaResetTime;
        this.tooltip.disabled = cell.disabled;

        this.updateTooltipPosition(e);
    },

    updateTooltipPosition(e) {
        const offsetX = 15;
        const offsetY = 15;
        let x = e.clientX + offsetX;
        let y = e.clientY + offsetY;
        const tooltipWidth = 200;
        const tooltipHeight = 150;

        if (x + tooltipWidth > window.innerWidth) {
            x = e.clientX - tooltipWidth - offsetX;
        }
        if (y + tooltipHeight > window.innerHeight) {
            y = e.clientY - tooltipHeight - offsetY;
        }

        this.tooltip.x = x;
        this.tooltip.y = y;
    },

    hideTooltip() {
        this.tooltip.show = false;
    },

    // Navigate to account details for a specific cell
    viewDetails(email) {
        const store = Alpine.store('global');
        store.activeTab = 'accounts';

        // Wait a tiny bit for tab transition, then request to open specific account health
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-account-details', {
                detail: { email, tab: 'health' }
            }));
        }, 50);
    }
});

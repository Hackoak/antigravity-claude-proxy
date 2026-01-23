/**
 * Health Page Component
 * Standalone health monitoring page with matrix, summary, and issues
 */
window.Components = window.Components || {};

window.Components.healthPage = () => ({
    matrix: [],
    loading: false,
    issues: [],
    issueStats: {
        active: 0,
        acknowledged: 0,
        resolved: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }
    },
    summary: {
        healthy: 0,
        warning: 0,
        critical: 0,
        disabled: 0
    },
    activeFilter: null, // 'healthy', 'warning', 'critical', 'disabled'
    pollInterval: null,
    privacyMode: false,

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

    // Models to display in the matrix - now from constants
    commonModels: window.AppConstants?.MODELS?.HEALTH_MONITOR_MODELS || [
        'claude-opus-4-5-thinking',
        'claude-sonnet-4-5-thinking',
        'gemini-3-flash',
        'gemini-3-pro-high'
    ],

    init() {
        this.loadMatrix();

        // Refresh when health tab is active
        this.$watch('$store.global.activeTab', (val) => {
            if (val === 'health') {
                this.loadMatrix();
                this.startPolling();
            } else {
                this.stopPolling();
            }
        });

        // Start polling if initially on health page
        if (Alpine.store('global').activeTab === 'health') {
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
            const globalStore = Alpine.store('global');

            // Try to get models from data store for dynamic selection
            const dataStore = Alpine.store('data');
            let models = this.commonModels;

            if (dataStore?.models?.length > 0) {
                // Could implement smarter model selection here
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
                const apiMatrix = data.matrix || {};
                const accounts = apiMatrix.accounts || [];

                // Transform API response to frontend format
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

                // Calculate summary stats
                this.calculateSummary();
            }

            // Load issues separately
            await this.loadIssues(silent);
        } catch (error) {
            console.error('Failed to load health matrix:', error);
        } finally {
            if (!silent) this.loading = false;
        }
    },

    calculateSummary() {
        let healthy = 0, warning = 0, critical = 0, disabled = 0;

        for (const row of this.matrix) {
            for (const cell of row.models) {
                if (cell.disabled) {
                    disabled++;
                } else if (cell.healthScore >= 90) {
                    healthy++;
                } else if (cell.healthScore >= 70) {
                    warning++;
                } else {
                    critical++;
                }
            }
        }

        this.summary = { healthy, warning, critical, disabled };
    },

    async loadIssues(silent = false) {
        try {
            const globalStore = Alpine.store('global');
            const { response, newPassword } = await window.utils.request(
                '/api/issues',
                {},
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                const data = await response.json();
                this.issues = (data.issues || []).filter(i => i.status === 'active');
            }

            // Load stats
            const statsRes = await window.utils.request(
                '/api/issues/stats',
                {},
                globalStore.webuiPassword
            );
            if (statsRes.response.ok) {
                const statsData = await statsRes.response.json();
                this.issueStats = statsData.stats;
            }
        } catch (error) {
            // Issues endpoint may not exist yet, ignore silently
            this.issues = [];
        }
    },

    getHealthClass(cell) {
        // Base classes for colors
        let classes = '';
        let type = '';

        if (cell.quotaDisabled) {
            // Quota disabled - use orange/amber to distinguish from failure-disabled
            type = 'disabled';
            classes = 'bg-orange-500/20 text-orange-500 border-orange-500/30';
        } else if (cell.disabled) {
            type = 'disabled';
            classes = 'bg-red-500/20 text-red-500 border-red-500/30';
        } else if (cell.healthScore >= 90) {
            type = 'healthy';
            classes = 'bg-neon-green/10 text-neon-green border-neon-green/20';
        } else if (cell.healthScore >= 70) {
            type = 'warning';
            classes = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        } else {
            type = 'critical';
            classes = 'bg-red-500/10 text-red-400 border-red-500/20';
        }

        // Apply dimming if a filter is active and this cell doesn't match
        if (this.activeFilter && this.activeFilter !== type) {
            return classes + ' opacity-20 grayscale blur-[1px] transition-all duration-300';
        }

        return classes + ' transition-all duration-300 transform hover:scale-105 hover:z-10 shadow-lg shadow-black/20';
    },

    setFilter(filter) {
        // Toggle off if clicking same filter
        if (this.activeFilter === filter) {
            this.activeFilter = null;
        } else {
            this.activeFilter = filter;
        }
    },

    formatScore(score) {
        return score === undefined || score === null ? '-' : Math.round(score) + '%';
    },

    maskEmail(email) {
        if (!email) return '***';
        const parts = email.split('@');
        if (parts.length < 2) return email.substring(0, 3) + '***';
        const name = parts[0];
        const domain = parts[1];
        if (name.length <= 2) return '*@' + domain;
        return name.substring(0, 2) + '***@' + domain;
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
        // Offset from cursor
        const offsetX = 15;
        const offsetY = 15;

        let x = e.clientX + offsetX;
        let y = e.clientY + offsetY;

        // Keep inside window bounds
        const tooltipWidth = 200; // Estimated
        const tooltipHeight = 150; // Estimated

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

    // Navigate to account details with health tab open
    viewAccountHealth(email) {
        const store = Alpine.store('global');
        store.activeTab = 'accounts';

        // Dispatch event to open specific account's health tab
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-account-details', {
                detail: { email, tab: 'health' }
            }));
        }, 50);
    },

    async resolveIssue(issueId) {
        try {
            const globalStore = Alpine.store('global');
            const { response, newPassword } = await window.utils.request(
                `/api/issues/${encodeURIComponent(issueId)}/resolve`,
                { method: 'POST' },
                globalStore.webuiPassword
            );
            if (newPassword) globalStore.webuiPassword = newPassword;

            if (response.ok) {
                // Remove from local list
                this.issues = this.issues.filter(i => i.id !== issueId);
                globalStore.showToast(globalStore.t('issueResolved') || 'Issue resolved', 'success');
            } else {
                throw new Error('Failed to resolve issue');
            }
        } catch (error) {
            console.error('Failed to resolve issue:', error);
            Alpine.store('global').showToast('Failed to resolve issue', 'error');
        }
    }
});

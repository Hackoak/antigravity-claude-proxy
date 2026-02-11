import fs from 'fs';
import path from 'path';

import { USAGE_HISTORY_PATH } from '../constants.js';
import { logger } from '../utils/logger.js';

// Persistence path
const HISTORY_FILE = USAGE_HISTORY_PATH;
const DATA_DIR = path.dirname(HISTORY_FILE);
const OLD_DATA_DIR = path.join(process.cwd(), 'data');
const OLD_HISTORY_FILE = path.join(OLD_DATA_DIR, 'usage-history.json');

// In-memory storage
// Structure: { "YYYY-MM-DDTHH:00:00.000Z": { "claude": { "model-name": count, "_subtotal": count }, "_total": count } }
let history = {};
let isDirty = false;

/**
 * Extract model family from model ID
 * @param {string} modelId - The model identifier (e.g., "claude-opus-4-5-thinking")
 * @returns {string} The family name (claude, gemini, or other)
 */
function getFamily(modelId) {
    const lower = (modelId || '').toLowerCase();
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini')) return 'gemini';
    return 'other';
}

/**
 * Extract short model name (without family prefix)
 * @param {string} modelId - The model identifier
 * @param {string} family - The model family
 * @returns {string} Short model name
 */
function getShortName(modelId, family) {
    if (family === 'other') return modelId;
    // Remove family prefix (e.g., "claude-opus-4-5" -> "opus-4-5")
    return modelId.replace(new RegExp(`^${family}-`, 'i'), '');
}

/**
 * Ensure data directory exists and load history.
 * Includes migration from legacy local data directory.
 */
function load() {
    try {
        // Migration logic: if old file exists and new one doesn't
        if (fs.existsSync(OLD_HISTORY_FILE) && !fs.existsSync(HISTORY_FILE)) {
            logger.info('[UsageStats] Migrating legacy usage data...');
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.copyFileSync(OLD_HISTORY_FILE, HISTORY_FILE);
            // We keep the old file for safety initially, but could delete it
            logger.info(`[UsageStats] Migration complete: ${OLD_HISTORY_FILE} -> ${HISTORY_FILE}`);
        }

        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            history = JSON.parse(data);
        }
    } catch (err) {
        logger.error('[UsageStats] Failed to load history:', err);
        history = {};
    }
}

/**
 * Save history to disk
 */
function save() {
    if (!isDirty) return;
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        isDirty = false;
    } catch (err) {
        logger.error('[UsageStats] Failed to save history:', err);
    }
}

/**
 * Prune old data (keep last 30 days)
 */
function prune() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let pruned = false;
    Object.keys(history).forEach(key => {
        if (new Date(key) < cutoff) {
            delete history[key];
            pruned = true;
        }
    });

    if (pruned) isDirty = true;
}

/**
 * Track a request by model ID using hierarchical structure
 * @param {string} modelId - The specific model identifier
 * @param {object} metadata - Optional metadata (status, latency)
 */
function track(modelId, metadata = {}) {
    const { status = 'success', latency = 0 } = metadata;
    const now = new Date();
    // Round down to nearest hour
    now.setMinutes(0, 0, 0);
    const key = now.toISOString();

    if (!history[key]) {
        history[key] = { _total: 0, _success: 0, _error: 0, _latency: 0 };
    }

    const hourData = history[key];
    const family = getFamily(modelId);
    const shortName = getShortName(modelId, family);

    // Initialize family object if needed
    if (!hourData[family]) {
        hourData[family] = { _subtotal: 0, _success: 0, _error: 0, _latency: 0 };
    }

    // Initialize model object if needed for detailed stats
    if (!hourData[family][shortName]) {
        hourData[family][shortName] = { count: 0, success: 0, error: 0, latency: 0 };
    }

    const modelData = typeof hourData[family][shortName] === 'number' 
        ? { count: hourData[family][shortName], success: hourData[family][shortName], error: 0, latency: 0 }
        : hourData[family][shortName];

    // Increment model-specific stats
    modelData.count++;
    if (status === 'success') {
        modelData.success++;
        hourData[family]._success++;
        hourData._success++;
    } else {
        modelData.error++;
        hourData[family]._error++;
        hourData._error++;
    }
    
    // Average latency (simplified: sum then divide on frontend or later)
    modelData.latency += latency;
    hourData[family]._latency += latency;
    hourData._latency += latency;

    // Update the object back in case it was a number (migration)
    hourData[family][shortName] = modelData;

    // Increment family subtotal
    hourData[family]._subtotal = (hourData[family]._subtotal || 0) + 1;

    // Increment global total
    hourData._total = (hourData._total || 0) + 1;

    isDirty = true;
}

/**
 * Setup Express Middleware
 * @param {import('express').Application} app
 */
function setupMiddleware(app) {
    load();

    // Auto-save every minute
    setInterval(() => {
        save();
        prune();
    }, 60 * 1000);

    // Save on exit
    process.on('SIGINT', () => { save(); process.exit(); });
    process.on('SIGTERM', () => { save(); process.exit(); });

    // Request interceptor
    // Track both Anthropic (/v1/messages) and OpenAI compatible (/v1/chat/completions) endpoints
    const TRACKED_PATHS = ['/v1/messages', '/v1/chat/completions'];

    app.use((req, res, next) => {
        if (req.method === 'POST' && TRACKED_PATHS.includes(req.path)) {
            const model = req.body?.model;
            if (model) {
                const startTime = Date.now();
                
                // We need to hook into res.end to track status and latency
                const originalEnd = res.end;
                res.end = function(...args) {
                    const latency = Date.now() - startTime;
                    const status = res.statusCode < 400 ? 'success' : 'error';
                    track(model, { status, latency });
                    return originalEnd.apply(this, args);
                };
            }
        }
        next();
    });
}

/**
 * Setup API Routes
 * @param {import('express').Application} app
 */
function setupRoutes(app) {
    app.get('/api/stats/history', (req, res) => {
        // Sort keys to ensure chronological order
        const sortedKeys = Object.keys(history).sort();
        const sortedData = {};
        sortedKeys.forEach(key => {
            sortedData[key] = history[key];
        });
        res.json(sortedData);
    });
}

/**
 * Get usage history data
 * @returns {object} History data sorted by timestamp
 */
function getHistory() {
    const sortedKeys = Object.keys(history).sort();
    const sortedData = {};
    sortedKeys.forEach(key => {
        sortedData[key] = history[key];
    });
    return sortedData;
}

export default {
    setupMiddleware,
    setupRoutes,
    track,
    getFamily,
    getShortName,
    getHistory
};

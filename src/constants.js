/**
 * Constants for Antigravity Cloud Code API integration
 * Based on: https://github.com/NoeFabris/opencode-antigravity-auth
 */

import { homedir } from 'os';
import { join } from 'path';

// Cloud Code API endpoints (in fallback order)
const ANTIGRAVITY_ENDPOINT_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';

// Endpoint fallback order (daily → prod)
export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_PROD
];

// Required headers for Antigravity API requests
export const ANTIGRAVITY_HEADERS = {
    'User-Agent': 'antigravity/1.11.5 darwin/arm64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
    })
};

// Model name mappings: Anthropic format → Antigravity format
export const MODEL_MAPPINGS = {
    // Claude models
    'claude-3-opus-20240229': 'claude-opus-4-5-thinking',
    'claude-3-5-opus-20240229': 'claude-opus-4-5-thinking',
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-5',
    'claude-3-5-sonnet-20240620': 'claude-sonnet-4-5',
    'claude-3-sonnet-20240229': 'claude-sonnet-4-5',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking': 'claude-opus-4-5-thinking'
};

// Available models exposed by this proxy
export const AVAILABLE_MODELS = [
    {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5 (Antigravity)',
        description: 'Claude Sonnet 4.5 via Antigravity Cloud Code',
        context: 200000,
        output: 64000
    },
    {
        id: 'claude-sonnet-4-5-thinking',
        name: 'Claude Sonnet 4.5 Thinking (Antigravity)',
        description: 'Claude Sonnet 4.5 with extended thinking via Antigravity',
        context: 200000,
        output: 64000
    },
    {
        id: 'claude-opus-4-5-thinking',
        name: 'Claude Opus 4.5 Thinking (Antigravity)',
        description: 'Claude Opus 4.5 with extended thinking via Antigravity',
        context: 200000,
        output: 64000
    }
];

// Default project ID if none can be discovered
export const DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

export const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const REQUEST_BODY_LIMIT = '50mb';
export const ANTIGRAVITY_AUTH_PORT = 9092;
export const DEFAULT_PORT = 8080;

// Multi-account configuration
export const ACCOUNT_CONFIG_PATH = join(
    homedir(),
    '.config/antigravity-proxy/accounts.json'
);
export const DEFAULT_COOLDOWN_MS = 60 * 1000; // 1 minute default cooldown
export const MAX_RETRIES = 5; // Max retry attempts across accounts

export default {
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    MODEL_MAPPINGS,
    AVAILABLE_MODELS,
    DEFAULT_PROJECT_ID,
    TOKEN_REFRESH_INTERVAL_MS,
    REQUEST_BODY_LIMIT,
    ANTIGRAVITY_AUTH_PORT,
    DEFAULT_PORT,
    ACCOUNT_CONFIG_PATH,
    DEFAULT_COOLDOWN_MS,
    MAX_RETRIES
};

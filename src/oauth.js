/**
 * Google OAuth with PKCE for Antigravity
 *
 * Implements the same OAuth flow as opencode-antigravity-auth
 * to obtain refresh tokens for multiple Google accounts.
 * Uses a local callback server to automatically capture the auth code.
 */

import crypto from 'crypto';
import http from 'http';
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, ANTIGRAVITY_HEADERS } from './constants.js';

// Google OAuth configuration (from opencode-antigravity-auth)
const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo';

// Local callback server configuration
const CALLBACK_PORT = 51121;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth-callback`;

// Scopes needed for Cloud Code access (matching Antigravity)
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

/**
 * Generate authorization URL for Google OAuth
 * Returns the URL and the PKCE verifier (needed for token exchange)
 */
export function getAuthorizationUrl() {
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state
    });

    return {
        url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
        verifier,
        state
    };
}

/**
 * Start a local server to receive the OAuth callback
 * Returns a promise that resolves with the authorization code
 */
export function startCallbackServer(expectedState, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);

            if (url.pathname !== '/oauth-callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <head><title>Authentication Failed</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center;">
                        <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                        <p>Error: ${error}</p>
                        <p>You can close this window.</p>
                    </body>
                    </html>
                `);
                server.close();
                reject(new Error(`OAuth error: ${error}`));
                return;
            }

            if (state !== expectedState) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <head><title>Authentication Failed</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center;">
                        <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                        <p>State mismatch - possible CSRF attack.</p>
                        <p>You can close this window.</p>
                    </body>
                    </html>
                `);
                server.close();
                reject(new Error('State mismatch'));
                return;
            }

            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <head><title>Authentication Failed</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center;">
                        <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                        <p>No authorization code received.</p>
                        <p>You can close this window.</p>
                    </body>
                    </html>
                `);
                server.close();
                reject(new Error('No authorization code'));
                return;
            }

            // Success!
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                    <h1 style="color: #28a745;">✅ Authentication Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
            `);

            server.close();
            resolve(code);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close any other OAuth flows and try again.`));
            } else {
                reject(err);
            }
        });

        server.listen(CALLBACK_PORT, () => {
            console.log(`[OAuth] Callback server listening on port ${CALLBACK_PORT}`);
        });

        // Timeout after specified duration
        setTimeout(() => {
            server.close();
            reject(new Error('OAuth callback timeout - no response received'));
        }, timeoutMs);
    });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(code, verifier) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            code: code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI
        })
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('[OAuth] Token exchange failed:', response.status, error);
        throw new Error(`Token exchange failed: ${error}`);
    }

    const tokens = await response.json();

    if (!tokens.access_token) {
        console.error('[OAuth] No access token in response:', tokens);
        throw new Error('No access token received');
    }

    console.log('[OAuth] Token exchange successful, access_token length:', tokens.access_token?.length);

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
    }

    const tokens = await response.json();
    return {
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Get user email from access token
 */
export async function getUserEmail(accessToken) {
    const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[OAuth] getUserEmail failed:', response.status, errorText);
        throw new Error(`Failed to get user info: ${response.status}`);
    }

    const userInfo = await response.json();
    return userInfo.email;
}

/**
 * Discover project ID for the authenticated user
 */
export async function discoverProjectId(accessToken) {
    for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
        try {
            const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    ...ANTIGRAVITY_HEADERS
                },
                body: JSON.stringify({
                    metadata: {
                        ideType: 'IDE_UNSPECIFIED',
                        platform: 'PLATFORM_UNSPECIFIED',
                        pluginType: 'GEMINI'
                    }
                })
            });

            if (!response.ok) continue;

            const data = await response.json();

            if (typeof data.cloudaicompanionProject === 'string') {
                return data.cloudaicompanionProject;
            }
            if (data.cloudaicompanionProject?.id) {
                return data.cloudaicompanionProject.id;
            }
        } catch (error) {
            console.log(`[OAuth] Project discovery failed at ${endpoint}:`, error.message);
        }
    }

    return null;
}

/**
 * Complete OAuth flow: exchange code and get all account info
 */
export async function completeOAuthFlow(code, verifier) {
    // Exchange code for tokens
    const tokens = await exchangeCode(code, verifier);

    // Get user email
    const email = await getUserEmail(tokens.accessToken);

    // Discover project ID
    const projectId = await discoverProjectId(tokens.accessToken);

    return {
        email,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        projectId
    };
}

export default {
    getAuthorizationUrl,
    startCallbackServer,
    exchangeCode,
    refreshAccessToken,
    getUserEmail,
    discoverProjectId,
    completeOAuthFlow
};

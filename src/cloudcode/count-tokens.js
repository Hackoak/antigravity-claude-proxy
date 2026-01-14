/**
 * Token Counter Implementation for antigravity-claude-proxy
 *
 * Implements Anthropic's /v1/messages/count_tokens endpoint
 * Uses hybrid approach: local estimation for text, API call for complex content
 *
 * @see https://platform.claude.com/docs/en/api/messages-count-tokens
 */

import { encode } from 'gpt-tokenizer';
import { logger } from '../utils/logger.js';
import { buildCloudCodeRequest, buildHeaders } from './request-builder.js';
import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from '../constants.js';

/**
 * Estimate tokens for text content using GPT tokenizer
 * Claude uses a similar tokenizer to GPT-4 (cl100k_base)
 *
 * @param {string} text - Text to tokenize
 * @returns {number} Estimated token count
 */
function estimateTextTokens(text) {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch (error) {
        // Fallback: rough estimate of 4 chars per token
        return Math.ceil(text.length / 4);
    }
}

/**
 * Check if content contains complex blocks (images, documents)
 * These require API call for accurate counting
 *
 * @param {Object} request - Anthropic request
 * @returns {boolean} True if complex content detected
 */
function hasComplexContent(request) {
    const { messages = [], system } = request;

    for (const message of messages) {
        const content = message.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block.type === 'image' || block.type === 'document') {
                    return true;
                }
            }
        }
    }

    // Check system prompt for complex content
    if (Array.isArray(system)) {
        for (const block of system) {
            if (block.type !== 'text') {
                return true;
            }
        }
    }

    return false;
}

/**
 * Extract text from message content
 *
 * @param {string|Array} content - Message content
 * @returns {string} Concatenated text
 */
function extractText(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
    }

    return '';
}

/**
 * Count tokens locally using tokenizer
 *
 * @param {Object} request - Anthropic format request
 * @returns {number} Estimated token count
 */
function countTokensLocally(request) {
    const { messages = [], system, tools } = request;
    let totalTokens = 0;

    // Count system prompt tokens
    if (system) {
        if (typeof system === 'string') {
            totalTokens += estimateTextTokens(system);
        } else if (Array.isArray(system)) {
            for (const block of system) {
                if (block.type === 'text') {
                    totalTokens += estimateTextTokens(block.text);
                }
            }
        }
    }

    // Count message tokens
    for (const message of messages) {
        // Add overhead for role and structure (~4 tokens per message)
        totalTokens += 4;
        totalTokens += estimateTextTokens(extractText(message.content));

        // Handle tool_use and tool_result blocks
        if (Array.isArray(message.content)) {
            for (const block of message.content) {
                if (block.type === 'tool_use') {
                    totalTokens += estimateTextTokens(block.name);
                    totalTokens += estimateTextTokens(JSON.stringify(block.input));
                } else if (block.type === 'tool_result') {
                    if (typeof block.content === 'string') {
                        totalTokens += estimateTextTokens(block.content);
                    } else if (Array.isArray(block.content)) {
                        totalTokens += estimateTextTokens(extractText(block.content));
                    }
                } else if (block.type === 'thinking') {
                    totalTokens += estimateTextTokens(block.thinking);
                }
            }
        }
    }

    // Count tool definitions
    if (tools && tools.length > 0) {
        for (const tool of tools) {
            totalTokens += estimateTextTokens(tool.name);
            totalTokens += estimateTextTokens(tool.description || '');
            totalTokens += estimateTextTokens(JSON.stringify(tool.input_schema || {}));
        }
    }

    return totalTokens;
}

/**
 * Count tokens via Google Cloud Code API
 * Makes a dry-run request to get accurate token count
 *
 * @param {Object} anthropicRequest - Anthropic format request
 * @param {Object} accountManager - Account manager instance
 * @returns {Promise<number>} Accurate token count from API
 */
async function countTokensViaAPI(anthropicRequest, accountManager) {
    const account = accountManager.pickNext(anthropicRequest.model);
    if (!account) {
        throw new Error('No accounts available for token counting');
    }

    const token = await accountManager.getTokenForAccount(account);
    const project = await accountManager.getProjectForAccount(account, token);

    // Build request with minimal max_tokens to avoid generating content
    const countRequest = {
        ...anthropicRequest,
        max_tokens: 1,
        stream: false
    };

    const payload = buildCloudCodeRequest(countRequest, project);

    // Try endpoints until one works
    for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
        try {
            const url = `${endpoint}/v1internal:generateContent`;

            const response = await fetch(url, {
                method: 'POST',
                headers: buildHeaders(token, anthropicRequest.model, 'application/json'),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                logger.debug(`[TokenCounter] Error at ${endpoint}: ${response.status}`);
                continue;
            }

            const data = await response.json();
            const usageMetadata = data.usageMetadata || data.response?.usageMetadata || {};

            return usageMetadata.promptTokenCount || 0;

        } catch (error) {
            logger.debug(`[TokenCounter] Error at ${endpoint}: ${error.message}`);
            continue;
        }
    }

    throw new Error('Failed to count tokens via API');
}

/**
 * Count tokens in a message request
 * Implements Anthropic's /v1/messages/count_tokens endpoint
 *
 * @param {Object} anthropicRequest - Anthropic format request with messages, model, system, tools
 * @param {Object} accountManager - Account manager instance (optional, for API-based counting)
 * @param {Object} options - Options
 * @param {boolean} options.useAPI - Force API-based counting (default: false)
 * @returns {Promise<Object>} Response with input_tokens count
 */
export async function countTokens(anthropicRequest, accountManager = null, options = {}) {
    const { useAPI = false } = options;

    try {
        let inputTokens;

        // Use API for complex content or when forced
        if (useAPI || (hasComplexContent(anthropicRequest) && accountManager)) {
            if (!accountManager) {
                throw new Error('Account manager required for API-based token counting');
            }
            inputTokens = await countTokensViaAPI(anthropicRequest, accountManager);
            logger.debug(`[TokenCounter] API count: ${inputTokens} tokens`);
        } else {
            // Use local estimation for text-only content
            inputTokens = countTokensLocally(anthropicRequest);
            logger.debug(`[TokenCounter] Local estimate: ${inputTokens} tokens`);
        }

        return {
            input_tokens: inputTokens
        };

    } catch (error) {
        logger.warn(`[TokenCounter] Error: ${error.message}, falling back to local estimation`);

        // Fallback to local estimation
        const inputTokens = countTokensLocally(anthropicRequest);
        return {
            input_tokens: inputTokens
        };
    }
}

/**
 * Express route handler for /v1/messages/count_tokens
 *
 * @param {Object} accountManager - Account manager instance
 * @returns {Function} Express middleware
 */
export function createCountTokensHandler(accountManager) {
    return async (req, res) => {
        try {
            const { messages, model, system, tools, tool_choice, thinking } = req.body;

            // Validate required fields
            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({
                    type: 'error',
                    error: {
                        type: 'invalid_request_error',
                        message: 'messages is required and must be an array'
                    }
                });
            }

            if (!model) {
                return res.status(400).json({
                    type: 'error',
                    error: {
                        type: 'invalid_request_error',
                        message: 'model is required'
                    }
                });
            }

            const result = await countTokens(
                { messages, model, system, tools, tool_choice, thinking },
                accountManager,
                { useAPI: false } // Default to local estimation for speed
            );

            res.json(result);

        } catch (error) {
            logger.error(`[TokenCounter] Handler error: ${error.message}`);
            res.status(500).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: error.message
                }
            });
        }
    };
}

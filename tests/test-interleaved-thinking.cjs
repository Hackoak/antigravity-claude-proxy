/**
 * Interleaved Thinking Test
 *
 * Tests that interleaved thinking works correctly:
 * - Multiple thinking blocks can appear in a single response
 * - Thinking blocks between tool calls
 * - Thinking after tool results
 *
 * This simulates complex Claude Code scenarios where the model
 * thinks multiple times during a single turn.
 */
const http = require('http');

const BASE_URL = 'localhost';
const PORT = 8080;

function streamRequest(body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            host: BASE_URL,
            port: PORT,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'test',
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'interleaved-thinking-2025-05-14',
                'Content-Length': Buffer.byteLength(data)
            }
        }, res => {
            const events = [];
            let fullData = '';

            res.on('data', chunk => {
                fullData += chunk.toString();
            });

            res.on('end', () => {
                const parts = fullData.split('\n\n').filter(e => e.trim());
                for (const part of parts) {
                    const lines = part.split('\n');
                    const eventLine = lines.find(l => l.startsWith('event:'));
                    const dataLine = lines.find(l => l.startsWith('data:'));
                    if (eventLine && dataLine) {
                        try {
                            const eventType = eventLine.replace('event:', '').trim();
                            const eventData = JSON.parse(dataLine.replace('data:', '').trim());
                            events.push({ type: eventType, data: eventData });
                        } catch (e) { }
                    }
                }

                const content = [];
                let currentBlock = null;

                for (const event of events) {
                    if (event.type === 'content_block_start') {
                        currentBlock = { ...event.data.content_block };
                        if (currentBlock.type === 'thinking') {
                            currentBlock.thinking = '';
                            currentBlock.signature = '';
                        }
                        if (currentBlock.type === 'text') currentBlock.text = '';
                    } else if (event.type === 'content_block_delta') {
                        const delta = event.data.delta;
                        if (delta.type === 'thinking_delta' && currentBlock) {
                            currentBlock.thinking += delta.thinking || '';
                        }
                        if (delta.type === 'signature_delta' && currentBlock) {
                            currentBlock.signature += delta.signature || '';
                        }
                        if (delta.type === 'text_delta' && currentBlock) {
                            currentBlock.text += delta.text || '';
                        }
                        if (delta.type === 'input_json_delta' && currentBlock) {
                            currentBlock.partial_json = (currentBlock.partial_json || '') + delta.partial_json;
                        }
                    } else if (event.type === 'content_block_stop') {
                        if (currentBlock?.type === 'tool_use' && currentBlock.partial_json) {
                            try { currentBlock.input = JSON.parse(currentBlock.partial_json); } catch (e) { }
                            delete currentBlock.partial_json;
                        }
                        if (currentBlock) content.push(currentBlock);
                        currentBlock = null;
                    }
                }

                const errorEvent = events.find(e => e.type === 'error');
                if (errorEvent) {
                    resolve({ content, events, error: errorEvent.data.error, statusCode: res.statusCode });
                } else {
                    resolve({ content, events, statusCode: res.statusCode });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Multiple tools to encourage interleaved thinking
const tools = [{
    name: 'read_file',
    description: 'Read a file',
    input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
    }
}, {
    name: 'write_file',
    description: 'Write to a file',
    input_schema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' }
        },
        required: ['path', 'content']
    }
}, {
    name: 'run_tests',
    description: 'Run test suite',
    input_schema: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern']
    }
}];

async function runTests() {
    console.log('='.repeat(60));
    console.log('INTERLEAVED THINKING TEST');
    console.log('Tests complex multi-step reasoning with tools');
    console.log('='.repeat(60));
    console.log('');

    let allPassed = true;
    const results = [];

    // ===== TEST 1: Complex task requiring multiple steps =====
    console.log('TEST 1: Complex task - read, modify, write, test');
    console.log('-'.repeat(40));

    const result = await streamRequest({
        model: 'claude-opus-4-5-thinking',
        max_tokens: 8192,
        stream: true,
        tools,
        thinking: { type: 'enabled', budget_tokens: 16000 },
        messages: [{
            role: 'user',
            content: `I need you to:
1. Read the file src/config.js
2. Add a new config option "debug: true"
3. Write the updated file
4. Run the tests to make sure nothing broke

Please do this step by step, reading each file before modifying.`
        }]
    });

    if (result.error) {
        console.log(`  ERROR: ${result.error.message}`);
        allPassed = false;
        results.push({ name: 'Complex multi-step task', passed: false });
    } else {
        const thinking = result.content.filter(b => b.type === 'thinking');
        const toolUse = result.content.filter(b => b.type === 'tool_use');
        const text = result.content.filter(b => b.type === 'text');

        console.log(`  Thinking blocks: ${thinking.length}`);
        console.log(`  Tool use blocks: ${toolUse.length}`);
        console.log(`  Text blocks: ${text.length}`);

        // Check signatures
        const signedThinking = thinking.filter(t => t.signature && t.signature.length >= 50);
        console.log(`  Signed thinking blocks: ${signedThinking.length}`);

        // Analyze block order
        const blockOrder = result.content.map(b => b.type).join(' -> ');
        console.log(`  Block order: ${blockOrder}`);

        // Show thinking previews
        thinking.forEach((t, i) => {
            console.log(`  Thinking ${i + 1}: "${(t.thinking || '').substring(0, 50)}..."`);
        });

        // Show tool calls
        toolUse.forEach((t, i) => {
            console.log(`  Tool ${i + 1}: ${t.name}(${JSON.stringify(t.input).substring(0, 50)}...)`);
        });

        // Expect at least one thinking block (ideally multiple for complex task)
        const passed = thinking.length >= 1 && signedThinking.length >= 1 && toolUse.length >= 1;
        results.push({ name: 'Thinking + Tools in complex task', passed });
        if (!passed) allPassed = false;
    }

    // ===== TEST 2: Multiple tool calls in sequence =====
    console.log('\nTEST 2: Tool result followed by more thinking');
    console.log('-'.repeat(40));

    // Start with previous result and add tool result
    if (result.content && result.content.some(b => b.type === 'tool_use')) {
        const toolUseBlock = result.content.find(b => b.type === 'tool_use');

        const result2 = await streamRequest({
            model: 'claude-opus-4-5-thinking',
            max_tokens: 8192,
            stream: true,
            tools,
            thinking: { type: 'enabled', budget_tokens: 16000 },
            messages: [
                {
                    role: 'user',
                    content: `Read src/config.js and tell me if debug mode is enabled.`
                },
                { role: 'assistant', content: result.content },
                {
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: toolUseBlock.id,
                        content: `module.exports = {
    port: 3000,
    host: 'localhost',
    debug: false
};`
                    }]
                }
            ]
        });

        if (result2.error) {
            console.log(`  ERROR: ${result2.error.message}`);
            allPassed = false;
            results.push({ name: 'Thinking after tool result', passed: false });
        } else {
            const thinking2 = result2.content.filter(b => b.type === 'thinking');
            const text2 = result2.content.filter(b => b.type === 'text');
            const toolUse2 = result2.content.filter(b => b.type === 'tool_use');

            console.log(`  Thinking blocks: ${thinking2.length}`);
            console.log(`  Text blocks: ${text2.length}`);
            console.log(`  Tool use blocks: ${toolUse2.length}`);

            if (text2.length > 0) {
                console.log(`  Response: "${text2[0].text?.substring(0, 80)}..."`);
            }

            // Should have thinking after receiving tool result
            const passed = thinking2.length >= 1 && (text2.length > 0 || toolUse2.length > 0);
            results.push({ name: 'Thinking after tool result', passed });
            if (!passed) allPassed = false;
        }
    } else {
        console.log('  SKIPPED - No tool use in previous test');
        results.push({ name: 'Thinking after tool result', passed: false, skipped: true });
    }

    // ===== Summary =====
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    for (const result of results) {
        const status = result.skipped ? 'SKIP' : (result.passed ? 'PASS' : 'FAIL');
        console.log(`  [${status}] ${result.name}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`OVERALL: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
    console.log('='.repeat(60));

    process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});

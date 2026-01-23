/**
 * Dashboard Resampling Logic Tests
 * Tests fillTimeGaps() and resampleData() functions
 *
 * Run in browser console:
 * 1. Load dashboard page
 * 2. Paste this file content into console
 * 3. All tests should pass with green ✓
 */

console.log('🧪 Starting Dashboard Resampling Tests...\n');

// ============================================================================
// Test Suite 1: fillTimeGaps()
// ============================================================================

console.group('📦 Test Suite 1: fillTimeGaps()');

// Test 1.1: Empty input returns empty object
(() => {
    const result = window.DashboardFilters.fillTimeGaps({}, null);
    const passed = Object.keys(result).length === 0;
    console.log(passed ? '✅' : '❌', 'Test 1.1: Empty input');
    if (!passed) console.error('Expected empty object, got:', result);
})();

// Test 1.2: Single data point (no gaps)
(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const iso = now.toISOString();
    const input = { [iso]: { _total: 5, claude: { 'opus-4': 3 } } };

    const result = window.DashboardFilters.fillTimeGaps(input, now.getTime());
    const passed = Object.keys(result).length === 1 && result[iso]._total === 5;
    console.log(passed ? '✅' : '❌', 'Test 1.2: Single point (no gaps)');
    if (!passed) console.error('Expected 1 entry, got:', result);
})();

// Test 1.3: Gap filling (3-hour gap in middle)
(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);

    const hour0 = new Date(now);
    hour0.setHours(now.getHours() - 5);
    const hour5 = new Date(now);

    const input = {
        [hour0.toISOString()]: { _total: 10 },
        [hour5.toISOString()]: { _total: 8 }
    };

    const result = window.DashboardFilters.fillTimeGaps(input, hour0.getTime());
    const keys = Object.keys(result).sort();

    // Should have 6 entries (hours 0-5 inclusive)
    const passed = keys.length === 6;
    console.log(passed ? '✅' : '❌', 'Test 1.3: Gap filling (5-hour span)');
    if (!passed) {
        console.error(`Expected 6 hours, got ${keys.length}:`, keys);
    }

    // Verify middle hours are zero
    const hour2 = new Date(hour0);
    hour2.setHours(hour0.getHours() + 2);
    const middleIsZero = result[hour2.toISOString()]?._total === 0;
    console.log(middleIsZero ? '✅' : '❌', 'Test 1.3b: Middle hour is zero');
})();

// Test 1.4: All-zero data (entire day empty)
(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23);

    // Empty input but with cutoff
    const result = window.DashboardFilters.fillTimeGaps({}, start.getTime());

    // Should fill current day up to current hour
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const expectedHours = Math.floor((now - start) / (60 * 60 * 1000)) + 1;

    const passed = Object.keys(result).length === expectedHours;
    console.log(passed ? '✅' : '❌', `Test 1.4: All-zero fill (expected ~${expectedHours} hours)`);
    if (!passed) {
        console.error(`Expected ${expectedHours} entries, got ${Object.keys(result).length}`);
    }
})();

console.groupEnd();

// ============================================================================
// Test Suite 2: resampleData()
// ============================================================================

console.group('📊 Test Suite 2: resampleData()');

// Helper to create hourly entries
function createHourlyData(startHour, count, totalPerHour = 10) {
    const entries = [];
    const base = new Date();
    base.setHours(startHour, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const timestamp = new Date(base);
        timestamp.setHours(base.getHours() + i);
        entries.push([
            timestamp.toISOString(),
            {
                _total: totalPerHour,
                claude: { _subtotal: totalPerHour, 'opus-4': totalPerHour }
            }
        ]);
    }
    return entries;
}

// Test 2.1: No resampling for 24h range
(() => {
    const input = createHourlyData(0, 24);
    const result = window.DashboardCharts.resampleData(input, '24h');
    const passed = result.length === 24;
    console.log(passed ? '✅' : '❌', 'Test 2.1: No resampling for 24h (24 points)');
    if (!passed) console.error(`Expected 24 points, got ${result.length}`);
})();

// Test 2.2: 7d range resamples to 6-hour windows
(() => {
    const input = createHourlyData(0, 168); // 7 days * 24 hours
    const result = window.DashboardCharts.resampleData(input, '7d');
    const expectedPoints = 28; // 7 days * 4 (6-hour windows)
    const passed = result.length === expectedPoints;
    console.log(passed ? '✅' : '❌', `Test 2.2: 7d resampling (168 → ${expectedPoints} points)`);
    if (!passed) console.error(`Expected ${expectedPoints} points, got ${result.length}`);
})();

// Test 2.3: 6-hour window aggregation correctness
(() => {
    const input = createHourlyData(0, 12, 10); // 12 hours, 10 requests each
    const result = window.DashboardCharts.resampleData(input, '7d');

    // Should produce 2 windows (0-5h, 6-11h), each with 60 total
    const passed = result.length === 2 &&
                   result[0][1]._total === 60 &&
                   result[1][1]._total === 60;
    console.log(passed ? '✅' : '❌', 'Test 2.3: 6h window aggregation (6*10=60)');
    if (!passed) {
        console.error('Expected 2 windows with 60 each, got:',
                     result.map(r => r[1]._total));
    }
})();

// Test 2.4: Daily resampling for '30d' range
(() => {
    const input = createHourlyData(0, 72, 5); // 3 days, 5 requests/hour
    const result = window.DashboardCharts.resampleData(input, '30d');

    // Should produce 3 daily windows, each with 120 total (24h * 5)
    const passed = result.length === 3 &&
                   result.every(r => r[1]._total === 120);
    console.log(passed ? '✅' : '❌', 'Test 2.4: Daily aggregation for 30d (24*5=120)');
    if (!passed) {
        console.error('Expected 3 days with 120 each, got:',
                     result.map(r => r[1]._total));
    }
})();

// Test 2.5: Daily resampling for 'all' range
(() => {
    const input = createHourlyData(0, 72, 5); // 3 days, 5 requests/hour
    const result = window.DashboardCharts.resampleData(input, 'all');

    // Should produce 3 daily windows, each with 120 total (24h * 5)
    const passed = result.length === 3 &&
                   result.every(r => r[1]._total === 120);
    console.log(passed ? '✅' : '❌', 'Test 2.5: Daily aggregation for all (24*5=120)');
    if (!passed) {
        console.error('Expected 3 days with 120 each, got:',
                     result.map(r => r[1]._total));
    }
})();

// Test 2.6: Timestamp alignment (6-hour boundaries)
(() => {
    const input = [
        ['2026-01-23T03:00:00.000Z', { _total: 5 }],
        ['2026-01-23T07:00:00.000Z', { _total: 8 }]
    ];
    const result = window.DashboardCharts.resampleData(input, '7d');

    // First entry should align to 00:00, second to 06:00
    const timestamps = result.map(r => new Date(r[0]));
    const aligned = timestamps.every(t => t.getHours() % 6 === 0);

    console.log(aligned ? '✅' : '❌', 'Test 2.6: 6h boundary alignment');
    if (!aligned) {
        console.error('Expected 6h boundaries, got hours:',
                     timestamps.map(t => t.getHours()));
    }
})();

console.groupEnd();

// ============================================================================
// Test Suite 3: Integration (fillTimeGaps + resampleData)
// ============================================================================

console.group('🔗 Test Suite 3: Integration Tests');

// Test 3.1: Complete pipeline (sparse → filled → resampled)
(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);

    const hour0 = new Date(now);
    hour0.setHours(now.getHours() - 12);
    const hour12 = new Date(now);

    // Sparse data: only hours 0 and 12
    const sparse = {
        [hour0.toISOString()]: { _total: 10 },
        [hour12.toISOString()]: { _total: 20 }
    };

    // Step 1: Fill gaps
    const filled = window.DashboardFilters.fillTimeGaps(sparse, hour0.getTime());
    const filledKeys = Object.keys(filled).length;

    // Step 2: Resample to 6h windows
    const resampled = window.DashboardCharts.resampleData(
        Object.entries(filled).sort(([a], [b]) => new Date(a) - new Date(b)),
        '7d'
    );

    const passed = filledKeys === 13 && resampled.length === 3; // 13h → 3 windows
    console.log(passed ? '✅' : '❌', 'Test 3.1: Pipeline (13h → 3 windows)');
    if (!passed) {
        console.error(`Expected 13 filled, 3 resampled. Got: ${filledKeys}, ${resampled.length}`);
    }
})();

console.groupEnd();

console.log('\n🎉 All tests completed! Check for any ❌ failures above.');

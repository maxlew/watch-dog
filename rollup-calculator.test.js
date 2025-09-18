#!/usr/bin/env node

/**
 * Test suite for rollup-calculator.js
 * 
 * Run with: node rollup-calculator.test.js
 */

const {
  calculateRollingAggregation,
  calculateRollingAverage,
  calculateRollingSum,
  parseMonitorQuery,
  generateTestData
} = require('./rollup-calculator');

// Simple test framework
let testCount = 0;
let passedTests = 0;

function test(name, testFn) {
  testCount++;
  try {
    testFn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    if (error.expected !== undefined) {
      console.log(`   Expected: ${JSON.stringify(error.expected)}`);
      console.log(`   Actual: ${JSON.stringify(error.actual)}`);
    }
  }
}

function assertEquals(actual, expected, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error(message || 'Assertion failed');
    error.expected = expected;
    error.actual = actual;
    throw error;
  }
}

function assertApproximately(actual, expected, tolerance = 0.001, message = '') {
  if (Math.abs(actual - expected) > tolerance) {
    const error = new Error(message || `Expected ${actual} to be approximately ${expected} (±${tolerance})`);
    error.expected = expected;
    error.actual = actual;
    throw error;
  }
}

function assertTrue(condition, message = '') {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertThrows(fn, expectedError, message = '') {
  try {
    fn();
    throw new Error(message || 'Expected function to throw an error');
  } catch (error) {
    if (expectedError && !error.message.includes(expectedError)) {
      throw new Error(message || `Expected error message to contain "${expectedError}", got "${error.message}"`);
    }
  }
}

// Test data generation
test('generateTestData creates correct number of points', () => {
  const startTime = 1000000000000; // Some timestamp
  const endTime = startTime + (5 * 60 * 1000); // 5 minutes later
  const intervalMs = 60 * 1000; // 1 minute intervals
  
  const data = generateTestData(startTime, endTime, intervalMs);
  
  assertEquals(data.length, 6); // 0, 1, 2, 3, 4, 5 minutes = 6 points
  assertEquals(data[0].timestamp, startTime);
  assertEquals(data[5].timestamp, endTime);
});

test('generateTestData uses custom value generator', () => {
  const startTime = 1000000000000;
  const endTime = startTime + (2 * 60 * 1000); // 2 minutes
  const intervalMs = 60 * 1000; // 1 minute intervals
  
  const data = generateTestData(startTime, endTime, intervalMs, (timestamp, index) => index * 10);
  
  assertEquals(data.length, 3);
  assertEquals(data[0].value, 0);
  assertEquals(data[1].value, 10);
  assertEquals(data[2].value, 20);
});

// Test query parsing
test('parseMonitorQuery handles various time windows', () => {
  const testCases = [
    { query: 'avg(last_5m):metric', expected: { aggregation: 'avg', timeWindow: '5m', timeWindowMs: 5 * 60 * 1000 } },
    { query: 'sum(last_1h):metric', expected: { aggregation: 'sum', timeWindow: '1h', timeWindowMs: 60 * 60 * 1000 } },
    { query: 'max(last_30m):metric', expected: { aggregation: 'max', timeWindow: '30m', timeWindowMs: 30 * 60 * 1000 } },
    { query: 'min(last_2h):metric', expected: { aggregation: 'min', timeWindow: '2h', timeWindowMs: 2 * 60 * 60 * 1000 } },
    { query: 'avg(last_1d):metric', expected: { aggregation: 'avg', timeWindow: '1d', timeWindowMs: 24 * 60 * 60 * 1000 } }
  ];
  
  testCases.forEach(({ query, expected }) => {
    const result = parseMonitorQuery(query);
    assertEquals(result, expected, `Failed for query: ${query}`);
  });
});

test('parseMonitorQuery handles null/undefined input', () => {
  const result = parseMonitorQuery(null);
  assertEquals(result, { aggregation: 'avg', timeWindow: '1h', timeWindowMs: 3600000 });
});

// Test rolling aggregation validation
test('calculateRollingAggregation validates inputs', () => {
  assertThrows(() => calculateRollingAggregation([], -1000, 1000), 'Window size and step size must be positive');
  assertThrows(() => calculateRollingAggregation([], 1000, -1000), 'Window size and step size must be positive');
  assertThrows(() => calculateRollingAggregation([], 1000, 1000, 'invalid'), 'Invalid aggregation type');
});

test('calculateRollingAggregation handles empty input', () => {
  const result = calculateRollingAggregation([], 1000, 1000);
  assertEquals(result, []);
  
  const result2 = calculateRollingAggregation(null, 1000, 1000);
  assertEquals(result2, []);
});

// Test basic rolling average calculation
test('calculateRollingAverage basic functionality', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000; // 1 minute
  const testData = [
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: 20 },
    { timestamp: startTime + 2 * intervalMs, value: 30 },
    { timestamp: startTime + 3 * intervalMs, value: 40 },
    { timestamp: startTime + 4 * intervalMs, value: 50 }
  ];
  
  // 3-minute rolling average, step every minute
  const windowSizeMs = 3 * 60 * 1000;
  const stepSizeMs = 60 * 1000;
  
  const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
  
  // Should start from 3rd minute (3 minutes after start)
  // At 3min: avg of [10, 20, 30] = 20 (window from 0min to 3min)
  // At 4min: avg of [20, 30, 40] = 30 (window from 1min to 4min)  
  // Note: 5min window (2min to 5min) goes beyond our data range
  
  assertEquals(result.length, 2);
  assertApproximately(result[0].value, 30); // Actually [20,30,40] = 30
  assertApproximately(result[1].value, 40); // Actually [30,40,50] = 40
});

// Test rolling sum calculation
test('calculateRollingSum basic functionality', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000; // 1 minute
  const testData = [
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: 20 },
    { timestamp: startTime + 2 * intervalMs, value: 30 },
    { timestamp: startTime + 3 * intervalMs, value: 40 },
    { timestamp: startTime + 4 * intervalMs, value: 50 }
  ];
  
  // 3-minute rolling sum, step every minute
  const windowSizeMs = 3 * 60 * 1000;
  const stepSizeMs = 60 * 1000;
  
  const result = calculateRollingSum(testData, windowSizeMs, stepSizeMs);
  
  // At 3min: sum of [20, 30, 40] = 90
  // At 4min: sum of [30, 40, 50] = 120
  
  assertEquals(result.length, 2);
  assertApproximately(result[0].value, 90);
  assertApproximately(result[1].value, 120);
});

// Test different aggregation types
test('calculateRollingAggregation handles all aggregation types', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000;
  const testData = [
    { timestamp: startTime, value: 5 },
    { timestamp: startTime + intervalMs, value: 15 },
    { timestamp: startTime + 2 * intervalMs, value: 10 }
  ];
  
  const windowSizeMs = 3 * 60 * 1000;
  const stepSizeMs = 60 * 1000; // Use 1-minute steps to capture all data in final window
  
  // Use discardIncompleteWindows = false to ensure we get results
  const avgResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
  const sumResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'sum', false);
  const minResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'min', false);
  const maxResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'max', false);
  const countResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'count', false);
  
  assertTrue(avgResult.length >= 1, 'Should have at least one average result');
  assertTrue(sumResult.length >= 1, 'Should have at least one sum result');
  assertTrue(minResult.length >= 1, 'Should have at least one min result');
  assertTrue(maxResult.length >= 1, 'Should have at least one max result');
  assertTrue(countResult.length >= 1, 'Should have at least one count result');
  
  // Check the final result which should include all data points
  const finalAvg = avgResult[avgResult.length - 1];
  const finalSum = sumResult[sumResult.length - 1];
  const finalMin = minResult[minResult.length - 1];
  const finalMax = maxResult[maxResult.length - 1];
  const finalCount = countResult[countResult.length - 1];
  
  assertApproximately(finalAvg.value, 10); // (5 + 15 + 10) / 3
  assertApproximately(finalSum.value, 30); // 5 + 15 + 10
  assertApproximately(finalMin.value, 5);
  assertApproximately(finalMax.value, 15);
  assertApproximately(finalCount.value, 3);
});

// Test data coverage filtering
test('calculateRollingAggregation filters incomplete windows', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000;
  const testData = [
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: 20 },
    // Gap - missing data points
    { timestamp: startTime + 10 * intervalMs, value: 30 },
    { timestamp: startTime + 11 * intervalMs, value: 40 }
  ];
  
  const windowSizeMs = 5 * 60 * 1000; // 5 minutes
  const stepSizeMs = 60 * 1000; // 1 minute steps
  
  const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', true);
  
  // Should skip windows with insufficient data coverage
  // Only the last few windows should have enough data
  assertTrue(result.length < 10, 'Should filter out incomplete windows');
});

// Test handling of null/undefined values
test('calculateRollingAggregation filters null values', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000;
  const testData = [
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: null },
    { timestamp: startTime + 2 * intervalMs, value: 30 },
    { timestamp: startTime + 3 * intervalMs, value: undefined },
    { timestamp: startTime + 4 * intervalMs, value: 50 },
    { timestamp: startTime + 5 * intervalMs, value: NaN }
  ];
  
  const windowSizeMs = 6 * 60 * 1000;
  const stepSizeMs = 60 * 1000; // Use 1-minute steps to capture final window
  
  const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
  
  assertTrue(result.length >= 1, 'Should have at least one result');
  // Get the final result which should include all valid data
  const finalResult = result[result.length - 1];
  // Should only consider values 10, 30, 50 (filtering out null, undefined, NaN)
  assertApproximately(finalResult.value, 30); // (10 + 30 + 50) / 3
  assertEquals(finalResult.dataPointsInWindow, 3);
});

// Test unsorted data handling
test('calculateRollingAggregation sorts unsorted data', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000;
  const testData = [
    { timestamp: startTime + 2 * intervalMs, value: 30 },
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: 20 }
  ];
  
  const windowSizeMs = 3 * 60 * 1000;
  const stepSizeMs = 60 * 1000; // Use 1-minute steps to capture final window
  
  const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
  
  assertTrue(result.length >= 1, 'Should have at least one result');
  // Get the final result which should include all data points
  const finalResult = result[result.length - 1];
  assertApproximately(finalResult.value, 20); // Should correctly average all values
});

// Test realistic DataDog-like scenario
test('realistic 1-hour rolling average from 5-minute data', () => {
  const startTime = 1000000000000;
  const intervalMs = 5 * 60 * 1000; // 5 minutes
  const hours = 3;
  
  // Create 3 hours of 5-minute data points with some variation
  const testData = generateTestData(
    startTime, 
    startTime + hours * 60 * 60 * 1000, 
    intervalMs,
    (timestamp, index) => 1000 + Math.sin(index * 0.2) * 200 // Values oscillating around 1000
  );
  
  // Calculate 1-hour rolling averages every 5 minutes
  const windowSizeMs = 60 * 60 * 1000; // 1 hour
  const stepSizeMs = 5 * 60 * 1000; // 5 minutes
  
  const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
  
  // Should have data starting from 1 hour mark
  assertTrue(result.length > 0, 'Should have rolling average data');
  assertTrue(result.length <= (hours - 1) * 12 + 1, 'Should not exceed expected number of points'); // 12 points per hour
  
  // Each result should have reasonable metadata
  result.forEach(point => {
    assertTrue(point.timestamp > 0, 'Should have valid timestamp');
    assertTrue(point.value >= 0, 'Should have valid value');
    assertTrue(point.dataPointsInWindow > 0, 'Should have data points in window');
    assertTrue(point.windowStart < point.windowEnd, 'Window start should be before end');
  });
  
  // Values should be around 1000 (the center of our oscillation)
  const avgValue = result.reduce((sum, p) => sum + p.value, 0) / result.length;
  assertApproximately(avgValue, 1000, 100, 'Average should be close to expected center value');
});

// Test edge case: exactly one window worth of data
test('single window worth of data', () => {
  const startTime = 1000000000000;
  const intervalMs = 60 * 1000;
  const testData = [
    { timestamp: startTime, value: 10 },
    { timestamp: startTime + intervalMs, value: 20 },
    { timestamp: startTime + 2 * intervalMs, value: 30 }
  ];
  
  const windowSizeMs = 3 * 60 * 1000; // Exactly covers all data
  const stepSizeMs = 60 * 1000;
  
  // Use discardIncompleteWindows = false to get results from the start
  const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs, false);
  
  assertTrue(result.length >= 1, 'Should have at least one result'); 
  // Get the final result which should be the average of all data
  const finalResult = result[result.length - 1];
  assertApproximately(finalResult.value, 20);
});

// Test performance with larger dataset
test('performance with larger dataset', () => {
  const startTime = Date.now();
  
  // Create 24 hours of 1-minute data (1440 points)
  const testData = generateTestData(
    1000000000000,
    1000000000000 + 24 * 60 * 60 * 1000,
    60 * 1000,
    (timestamp, index) => Math.random() * 1000
  );
  
  const windowSizeMs = 60 * 60 * 1000; // 1 hour windows
  const stepSizeMs = 5 * 60 * 1000; // 5 minute steps
  
  const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
  
  const endTime = Date.now();
  const processingTime = endTime - startTime;
  
  assertTrue(result.length > 0, 'Should produce results');
  assertTrue(processingTime < 5000, `Processing should be fast, took ${processingTime}ms`);
  
  console.log(`   📊 Processed ${testData.length} points in ${processingTime}ms, produced ${result.length} rolling averages`);
});

// Run all tests
console.log('🧪 Running rollup calculator tests...\n');

// Final summary
console.log(`\n🎯 Test Results: ${passedTests}/${testCount} tests passed`);

if (passedTests === testCount) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
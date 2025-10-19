/**
 * Test suite for rollup-calculator.js using Jest
 */

const {
  calculateRollingAggregation,
  calculateRollingAverage,
  calculateRollingSum,
  parseMonitorQuery,
  generateTestData
} = require('./rollup-calculator');

describe('generateTestData', () => {
  it('creates correct number of points', () => {
    const startTime = 1000000000000;
    const endTime = startTime + (5 * 60 * 1000);
    const intervalMs = 60 * 1000;
    
    const data = generateTestData(startTime, endTime, intervalMs);
    
    expect(data).toHaveLength(6);
    expect(data[0].timestamp).toBe(startTime);
    expect(data[5].timestamp).toBe(endTime);
  });

  it('uses custom value generator', () => {
    const startTime = 1000000000000;
    const endTime = startTime + (2 * 60 * 1000);
    const intervalMs = 60 * 1000;
    
    const data = generateTestData(startTime, endTime, intervalMs, (timestamp, index) => index * 10);
    
    expect(data).toHaveLength(3);
    expect(data[0].value).toBe(0);
    expect(data[1].value).toBe(10);
    expect(data[2].value).toBe(20);
  });
});

describe('parseMonitorQuery', () => {
  it('handles various time windows', () => {
    const testCases = [
      { query: 'avg(last_5m):metric', expected: { aggregation: 'avg', timeWindow: '5m', timeWindowMs: 5 * 60 * 1000 } },
      { query: 'sum(last_1h):metric', expected: { aggregation: 'sum', timeWindow: '1h', timeWindowMs: 60 * 60 * 1000 } },
      { query: 'max(last_30m):metric', expected: { aggregation: 'max', timeWindow: '30m', timeWindowMs: 30 * 60 * 1000 } },
      { query: 'min(last_2h):metric', expected: { aggregation: 'min', timeWindow: '2h', timeWindowMs: 2 * 60 * 60 * 1000 } },
      { query: 'avg(last_1d):metric', expected: { aggregation: 'avg', timeWindow: '1d', timeWindowMs: 24 * 60 * 60 * 1000 } }
    ];
    
    testCases.forEach(({ query, expected }) => {
      const result = parseMonitorQuery(query);
      expect(result).toEqual(expected);
    });
  });

  it('handles null/undefined input', () => {
    const result = parseMonitorQuery(null);
    expect(result).toEqual({ aggregation: 'avg', timeWindow: '1h', timeWindowMs: 3600000 });
  });
});

describe('calculateRollingAggregation', () => {
  it('validates inputs', () => {
    expect(() => calculateRollingAggregation([], -1000, 1000)).toThrow('Window size and step size must be positive');
    expect(() => calculateRollingAggregation([], 1000, -1000)).toThrow('Window size and step size must be positive');
    expect(() => calculateRollingAggregation([], 1000, 1000, 'invalid')).toThrow('Invalid aggregation type');
  });

  it('handles empty input', () => {
    const result = calculateRollingAggregation([], 1000, 1000);
    expect(result).toEqual([]);
    
    const result2 = calculateRollingAggregation(null, 1000, 1000);
    expect(result2).toEqual([]);
  });

  it('handles all aggregation types', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime, value: 5 },
      { timestamp: startTime + intervalMs, value: 15 },
      { timestamp: startTime + 2 * intervalMs, value: 10 }
    ];
    
    const windowSizeMs = 3 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const avgResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
    const sumResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'sum', false);
    const minResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'min', false);
    const maxResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'max', false);
    const countResult = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'count', false);
    
    expect(avgResult.length).toBeGreaterThanOrEqual(1);
    expect(sumResult.length).toBeGreaterThanOrEqual(1);
    expect(minResult.length).toBeGreaterThanOrEqual(1);
    expect(maxResult.length).toBeGreaterThanOrEqual(1);
    expect(countResult.length).toBeGreaterThanOrEqual(1);
    
    const finalAvg = avgResult[avgResult.length - 1];
    const finalSum = sumResult[sumResult.length - 1];
    const finalMin = minResult[minResult.length - 1];
    const finalMax = maxResult[maxResult.length - 1];
    const finalCount = countResult[countResult.length - 1];
    
    expect(finalAvg.value).toBeCloseTo(10);
    expect(finalSum.value).toBeCloseTo(30);
    expect(finalMin.value).toBeCloseTo(5);
    expect(finalMax.value).toBeCloseTo(15);
    expect(finalCount.value).toBeCloseTo(3);
  });

  it('filters incomplete windows', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime, value: 10 },
      { timestamp: startTime + intervalMs, value: 20 },
      { timestamp: startTime + 10 * intervalMs, value: 30 },
      { timestamp: startTime + 11 * intervalMs, value: 40 }
    ];
    
    const windowSizeMs = 5 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', true);
    
    expect(result.length).toBeLessThan(10);
  });

  it('filters null values', () => {
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
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
    
    expect(result.length).toBeGreaterThanOrEqual(1);
    const finalResult = result[result.length - 1];
    expect(finalResult.value).toBeCloseTo(30);
    expect(finalResult.dataPointsInWindow).toBe(3);
  });

  it('sorts unsorted data', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime + 2 * intervalMs, value: 30 },
      { timestamp: startTime, value: 10 },
      { timestamp: startTime + intervalMs, value: 20 }
    ];
    
    const windowSizeMs = 3 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingAggregation(testData, windowSizeMs, stepSizeMs, 'avg', false);
    
    expect(result.length).toBeGreaterThanOrEqual(1);
    const finalResult = result[result.length - 1];
    expect(finalResult.value).toBeCloseTo(20);
  });
});

describe('calculateRollingAverage', () => {
  it('basic functionality', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime, value: 10 },
      { timestamp: startTime + intervalMs, value: 20 },
      { timestamp: startTime + 2 * intervalMs, value: 30 },
      { timestamp: startTime + 3 * intervalMs, value: 40 },
      { timestamp: startTime + 4 * intervalMs, value: 50 }
    ];
    
    const windowSizeMs = 3 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
    
    expect(result).toHaveLength(2);
    expect(result[0].value).toBeCloseTo(30);
    expect(result[1].value).toBeCloseTo(40);
  });

  it('single window worth of data', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime, value: 10 },
      { timestamp: startTime + intervalMs, value: 20 },
      { timestamp: startTime + 2 * intervalMs, value: 30 }
    ];
    
    const windowSizeMs = 3 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs, false);
    
    expect(result.length).toBeGreaterThanOrEqual(1);
    const finalResult = result[result.length - 1];
    expect(finalResult.value).toBeCloseTo(20);
  });
});

describe('calculateRollingSum', () => {
  it('basic functionality', () => {
    const startTime = 1000000000000;
    const intervalMs = 60 * 1000;
    const testData = [
      { timestamp: startTime, value: 10 },
      { timestamp: startTime + intervalMs, value: 20 },
      { timestamp: startTime + 2 * intervalMs, value: 30 },
      { timestamp: startTime + 3 * intervalMs, value: 40 },
      { timestamp: startTime + 4 * intervalMs, value: 50 }
    ];
    
    const windowSizeMs = 3 * 60 * 1000;
    const stepSizeMs = 60 * 1000;
    
    const result = calculateRollingSum(testData, windowSizeMs, stepSizeMs);
    
    expect(result).toHaveLength(2);
    expect(result[0].value).toBeCloseTo(90);
    expect(result[1].value).toBeCloseTo(120);
  });
});

describe('realistic scenarios', () => {
  it('1-hour rolling average from 5-minute data', () => {
    const startTime = 1000000000000;
    const intervalMs = 5 * 60 * 1000;
    const hours = 3;
    
    const testData = generateTestData(
      startTime, 
      startTime + hours * 60 * 60 * 1000, 
      intervalMs,
      (timestamp, index) => 1000 + Math.sin(index * 0.2) * 200
    );
    
    const windowSizeMs = 60 * 60 * 1000;
    const stepSizeMs = 5 * 60 * 1000;
    
    const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
    
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual((hours - 1) * 12 + 1);
    
    result.forEach(point => {
      expect(point.timestamp).toBeGreaterThan(0);
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.dataPointsInWindow).toBeGreaterThan(0);
      expect(point.windowStart).toBeLessThan(point.windowEnd);
    });
    
    const avgValue = result.reduce((sum, p) => sum + p.value, 0) / result.length;
    expect(Math.abs(avgValue - 1000)).toBeLessThan(100); // Values oscillate around 1000
  });

  it('performance with larger dataset', () => {
    const startTime = Date.now();
    
    const testData = generateTestData(
      1000000000000,
      1000000000000 + 24 * 60 * 60 * 1000,
      60 * 1000,
      (timestamp, index) => Math.random() * 1000
    );
    
    const windowSizeMs = 60 * 60 * 1000;
    const stepSizeMs = 5 * 60 * 1000;
    
    const result = calculateRollingAverage(testData, windowSizeMs, stepSizeMs);
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    expect(result.length).toBeGreaterThan(0);
    expect(processingTime).toBeLessThan(5000);
    
    console.log(`   📊 Processed ${testData.length} points in ${processingTime}ms, produced ${result.length} rolling averages`);
  });
});

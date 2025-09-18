/**
 * Rolling Window Aggregation Calculator
 * 
 * This module provides functions to calculate rolling window aggregations
 * from time series data, particularly useful for computing rolling averages,
 * sums, and other statistics over specified time windows.
 */

/**
 * Calculate rolling aggregations over a specified time window
 * 
 * @param {Array} dataPoints - Array of {timestamp, value} objects, sorted by timestamp
 * @param {number} windowSizeMs - Size of rolling window in milliseconds (e.g., 3600000 for 1 hour)
 * @param {number} stepSizeMs - Step size between calculations in milliseconds (e.g., 300000 for 5 minutes)
 * @param {string} aggregation - Type of aggregation: 'avg', 'sum', 'min', 'max', 'count'
 * @param {boolean} discardIncompleteWindows - Whether to discard windows without full data coverage
 * @returns {Array} Array of {timestamp, value} objects representing rolled-up data
 */
function calculateRollingAggregation(dataPoints, windowSizeMs, stepSizeMs, aggregation = 'avg', discardIncompleteWindows = true) {
  // Validate inputs first
  if (windowSizeMs <= 0 || stepSizeMs <= 0) {
    throw new Error('Window size and step size must be positive');
  }

  const validAggregations = ['avg', 'sum', 'min', 'max', 'count'];
  if (!validAggregations.includes(aggregation)) {
    throw new Error(`Invalid aggregation type. Must be one of: ${validAggregations.join(', ')}`);
  }

  if (!dataPoints || dataPoints.length === 0) {
    return [];
  }

  // Ensure data is sorted by timestamp
  const sortedData = [...dataPoints].sort((a, b) => a.timestamp - b.timestamp);
  
  if (sortedData.length === 0) {
    return [];
  }

  const rollingData = [];
  const firstTimestamp = sortedData[0].timestamp;
  const lastTimestamp = sortedData[sortedData.length - 1].timestamp;
  
  // Start from first timestamp + window size to ensure we have enough data for the first window
  const startTime = discardIncompleteWindows ? firstTimestamp + windowSizeMs : firstTimestamp;
  
  // Generate rolling aggregations at each step
  for (let currentTime = startTime; currentTime <= lastTimestamp; currentTime += stepSizeMs) {
    const windowStart = currentTime - windowSizeMs;
    const windowEnd = currentTime;
    
    // Find all points within this window (exclusive start, inclusive end)
    const windowPoints = sortedData.filter(point => 
      point.timestamp > windowStart && point.timestamp <= windowEnd
    );
    
    if (windowPoints.length === 0) {
      continue;
    }
    
    // For incomplete windows, optionally skip if not enough data coverage
    // Only apply this filtering when we have sparse data with big gaps
    if (discardIncompleteWindows && windowPoints.length > 0) {
      // Check if data points are reasonably distributed throughout the window
      const windowSpan = windowEnd - windowStart;
      const dataSpan = windowPoints[windowPoints.length - 1].timestamp - windowPoints[0].timestamp;
      
      // Skip if data only covers less than 25% of the window span
      if (dataSpan < windowSpan * 0.25 && windowPoints.length < 3) {
        continue;
      }
    }
    
    // Calculate aggregation value
    let aggregatedValue;
    const values = windowPoints.map(p => p.value).filter(v => v !== null && v !== undefined && !isNaN(v));
    
    if (values.length === 0) {
      continue;
    }
    
    switch (aggregation) {
      case 'avg':
        aggregatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
        break;
      case 'sum':
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
        break;
      case 'min':
        aggregatedValue = Math.min(...values);
        break;
      case 'max':
        aggregatedValue = Math.max(...values);
        break;
      case 'count':
        aggregatedValue = values.length;
        break;
      default:
        throw new Error(`Unsupported aggregation: ${aggregation}`);
    }
    
    rollingData.push({
      timestamp: currentTime,
      value: aggregatedValue,
      windowStart: windowStart,
      windowEnd: windowEnd,
      dataPointsInWindow: values.length
    });
  }
  
  return rollingData;
}

/**
 * Calculate rolling average over a time window
 * Convenience wrapper for calculateRollingAggregation with 'avg'
 */
function calculateRollingAverage(dataPoints, windowSizeMs, stepSizeMs = windowSizeMs / 12, discardIncompleteWindows = true) {
  return calculateRollingAggregation(dataPoints, windowSizeMs, stepSizeMs, 'avg', discardIncompleteWindows);
}

/**
 * Calculate rolling sum over a time window
 * Convenience wrapper for calculateRollingAggregation with 'sum'
 */
function calculateRollingSum(dataPoints, windowSizeMs, stepSizeMs = windowSizeMs / 12, discardIncompleteWindows = true) {
  return calculateRollingAggregation(dataPoints, windowSizeMs, stepSizeMs, 'sum', discardIncompleteWindows);
}

/**
 * Parse DataDog monitor query to extract aggregation type and time window
 * 
 * @param {string} query - DataDog monitor query
 * @returns {object} Object with aggregation, timeWindow, and timeWindowMs
 */
function parseMonitorQuery(query) {
  if (!query) {
    return { aggregation: 'avg', timeWindow: '1h', timeWindowMs: 3600000 };
  }

  // Extract time window (e.g., last_1h, last_5m, last_30m)
  const timeWindowMatch = query.match(/last_(\d+)([mhd])/);
  let timeWindowMs = 3600000; // Default to 1 hour
  let timeWindow = '1h';
  
  if (timeWindowMatch) {
    const value = parseInt(timeWindowMatch[1]);
    const unit = timeWindowMatch[2];
    
    switch (unit) {
      case 'm':
        timeWindowMs = value * 60 * 1000;
        timeWindow = `${value}m`;
        break;
      case 'h':
        timeWindowMs = value * 60 * 60 * 1000;
        timeWindow = `${value}h`;
        break;
      case 'd':
        timeWindowMs = value * 24 * 60 * 60 * 1000;
        timeWindow = `${value}d`;
        break;
    }
  }

  // Extract aggregation type from the query prefix
  let aggregation = 'avg';
  if (query.startsWith('sum(')) {
    aggregation = 'sum';
  } else if (query.startsWith('min(')) {
    aggregation = 'min';
  } else if (query.startsWith('max(')) {
    aggregation = 'max';
  } else if (query.startsWith('avg(')) {
    aggregation = 'avg';
  }

  return {
    aggregation,
    timeWindow,
    timeWindowMs
  };
}

/**
 * Generate test data for validation
 * Creates evenly spaced data points over a time range
 */
function generateTestData(startTime, endTime, intervalMs, valueGenerator = (timestamp, index) => Math.sin(index * 0.1) * 100 + 100) {
  const testData = [];
  let index = 0;
  
  for (let timestamp = startTime; timestamp <= endTime; timestamp += intervalMs) {
    testData.push({
      timestamp,
      value: valueGenerator(timestamp, index++)
    });
  }
  
  return testData;
}

module.exports = {
  calculateRollingAggregation,
  calculateRollingAverage,
  calculateRollingSum,
  parseMonitorQuery,
  generateTestData
};
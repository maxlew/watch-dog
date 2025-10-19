/**
 * DataDog Monitor Data Fetcher
 * 
 * Provides clean, optimized data fetching for DataDog monitors with automatic
 * rollup selection based on time range and data density requirements.
 */

try {
  process.loadEnvFile();
} catch {
  // .env file not found or error loading, continue without it
}
const { client, v1 } = require('@datadog/datadog-api-client');
const { parseMonitorQuery } = require('./rollup-calculator');

// Configure DataDog client
const configuration = client.createConfiguration({
  authMethods: {
    apiKeyAuth: process.env.DD_API_KEY,
    appKeyAuth: process.env.DD_APP_KEY,
  },
});

const monitorsApi = new v1.MonitorsApi(configuration);
const metricsApi = new v1.MetricsApi(configuration);

/**
 * Extract the metric query part from a DataDog monitor query
 * @param {string} query - Full monitor query 
 * @returns {string} - Clean metric query without evaluation window or comparison
 */
function extractMetricQuery(query) {
  // Extract the metric part from DataDog monitor query
  // Pattern: sum(last_1h):sum:jobs.process.count{tags}.as_count() < 100000
  // We want: sum:jobs.process.count{tags}.as_count()
  
  const match = query.match(/:\s*(.+?)\s*[<>=]/);
  if (match) {
    return match[1].trim();
  }
  
  // Fallback: extract after colon and before comparison
  const parts = query.split(/[><=!]/);
  if (parts.length > 0) {
    const metricPart = parts[0].trim();
    const colonIndex = metricPart.lastIndexOf(':');
    if (colonIndex !== -1) {
      return metricPart.substring(colonIndex + 1).trim();
    }
    return metricPart;
  }
  return query;
}

/**
 * Parse a date string or Date object into a timestamp
 * @param {string|Date|number} date - Date in various formats
 * @returns {number} - Unix timestamp in seconds
 */
function parseDate(date) {
  if (typeof date === 'number') {
    return date > 1e10 ? Math.floor(date / 1000) : date; // Handle both seconds and milliseconds
  }
  if (typeof date === 'string') {
    const parsed = new Date(date);
    return Math.floor(parsed.getTime() / 1000);
  }
  if (date instanceof Date) {
    return Math.floor(date.getTime() / 1000);
  }
  throw new Error(`Invalid date format: ${date}`);
}

/**
 * Calculate optimal rollup interval based on time range
 * @param {number} timeRangeSeconds - Time range in seconds
 * @returns {object} - Rollup configuration
 */
function getOptimalRollup(timeRangeSeconds) {
  const hours = timeRangeSeconds / 3600;
  
  if (hours <= 6) {
    // 6 hours or less: 5-minute rollup
    return { seconds: 300, description: '5-minute', expectedPoints: Math.ceil(hours * 12) };
  } else if (hours <= 24) {
    // Up to 1 day: 10-minute rollup  
    return { seconds: 600, description: '10-minute', expectedPoints: Math.ceil(hours * 6) };
  } else if (hours <= 72) {
    // Up to 3 days: 30-minute rollup
    return { seconds: 1800, description: '30-minute', expectedPoints: Math.ceil(hours * 2) };
  } else if (hours <= 168) {
    // Up to 1 week: 1-hour rollup
    return { seconds: 3600, description: '1-hour', expectedPoints: Math.ceil(hours) };
  } else {
    // More than 1 week: 4-hour rollup
    return { seconds: 14400, description: '4-hour', expectedPoints: Math.ceil(hours / 4) };
  }
}

/**
 * Fetch monitor metadata and configuration
 * @param {string|number} monitorId - DataDog monitor ID
 * @returns {Promise<object>} - Monitor configuration
 */
async function getMonitorConfig(monitorId) {
  try {
    const monitor = await monitorsApi.getMonitor({ monitorId: parseInt(monitorId) });
    const queryInfo = parseMonitorQuery(monitor.query);
    const metricQuery = extractMetricQuery(monitor.query);
    
    return {
      id: monitor.id,
      name: monitor.name,
      query: monitor.query,
      state: monitor.overallState,
      metricQuery,
      queryInfo,
      thresholds: monitor.options?.thresholds || {}
    };
  } catch (error) {
    throw new Error(`Failed to fetch monitor ${monitorId}: ${error.message}`);
  }
}

/**
 * Fetch raw metric data from DataDog with automatic rollup optimization
 * @param {string} metricQuery - Clean metric query
 * @param {string} aggregation - Aggregation function (sum, avg, etc.)
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds  
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} - Processed metric data
 */
async function fetchRawMetricData(metricQuery, aggregation, startTime, endTime, options = {}) {
  const { 
    rollupOverride = null, 
    debug = false 
  } = options;
  
  const timeRangeSeconds = endTime - startTime;
  const rollup = rollupOverride || getOptimalRollup(timeRangeSeconds);
  
  // Build the complete query with rollup
  const queryWithRollup = metricQuery.replace(/.rollup([^)]+)/, '') + `.rollup(${aggregation}, ${rollup.seconds})`;
  
  if (debug) {
    console.log(`   Query: ${queryWithRollup}`);
    console.log(`   Rollup: ${rollup.description} (${rollup.seconds}s)`);
    console.log(`   Expected points: ~${rollup.expectedPoints}`);
    console.log(`   Time range: ${new Date(startTime * 1000).toLocaleString()} to ${new Date(endTime * 1000).toLocaleString()}`);
  }
  
  try {
    const response = await metricsApi.queryMetrics({
      query: queryWithRollup,
      from: startTime,
      to: endTime
    });
    
    if (!response.series || response.series.length === 0) {
      return {
        data: [],
        metadata: {
          rollup,
          timeRange: { start: startTime, end: endTime },
          coverage: 0,
          query: queryWithRollup
        }
      };
    }
    
    // Process all data points
    const processedData = [];
    
    response.series.forEach((series) => {
      if (series.pointlist) {
        series.pointlist.forEach((point) => {
          if (point[1] !== null && point[1] !== undefined && !isNaN(point[1])) {
            processedData.push({
              timestamp: point[0], // DataDog returns milliseconds
              value: point[1]
            });
          }
        });
      }
    });
    
    // Sort by timestamp
    processedData.sort((a, b) => a.timestamp - b.timestamp);
    
    const coverage = rollup.expectedPoints > 0 ? (processedData.length / rollup.expectedPoints) * 100 : 0;
    
    if (debug) {
      console.log(`   Fetched: ${processedData.length} points`);
      console.log(`   Coverage: ${coverage.toFixed(1)}%`);
      if (processedData.length > 0) {
        console.log(`   Actual span: ${new Date(processedData[0].timestamp).toLocaleString()} to ${new Date(processedData[processedData.length - 1].timestamp).toLocaleString()}`);
      }
    }
    
    return {
      data: processedData,
      metadata: {
        rollup,
        timeRange: { start: startTime, end: endTime },
        coverage,
        query: queryWithRollup,
        actualTimeSpan: processedData.length > 0 ? {
          start: processedData[0].timestamp,
          end: processedData[processedData.length - 1].timestamp
        } : null
      }
    };
    
  } catch (error) {
    throw new Error(`Failed to fetch metric data: ${error.message}`);
  }
}

/**
 * Fetch monitor data for a specific date with optimal rollup
 * @param {string|number} monitorId - DataDog monitor ID
 * @param {string|Date} date - Date to fetch (YYYY-MM-DD format or Date object)
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} - Complete monitor data
 */
async function fetchMonitorData(monitorId, date, options = {}) {
  const { debug = false, rollupOverride = null } = options;
  
  if (debug) {
    console.log(`🔄 Fetching monitor data for ${monitorId} on ${date}...`);
  }
  
  try {
    // Get monitor configuration
    const monitor = await getMonitorConfig(monitorId);
    
    if (debug) {
      console.log(`📊 Monitor: ${monitor.name}`);
      console.log(`🔍 Query: ${monitor.query}`);
      console.log(`📈 Current State: ${monitor.state}`);
    }
    
    // Calculate time range for the specified date
    let startTime, endTime;
    
    if (typeof date === 'string' && date.match(/d{4}-d{2}-d{2}/)) {
      // Handle YYYY-MM-DD format
      const dateObj = new Date(date + 'T00:00:00.000Z');
      startTime = Math.floor(dateObj.getTime() / 1000);
      endTime = startTime + (24 * 60 * 60) - 1; // End of day
    } else {
      // Handle other date formats or assume it's a start time
      startTime = parseDate(date);
      endTime = startTime + (24 * 60 * 60) - 1; // Add 24 hours
    }
    
    if (debug) {
      console.log(`⏰ Time range: ${new Date(startTime * 1000).toLocaleString()} to ${new Date(endTime * 1000).toLocaleString()}`);
    }
    
    // Fetch the metric data
    const metricData = await fetchRawMetricData(
      monitor.metricQuery,
      monitor.queryInfo.aggregation,
      startTime,
      endTime,
      { rollupOverride, debug }
    );
    
    return {
      monitor,
      data: metricData.data,
      metadata: {
        ...metricData.metadata,
        monitorId: monitor.id,
        date: typeof date === 'string' ? date : new Date(startTime * 1000).toISOString().slice(0, 10)
      }
    };
    
  } catch (error) {
    throw new Error(`Failed to fetch monitor data: ${error.message}`);
  }
}

/**
 * Fetch monitor data for a specific time range with optimal rollup
 * @param {string|number} monitorId - DataDog monitor ID  
 * @param {string|Date|number} startDate - Start date/time
 * @param {string|Date|number} endDate - End date/time
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} - Complete monitor data for the time range
 */
async function fetchMonitorDataRange(monitorId, startDate, endDate, options = {}) {
  const { debug = false, rollupOverride = null } = options;
  
  const startTime = parseDate(startDate);
  const endTime = parseDate(endDate);
  
  if (debug) {
    console.log(`🔄 Fetching monitor data for ${monitorId} from ${new Date(startTime * 1000).toLocaleString()} to ${new Date(endTime * 1000).toLocaleString()}...`);
  }
  
  try {
    // Get monitor configuration
    const monitor = await getMonitorConfig(monitorId);
    
    if (debug) {
      console.log(`📊 Monitor: ${monitor.name}`);
    }
    
    // Fetch the metric data
    const metricData = await fetchRawMetricData(
      monitor.metricQuery,
      monitor.queryInfo.aggregation,
      startTime,
      endTime,
      { rollupOverride, debug }
    );
    
    return {
      monitor,
      data: metricData.data,
      metadata: {
        ...metricData.metadata,
        monitorId: monitor.id,
        requestedRange: { start: startTime, end: endTime }
      }
    };
    
  } catch (error) {
    throw new Error(`Failed to fetch monitor data range: ${error.message}`);
  }
}

/**
 * Fetch recent monitor data (last N hours/days)
 * @param {string|number} monitorId - DataDog monitor ID
 * @param {number} amount - Amount of time
 * @param {string} unit - Time unit ('hours', 'days', 'minutes')
 * @param {object} options - Optional parameters  
 * @returns {Promise<object>} - Complete monitor data
 */
async function fetchRecentMonitorData(monitorId, amount, unit = 'hours', options = {}) {
  const { debug = false } = options;
  
  const multipliers = {
    minutes: 60,
    hours: 60 * 60,
    days: 24 * 60 * 60
  };
  
  if (!multipliers[unit]) {
    throw new Error(`Invalid time unit: ${unit}. Use 'minutes', 'hours', or 'days'.`);
  }
  
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (amount * multipliers[unit]);
  
  if (debug) {
    console.log(`🔄 Fetching last ${amount} ${unit} of monitor data for ${monitorId}...`);
  }
  
  return fetchMonitorDataRange(monitorId, startTime, endTime, options);
}

module.exports = {
  fetchMonitorData,
  fetchMonitorDataRange, 
  fetchRecentMonitorData,
  getMonitorConfig,
  fetchRawMetricData,
  getOptimalRollup,
  extractMetricQuery,
  parseDate
};
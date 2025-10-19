#!/usr/bin/env node
process.loadEnvFile();

const { styleText } = require('node:util');
const { 
  calculateRollingAggregation, 
} = require('./rollup-calculator');
const { 
  getMonitorConfig,
  fetchRawMetricData,
  extractMetricQuery
} = require('./datadog-fetcher');
const { createComprehensiveCharts } = require('./cli-charts');

    
// localStringConfig – don't show decimal places
const lsc = ['en-AU', { maximumFractionDigits: 0, minimumFractionDigits: 0 }];

async function analyseMonitor(monitorId, debugMode = false, days = 3, showCharts = true) {
  try {
    if (debugMode) console.log(`📅 ${styleText('dim', 'Fetching recent data for comprehensive analysis')}\n`);
    
    // Get monitor configuration using the new data fetcher
    const monitor = await getMonitorConfig(monitorId);
    console.log(`🐶 ${styleText('cyan', 'Monitor Analysis:')} ${styleText('bold', String(monitorId))}`);
    
    console.log(`   ${styleText('blue', 'Name:')} ${styleText('white', monitor.name)}`);
    console.log(`   ${styleText('blue', 'ID:')} ${styleText('white', String(monitor.id))}`);
    console.log(`   ${styleText('blue', 'Query:')} ${styleText('gray', monitor.query)}`);
    
    // Color state based on its value
    const stateColor = monitor.state === 'OK' ? 'green' : monitor.state === 'Alert' ? 'red' : 'yellow';
    console.log(`   ${styleText('blue', 'Current State:')} ${styleText(stateColor, monitor.state)}`);
    
    // Show extracted rollup information
    const rollupInfo = extractRollupAndInterval(monitor.query);
    console.log(`   ${styleText('blue', 'Rollup:')} ${styleText('magenta', rollupInfo.aggFunction)} over ${styleText('cyan', rollupInfo.timeWindow)} (${styleText('dim', rollupInfo.timeWindowSeconds + 's intervals')})`);
    
    // Extract thresholds from monitor options or query
    const configThresholds = monitor.thresholds;
    const queryThreshold = extractThresholdFromQuery(monitor.query);
    
    // Combine config and query thresholds
    const thresholds = {
      critical: configThresholds.critical || queryThreshold?.value,
      warning: configThresholds.warning,
      criticalRecovery: configThresholds.criticalRecovery
    };
    
      // Get thresholds and direction for breach analysis
    const isHighBad = determineMetricDirection(monitor.query);

    console.log(`\n📈 ${styleText('bold', 'CURRENT THRESHOLDS:')}`);
    
    const criticalValue = thresholds.critical ? thresholds.critical.toLocaleString(...lsc) : styleText('dim', 'Not set');
    const criticalExtra = queryThreshold && !configThresholds.critical ? styleText('dim', ' (from query)') : '';
    console.log(`   ${styleText('red', 'Critical:')} ${styleText('white', criticalValue)}${criticalExtra}`);

    const warningValue = thresholds.warning ? thresholds.warning.toLocaleString(...lsc) : styleText('dim', 'Not set');
    console.log(`   ${styleText('yellow', 'Warning:')} ${styleText('white', warningValue)}`);

    const recoveryValue = thresholds.criticalRecovery ? thresholds.criticalRecovery.toLocaleString(...lsc) : styleText('dim', 'Not set');
    console.log(`   ${styleText('green', 'Critical Recovery:')} ${styleText('white', recoveryValue)}`);


    console.log(`   ${styleText('blue', 'Direction:')} ${styleText('white', isHighBad ? 'High values are bad' : 'Low values are bad')}`);
    
    // Fetch data using day-by-day 5-minute resolution data
    const batchAnalyses = await fetchHighResolutionData(monitorId, monitor, debugMode, days);
    
    if (batchAnalyses.length === 0) {
      console.log(`\n❌ ${styleText('red', 'No historical data available for analysis')}`);
      return;
    }

    // Combine all data for overall statistics using merged thresholds
    const combinedData = combineHighResData(batchAnalyses, thresholds, isHighBad, debugMode);
    
    // Show breach details if any exist
    if (combinedData.breaches.length > 0) {
      console.log(`\n🔍 BREACH DETAILS:`);
      // Sort breaches by start time (chronological order)
      const sortedBreaches = [...combinedData.breaches].sort((a, b) => a.startTime - b.startTime);
      
      // De-duplicate: skip warnings that are followed by criticals with same peak
      const dedupedBreaches = [];
      for (let i = 0; i < sortedBreaches.length; i++) {
        const current = sortedBreaches[i];
        const next = sortedBreaches[i + 1];
        
        // Skip warning if next breach is critical with same peak value
        if (current.level === 'Warning' && next && next.level === 'Critical' && 
            Math.round(current.peakValue) === Math.round(next.peakValue)) {
          continue;
        }
        dedupedBreaches.push(current);
      }
      
      dedupedBreaches.forEach(breach => {
        const start = new Date(breach.startTime).toLocaleString();
        const end = new Date(breach.endTime).toLocaleString();
        const duration = Math.round(breach.duration);
        const peakValue = Math.round(breach.peakValue).toLocaleString();
        
        // Color the breach level
        const levelColor = breach.level === 'Critical' ? 'red' : 'yellow';
        const coloredLevel = styleText(levelColor, breach.level);
        
        console.log(`   ${coloredLevel}: ${start} → ${end} (${duration} minutes, peak: ${peakValue})`);
      });
    }
    

    
    // Overall statistics  
    const timeRangeDesc = batchAnalyses[0]?.timeRangeDesc || 'recent period';
    const rollupMinutes = batchAnalyses[0]?.rollupSeconds ? batchAnalyses[0].rollupSeconds / 60 : 'unknown';
    console.log(`\n📊 ${styleText('bold', 'MONITOR STATISTICS:')}`);
    if (combinedData.rawDataPoints) {
      console.log(`   ${styleText('blue', 'Raw data points:')} ${styleText('cyan', combinedData.rawDataPoints.toLocaleString(...lsc))} ${styleText('dim', `(${rollupMinutes}-minute intervals)`)}`);
    }
    console.log(`   ${styleText('blue', 'Range:')} ${styleText('cyan', combinedData.stats.min.toLocaleString(...lsc))} ${styleText('dim', '-')} ${styleText('cyan', combinedData.stats.max.toLocaleString(...lsc))}`);
    console.log(`   ${styleText('blue', 'Mean:')} ${styleText('cyan', combinedData.stats.mean.toLocaleString(...lsc))}`);
    console.log(`   ${styleText('blue', 'Median:')} ${styleText('cyan', combinedData.stats.median.toLocaleString(...lsc))}`);
    console.log(`   ${styleText('blue', 'P95:')} ${styleText('cyan', combinedData.stats.p95.toLocaleString(...lsc))}`);
    console.log(`   ${styleText('blue', 'P99:')} ${styleText('cyan', combinedData.stats.p99.toLocaleString(...lsc))}`);
    console.log(`   ${styleText('blue', 'Standard Deviation:')} ${styleText('cyan', combinedData.stats.std.toLocaleString(...lsc))}`);
    
    // Threshold breach analysis
    console.log(`\n🚨 ${styleText('bold', 'THRESHOLD BREACHES:')}`);
    console.log(`   ${styleText('blue', 'Total Breaches:')} ${styleText('white', String(combinedData.breachStats.totalBreaches))}`);
    console.log(`   ${styleText('blue', 'Critical Breaches:')} ${styleText('white', String(combinedData.breachStats.criticalBreaches))}`);
    console.log(`   ${styleText('blue', 'Warning Breaches:')} ${styleText('white', String(combinedData.breachStats.warningBreaches))}`);
    console.log(`   ${styleText('blue', 'Average Duration:')} ${styleText('white', String(combinedData.breachStats.avgDuration))} ${styleText('dim', 'minutes')}`);
    console.log(`   ${styleText('blue', 'Longest Breach:')} ${styleText('white', String(combinedData.breachStats.longestBreach))} ${styleText('dim', 'minutes')}`);
    console.log(`   ${styleText('blue', 'Quick Recovery (<15min):')} ${styleText('white', String(combinedData.breachStats.shortBreaches))}`);
    console.log(`   ${styleText('blue', 'Sustained Issues (>30min):')} ${styleText('white', String(combinedData.breachStats.sustainedBreaches))}`);
    console.log(`   ${styleText('blue', 'Max Deviation:')} ${styleText('white', combinedData.breachStats.maxDeviation?.toLocaleString() || 'N/A')}`);
    
    const volatilityColor = combinedData.volatilityScore > 7 ? 'red' : combinedData.volatilityScore > 4 ? 'yellow' : 'green';
    console.log(`   ${styleText('blue', 'Volatility Score:')} ${styleText(volatilityColor, String(combinedData.volatilityScore))}/10 ${styleText('dim', '(higher = more volatile)')}`);
    
    // Generate recommendations based on breach analysis
    const recommendations = generateRecommendations(monitor, combinedData, isHighBad);
    
    console.log(`\n🎯 ${styleText('bold', 'THRESHOLD RECOMMENDATIONS:')}`);
    
    console.log(`   ${styleText('blue', 'Strategy:')} ${styleText('magenta', recommendations.strategy)}`);
    console.log(`   ${styleText('green', 'Warning:')} ${styleText('white', recommendations.warning_operator)} ${styleText('cyan', recommendations.warning.toLocaleString(...lsc))} ${styleText('dim', `(${recommendations.warning_reasoning})`)}`);
    console.log(`   ${styleText('green', 'Critical:')} ${styleText('white', recommendations.critical_operator)} ${styleText('cyan', recommendations.critical.toLocaleString(...lsc))} ${styleText('dim', `(${recommendations.critical_reasoning})`)}`);
    console.log(`   ${styleText('green', 'Recovery:')} ${styleText('white', recommendations.recovery_operator)} ${styleText('cyan', recommendations.recovery.toLocaleString(...lsc))} ${styleText('dim', `(${recommendations.recovery_reasoning})`)}`);
    
    // Evaluation window recommendations
    console.log(`\n🕥 ${styleText('bold', 'EVALUATION WINDOW RECOMMENDATIONS:')}`);
    console.log(`   ${styleText('blue', 'Current Window:')} ${styleText('white', extractTimeWindow(monitor.query))}`);
    console.log(`   ${styleText('green', 'Recommended Window:')} ${styleText('cyan', recommendations.recommended_window)} ${styleText('dim', `(${recommendations.window_reasoning})`)}`);
    console.log(`   ${styleText('green', 'Recommended Delay:')} ${styleText('cyan', String(recommendations.recommended_delay))} ${styleText('dim', `seconds (${recommendations.delay_reasoning})`)}`);
    
    // Summary insights
    console.log(`\n💡 ${styleText('bold', 'KEY INSIGHTS:')}`);
    recommendations.insights.forEach(insight => {
      console.log(`   ${styleText('green', '•')} ${styleText('white', insight)}`);
    });

    // Visual charts (time series + histogram)
    if (showCharts) {
      try {
        createComprehensiveCharts(
          combinedData.timeSeriesData,
          {
            critical: thresholds.critical,
            warning: thresholds.warning
          },
          {
            title: 'Metric Visuals',
            histogramOptions: { width: 60, bins: 20, showThresholds: true }
          }
        );
      } catch (chartErr) {
        console.log(`${styleText('yellow', '⚠️  Chart rendering skipped:')} ${styleText('white', chartErr.message)}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ ${styleText('red', 'Error analysing monitor:')} ${styleText('white', error.message)}`);
    if (error.message.includes('404')) {
      console.log(`💡 ${styleText('yellow', 'Monitor ID')} ${styleText('cyan', String(monitorId))} ${styleText('yellow', 'not found. Check the ID is correct.')}`);
    }
  }
}

async function fetchHighResolutionData(monitorId, monitor, debugMode = false, days = 3) {
  try {
    if (debugMode) console.log(`📅 Fetching ${days} days of data at 5-minute increments...`);
    
    const metricQuery = extractMetricQuery(monitor.query);
    const rollupInfo = extractRollupAndInterval(monitor.query);
    const aggregation = rollupInfo.aggFunction;
    
    if (debugMode) {
      console.log(`   Metric query: ${metricQuery}`);
      console.log(`   Aggregation: ${aggregation}`);
      console.log(`   Rolling window: ${rollupInfo.timeWindow}`);
    }
    
    const allData = [];
    const now = new Date();
    
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      // Calculate start and end times for this day (dayOffset 0 = today, 1 = yesterday, etc.)
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - dayOffset);
      dayStart.setHours(0, 0, 0, 0);
      
      const dayEnd = new Date(dayStart);
      // For today (dayOffset 0), end at current time instead of end of day
      if (dayOffset === 0) {
        dayEnd.setTime(now.getTime()); // Use current time for today
      } else {
        dayEnd.setHours(23, 59, 59, 999); // Use end of day for past days
      }
      
      const startTimestamp = Math.floor(dayStart.getTime() / 1000);
      const endTimestamp = Math.floor(dayEnd.getTime() / 1000);
      
      if (debugMode) {
        const dayLabel = dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Yesterday' : `${dayOffset} days ago`;
        const endTime = dayOffset === 0 ? 'now' : dayEnd.toISOString().split('T')[1].split('.')[0];
        console.log(`   ${dayLabel}: ${dayStart.toISOString().split('T')[0]} (${startTimestamp} to ${endTimestamp})`);
      }
      
      try {
        // Calculate expected points based on actual time span
        const timeSpanHours = (endTimestamp - startTimestamp) / 3600;
        const expectedPoints = Math.ceil(timeSpanHours * 12); // 12 points per hour at 5-minute intervals
        
        const dayData = await fetchRawMetricData(
          metricQuery,
          aggregation,
          startTimestamp,
          endTimestamp,
          { 
            rollupOverride: { seconds: 300, description: '5-minute', expectedPoints }, 
            debug: debugMode 
          }
        );
        
        if (dayData.data && dayData.data.length > 0) {
          allData.push(...dayData.data);
          
          if (debugMode) {
            console.log(`     Fetched: ${dayData.data.length} points (${dayData.metadata.coverage?.toFixed(1) || 'unknown'}% coverage)`);
          }
        } else if (debugMode) {
          console.log(`     No data for this day`);
        }
        
        // Rate limiting between day requests
        if (dayOffset < days - 1) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        
      } catch (dayError) {
        console.log(`   ⚠️  Error fetching day ${dayOffset + 1}: ${dayError.message}`);
      }
    }
    
    if (allData.length === 0) {
      console.log('❌ No data returned from any day');
      return [];
    }
    
    // Sort all data by timestamp
    allData.sort((a, b) => a.timestamp - b.timestamp);
    
    
    if (debugMode) {
        console.log(`📈 Combined ${allData.length} data points from ${days} days (5-minute resolution)`);
        const dataSpanMs = allData[allData.length - 1].timestamp - allData[0].timestamp;
        const actualDays = dataSpanMs / (24 * 60 * 60 * 1000);
        const avgPointsPerDay = allData.length / actualDays;
        console.log(`   Data span: ${actualDays.toFixed(1)} days`);
        console.log(`   Average points per day: ${avgPointsPerDay.toFixed(1)}`);
        console.log(`   Time range: ${new Date(allData[0].timestamp).toLocaleString()} to ${new Date(allData[allData.length - 1].timestamp).toLocaleString()}`);
      }
    
    return [{
      timeSeriesData: allData,
      dataPoints: allData.length,
      queryInfo: {
        aggregation: aggregation,
        timeWindow: rollupInfo.timeWindow,
        timeWindowMs: rollupInfo.timeWindowSeconds * 1000
      },
      timeRangeDesc: `${days} days`,
      rollupSeconds: 300 // 5 minutes
    }];
    
  } catch (error) {
    console.error(`❌ Error fetching high-resolution data: ${error.message}`);
    return [];
  }
}



function combineHighResData(batchAnalyses, thresholds, isHighBad, debugMode = false) {
  if (batchAnalyses.length === 0) {
    return {
      stats: {},
      totalPoints: 0,
      breaches: [],
      breachStats: {},
      volatilityScore: 0,
      timeSeriesData: [],
      allDataPoints: []
    };
  }
  
  // Get the raw high-resolution data (5-minute intervals)
  const rawData = batchAnalyses[0];
  const allTimeSeriesData = rawData.timeSeriesData;
  const queryInfo = rawData.queryInfo;
  
  const rollupMinutes = rawData.rollupSeconds / 60;
  if (debugMode) {
      console.log(`\n📈 Processing ${allTimeSeriesData.length} data points (${rawData.timeRangeDesc}, ${rollupMinutes}-min rollup)`);
      console.log(`🔄 Computing rolling ${queryInfo.timeWindow} ${queryInfo.aggregation} values...`);
  }
  
  // For sparse data, use a more flexible approach
  const dataSpanMs = allTimeSeriesData[allTimeSeriesData.length - 1].timestamp - allTimeSeriesData[0].timestamp;
  const dataSpanHours = dataSpanMs / (1000 * 60 * 60);
  const avgPointsPerHour = allTimeSeriesData.length / dataSpanHours;
  
  // Use step size based on the rollup interval, but ensure it's reasonable for rolling windows
  let stepSizeMs = Math.max(rawData.rollupSeconds * 1000, 5 * 60 * 1000); // At least 5 minutes
  let discardIncomplete = true;
  
  if (avgPointsPerHour < 1.5) { // Less than 1.5 points per hour (very sparse)
    console.log(`🔍 Sparse data detected (${avgPointsPerHour.toFixed(1)} points/hour), using flexible windowing...`);
    stepSizeMs = Math.max(rawData.rollupSeconds * 1000, dataSpanMs / 50); // Adaptive step size
    discardIncomplete = false; // Allow partial windows
  }
  
  // Calculate rolling window aggregations matching the monitor's evaluation logic
  const rollingWindowData = calculateRollingAggregation(
    allTimeSeriesData,
    queryInfo.timeWindowMs,
    stepSizeMs,
    queryInfo.aggregation,
    discardIncomplete
  );
  
  if (debugMode) console.log(`📉 Generated ${rollingWindowData.length} rolling window values (${Math.round(rollingWindowData.length / 28)} per day avg)`);
  
  if (rollingWindowData.length === 0) {
    console.log('❌ No rolling window data generated');
    return {
      stats: {},
      totalPoints: 0,
      breaches: [],
      breachStats: {},
      volatilityScore: 0,
      timeSeriesData: [],
      allDataPoints: []
    };
  }
  
  // Extract values for statistics
  const allValues = rollingWindowData.map(point => point.value);
  const stats = calculateStatistics(allValues);
  
  // Convert rolling window data to time series format for breach analysis
  const rollingTimeSeriesData = rollingWindowData.map(point => ({
    timestamp: point.timestamp,
    value: point.value
  }));
  
  // Analyze threshold breaches on rolling window data
  const breachAnalysis = analyzeThresholdBreaches(rollingTimeSeriesData, thresholds, isHighBad);
  
  // Calculate volatility score based on coefficient of variation
  const coefficientOfVariation = stats.std / stats.mean;
  const volatilityScore = Math.min(10, Math.round(coefficientOfVariation * 10));
  
  return {
    stats,
    totalPoints: rollingWindowData.length,
    breaches: breachAnalysis.breaches,
    breachStats: breachAnalysis.stats,
    volatilityScore,
    timeSeriesData: rollingTimeSeriesData,
    allDataPoints: rollingTimeSeriesData,  // For near-breach analysis
    rawDataPoints: allTimeSeriesData.length  // Track original data count
  };
}

function analyzeThresholdBreaches(timeSeriesData, thresholds, isHighBad, quietMode = false) {
  if (timeSeriesData.length === 0) return { breaches: [], stats: {} };
  
  // Sort by timestamp to ensure chronological order
  const sortedData = [...timeSeriesData].sort((a, b) => a.timestamp - b.timestamp);
  
  const breaches = [];
  let currentBreach = null;
  
  // Determine which thresholds to check based on direction
  const thresholdsToCheck = [];
  if (thresholds.critical !== undefined) {
    thresholdsToCheck.push({ value: thresholds.critical, level: 'Critical', operator: isHighBad ? '>=' : '<=' });
  }
  if (thresholds.warning !== undefined) {
    thresholdsToCheck.push({ value: thresholds.warning, level: 'Warning', operator: isHighBad ? '>=' : '<=' });
  }
  
  // Check each threshold level
  for (const threshold of thresholdsToCheck) {
    currentBreach = null;
    
    for (let i = 0; i < sortedData.length; i++) {
      const point = sortedData[i];
      let breached = false;
      
      if (isHighBad) {
        breached = point.value >= threshold.value;
      } else {
        breached = point.value <= threshold.value;
      }
      
      if (breached) {
        if (!currentBreach) {
          currentBreach = {
            level: threshold.level,
            threshold: threshold.value,
            operator: threshold.operator,
            startTime: point.timestamp,
            startValue: point.value,
            peakValue: point.value,
            peakTime: point.timestamp,
            endTime: null,
            endValue: null,
            duration: 0,
            maxDeviation: Math.abs(point.value - threshold.value),
            isOngoing: false
          };
        } else {
          // Update peak/worst value during breach
          if (isHighBad) {
            if (point.value > currentBreach.peakValue) {
              currentBreach.peakValue = point.value;
              currentBreach.peakTime = point.timestamp;
            }
          } else {
            if (point.value < currentBreach.peakValue) {
              currentBreach.peakValue = point.value;
              currentBreach.peakTime = point.timestamp;
            }
          }
          currentBreach.maxDeviation = Math.max(currentBreach.maxDeviation, Math.abs(point.value - threshold.value));
        }
      } else {
        if (currentBreach) {
          // End of breach
          currentBreach.endTime = point.timestamp;
          currentBreach.endValue = point.value;
          currentBreach.duration = (currentBreach.endTime - currentBreach.startTime) / (1000 * 60);
          
          // Only include breaches that last more than 1 minute
          if (currentBreach.duration >= 1) {
            breaches.push(currentBreach);
          }
          currentBreach = null;
        }
      }
    }
    
    // Handle ongoing breach at end of data
    if (currentBreach) {
      const lastPoint = sortedData[sortedData.length - 1];
      currentBreach.endTime = lastPoint.timestamp;
      currentBreach.endValue = lastPoint.value;
      currentBreach.duration = (currentBreach.endTime - currentBreach.startTime) / (1000 * 60);
      currentBreach.isOngoing = true;
      
      if (currentBreach.duration >= 1) {
        breaches.push(currentBreach);
      }
    }
  }
  
  // Calculate breach statistics
  const criticalBreaches = breaches.filter(b => b.level === 'Critical');
  const warningBreaches = breaches.filter(b => b.level === 'Warning');
  
  const stats = {
    totalBreaches: breaches.length,
    criticalBreaches: criticalBreaches.length,
    warningBreaches: warningBreaches.length,
    avgDuration: breaches.length > 0 ? Math.round(breaches.reduce((sum, b) => sum + b.duration, 0) / breaches.length) : 0,
    longestBreach: breaches.length > 0 ? Math.round(Math.max(...breaches.map(b => b.duration))) : 0,
    shortBreaches: breaches.filter(b => b.duration < 15).length, // Quick recovery < 15 min
    sustainedBreaches: breaches.filter(b => b.duration > 30).length, // Sustained > 30 min
    maxDeviation: breaches.length > 0 ? Math.round(Math.max(...breaches.map(b => b.maxDeviation))) : 0
  };
  
  if (quietMode) {
    console.log(`   📈 Threshold Analysis: ${stats.totalBreaches} breaches (${stats.criticalBreaches} critical, ${stats.warningBreaches} warning)`);
    console.log(`   📈 Duration: Avg=${stats.avgDuration}min, Longest=${stats.longestBreach}min, Quick(<15min)=${stats.shortBreaches}, Sustained(>30min)=${stats.sustainedBreaches}`);
  }
  
  return { breaches, stats };
}

function calculateStatistics(values) {
  if (values.length === 0) return {};
  
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: Math.round(mean),
    median: sorted[Math.floor(n / 2)],
    p05: sorted[Math.floor(n * 0.05)],
    p10: sorted[Math.floor(n * 0.1)],
    p50: sorted[Math.floor(n * 0.5)],
    p90: sorted[Math.floor(n * 0.9)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    std: Math.round(Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / (n - 1)))
  };
}


function generateRecommendations(monitor, combinedData, isHighBad) {
  const stats = combinedData.stats;
  const breachStats = combinedData.breachStats;
  
  let strategy, critical, warning, recovery, window, delay;
  let insights = [];
  
  // Determine strategy based on volatility and breach patterns
  if (combinedData.volatilityScore > 7 || breachStats.sustainedBreaches > 3) {
    strategy = 'Conservative (High volatility or sustained breaches)';
  } else if (combinedData.volatilityScore > 4 || breachStats.totalBreaches > 5) {
    strategy = 'Balanced (Moderate volatility or some breaches)';
  } else {
    strategy = 'Standard (Low volatility, minimal breaches)';
  }
  
  if (isHighBad) {
    // High is bad thresholds
    if (strategy.includes('Conservative')) {
      critical = Math.max(stats.p95, stats.max * 0.7);
      warning = Math.round(critical * 0.65);
      recovery = Math.round(critical * 0.85);
    } else if (strategy.includes('Balanced')) {
      critical = Math.max(stats.p99, stats.max * 0.8);
      warning = Math.round(critical * 0.75);
      recovery = Math.round(critical * 0.9);
    } else {
      critical = stats.p99;
      warning = Math.round(critical * 0.8);
      recovery = Math.round(critical * 0.95);
    }
    
    // Window recommendations based on breach duration patterns
    if (breachStats.avgDuration > 60) {
      window = 'avg(last_15m)';
      delay = 900; // 15 minutes
      insights.push('Long average breach duration suggests 15-minute window appropriate');
    } else if (breachStats.avgDuration > 30 || breachStats.sustainedBreaches > 0) {
      window = 'avg(last_10m)';
      delay = 600; // 10 minutes  
      insights.push('Moderate breach duration suggests 10-minute window');
    } else {
      window = 'avg(last_5m)';
      delay = 300; // 5 minutes
      insights.push('Short breach duration allows for shorter 5-minute window');
    }
    
  } else {
    // Low is bad thresholds
    if (strategy.includes('Conservative')) {
      critical = Math.min(Math.round(stats.mean * 0.3), Math.round(stats.min * 1.5));
      warning = Math.round(stats.mean * 0.6);
    } else if (strategy.includes('Balanced')) {
      critical = Math.min(Math.round(stats.mean * 0.4), Math.round(stats.min * 1.3));
      warning = Math.round(stats.mean * 0.7);
    } else {
      critical = Math.round(stats.mean * 0.5);
      warning = Math.round(stats.mean * 0.75);
    }
    
    recovery = Math.round(critical * 1.1);
    window = 'avg(last_15m)';
    delay = 600;
    insights.push('Job processing metrics benefit from 15-minute windows to detect trends');
  }
  
  // Additional insights based on breach data
  if (combinedData.volatilityScore > 6) {
    insights.push(`High volatility (${combinedData.volatilityScore}/10) suggests conservative thresholds`);
  }
  
  if (breachStats.totalBreaches === 0) {
    insights.push('No threshold breaches detected - current thresholds may be appropriate');
  } else {
    if (breachStats.shortBreaches > breachStats.sustainedBreaches * 2) {
      insights.push('Most breaches resolve quickly (<15min) - consider duration-based alerting');
    }
    
    if (breachStats.sustainedBreaches > 0) {
      insights.push(`${breachStats.sustainedBreaches} sustained breaches detected - monitor for recurring issues`);
    }
    
    if (breachStats.maxDeviation > 0) {
      insights.push(`Maximum deviation: ${breachStats.maxDeviation.toLocaleString()} - shows severity of worst breaches`);
    }
  }
  
  const currentThreshold = monitor.options?.thresholds?.critical;
  if (currentThreshold) {
    const currentVsRecommended = Math.abs(currentThreshold - critical) / critical;
    if (currentVsRecommended > 0.5) {
      insights.push(`Current threshold (${currentThreshold.toLocaleString()}) differs significantly from recommendation`);
    }
    
    // Check if current thresholds are causing noise
    if (breachStats.shortBreaches > 5) {
      insights.push('Many short breaches detected - consider raising thresholds to reduce noise');
    }
  }
  
  return {
    strategy,
    critical: Math.round(critical),
    critical_operator: isHighBad ? '>' : '<',
    critical_reasoning: `${strategy} based on P95/P99 analysis`,
    warning: Math.round(warning),
    warning_operator: isHighBad ? '>' : '<',
    warning_reasoning: isHighBad ? '65-80% of critical for early warning' : '60-75% buffer above critical',
    recovery: Math.round(recovery),
    recovery_operator: isHighBad ? '>' : '<', 
    recovery_reasoning: 'Hysteresis to prevent alert flapping',
    recommended_window: window,
    window_reasoning: `Based on ${breachStats.avgDuration}min average breach duration`,
    recommended_delay: delay,
    delay_reasoning: 'Prevents false alarms during brief fluctuations',
    insights
  };
}

function determineMetricDirection(query) {
  if (query.includes(' > ') || query.includes(' >= ')) return true;
  if (query.includes(' < ') || query.includes(' <= ')) return false;
  
  const queryLower = query.toLowerCase();
  const highIsBadKeywords = ['error', 'failed', 'depth', 'queue', 'usage', 'memory', 'cpu', 'dlq'];
  const lowIsBadKeywords = ['count', 'process', 'success', 'healthy', 'available'];
  
  for (const keyword of highIsBadKeywords) {
    if (queryLower.includes(keyword)) return true;
  }
  
  for (const keyword of lowIsBadKeywords) {
    if (queryLower.includes(keyword)) return false;
  }
  
  return true;
}


function extractTimeWindow(query) {
  // Look for patterns like last_1h, last_5m, last_30m, etc.
  let match = query.match(/last_(\d+[smhd])/);
  if (match) return match[1];
  
  // Look for patterns like (last_1h)
  match = query.match(/\(last_(\d+[smhd])\)/);
  if (match) return match[1];
  
  // Look for sum(last_1h): pattern
  match = query.match(/sum\(last_(\d+[smhd])\)/);
  if (match) return match[1];
  
  return 'unknown';
}

function extractThresholdFromQuery(query) {
    if (!query) return null;
    
    // Look for comparison operators with numbers in the query
    // Pattern matches: > 15000, >= 15000, < 15000, <= 15000
    const thresholdMatch = query.match(/>\s*=?\s*(\d+(?:\.\d+)?)/);
    if (thresholdMatch) {
        return {
            value: parseFloat(thresholdMatch[1]),
            operator: thresholdMatch[0].trim().replace(/\s*(\d.*)/g, '').trim()
        };
    }
    
    return null;
}

function extractRollupAndInterval(query) {
  // Extract the time window (e.g., '1h' from 'last_1h')
  const timeWindow = extractTimeWindow(query);
  
  // Convert time window to seconds for rollup
  const timeWindowSeconds = convertTimeToSeconds(timeWindow);
  
  // Extract aggregation function (sum, avg, etc.)
  let aggFunction = 'sum'; // default
  const aggMatch = query.match(/^(\w+)\(/);
  if (aggMatch) {
    aggFunction = aggMatch[1];
  }
  
  return {
    timeWindow,
    timeWindowSeconds,
    aggFunction,
    rollupString: `.rollup(${aggFunction}, ${timeWindowSeconds})`
  };
}

function convertTimeToSeconds(timeStr) {
  if (!timeStr || timeStr === 'unknown') return 3600; // default to 1 hour
  
  const match = timeStr.match(/(\d+)([smhd])/);
  if (!match) return 3600;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 60 * 60;
    case 'd': return value * 24 * 60 * 60;
    default: return 3600;
  }
}

// CLI handling
const monitorId = process.argv[2];
const isDebugMode = process.argv.includes('--debug') || process.env.DEBUG === 'true';
const showCharts = process.argv.includes('--charts');

// Parse days parameter
let days = 3; // Default
const daysArg = process.argv.find(arg => arg.startsWith('--days='));
if (daysArg) {
  const parsedDays = parseInt(daysArg.split('=')[1]);
  if (parsedDays > 0 && parsedDays <= 28) {
    days = parsedDays;
  } else {
    console.log(`❌ ${styleText('red', 'Days must be between 1 and 28')}`);
    process.exit(1);
  }
}

if (!monitorId) {
  console.log(`\n`);
  console.log(styleText('cyan', '🔍 COMPREHENSIVE MONITOR ANALYSER'));
  console.log();
  console.log(`${styleText('blue', 'Usage:')} ${styleText('white', 'node analyse-monitor.js')} ${styleText('yellow', '<monitor_id>')} ${styleText('dim', '[--debug] [--days=N]')}`);
  console.log();
  console.log(styleText('green', 'Features:'));
  console.log(`${styleText('cyan', '📊')} Day-by-day high-resolution analysis (5-minute intervals)`);
  console.log(`${styleText('cyan', '🔄')} Client-side rolling window calculations matching monitor logic`);
  console.log(`${styleText('cyan', '🎯')} Precise threshold breach detection with exact timing`);
  console.log(`${styleText('cyan', '📉')} Smart threshold recommendations based on statistical analysis`);
  console.log(`${styleText('cyan', '⏱️')}  Evaluation window suggestions based on breach patterns`);
  console.log(`${styleText('cyan', '💡')} Near-breach analysis and actionable insights`);
  console.log();
  console.log(styleText('magenta', 'Options:'));
  console.log(`  ${styleText('yellow', '--debug')}      ${styleText('white', 'Enable detailed debug output')}`);
  console.log(`  ${styleText('yellow', '--days=N')}     ${styleText('white', 'Number of days to fetch (default: 3, recommended: 2-7)')}`);
  console.log(`  ${styleText('yellow', '--charts')}    ${styleText('white', 'Enable visual distribution histogram')}`);
  console.log();
  console.log(styleText('green', 'Examples:'));
  console.log(`  ${styleText('dim', 'node analyse-monitor.js')} ${styleText('yellow', '9564272')}              ${styleText('dim', '# Analyze with 3 days of data')}`);
  console.log(`  ${styleText('dim', 'node analyse-monitor.js')} ${styleText('yellow', '177932009')} ${styleText('blue', '--days=2')}   ${styleText('dim', '# Analyze with 2 days of data')}`);
  console.log(`  ${styleText('dim', 'node analyse-monitor.js')} ${styleText('yellow', '9564272')} ${styleText('blue', '--charts')}    ${styleText('dim', '# Analyze with distribution chart')}`);
  console.log(`  ${styleText('dim', 'node analyse-monitor.js')} ${styleText('yellow', '9564272')} ${styleText('blue', '--debug')}      ${styleText('dim', '# Analyze with debug output')}`);
  console.log();
  process.exit(0);
}
    const asciiLines = [
      '░██       ░██               ░██               ░██        ░███████                         ',
      '░██       ░██               ░██               ░██        ░██   ░██                        ',
      '░██  ░██  ░██  ░██████   ░████████  ░███████  ░████████  ░██    ░██  ░███████   ░████████ ',
      '░██ ░████ ░██       ░██     ░██    ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██ ',
      '░██░██ ░██░██  ░███████     ░██    ░██        ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██ ',
      '░████   ░████ ░██   ░██     ░██    ░██    ░██ ░██    ░██ ░██   ░██  ░██    ░██ ░██   ░███ ',
      '░███     ░███  ░█████░██     ░████  ░███████  ░██    ░██ ░███████    ░███████   ░█████░██ ',
      '                                                                                      ░██ ',
      '                                                                                ░███████'
    ];
    
    const colors = ['blue', 'cyan', 'blue', 'cyan', 'blue', 'cyan'];
    console.log();
    asciiLines.forEach((line, i) => {
      const color = colors[i % colors.length];
      setTimeout(() => {
        console.log(styleText(color, line));
      }, i * 100);
    });

// Run the analysis
setTimeout(() => {
  console.log();
  analyseMonitor(monitorId, isDebugMode, days, showCharts);
}, asciiLines.length * 100 + 100);

module.exports = { analyseMonitor };
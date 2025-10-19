/**
 * CLI Charts Module
 * 
 * Provides ASCII histogram for terminal visualization of monitor data distribution.
 */

const { styleText } = require('node:util');

/**
 * Create a histogram showing the distribution of values
 * @param {Array} values - Array of numeric values
 * @param {Object} thresholds - Object with critical/warning thresholds  
 * @param {Object} options - Chart configuration options
 */
function createHistogram(values, thresholds = {}, options = {}) {
  const {
    width = 60,
    bins = 20,
    title = 'Value Distribution',
    showThresholds = true
  } = options;

  if (!values || values.length === 0) {
    return styleText('red', '❌ No data available for histogram');
  }

  console.log(`\n📊 ${styleText('bold', title)}`);

  const sortedValues = [...values].sort((a, b) => a - b);
  const minValue = sortedValues[0];
  const maxValue = sortedValues[sortedValues.length - 1];
  const valueRange = maxValue - minValue;

  if (valueRange === 0) {
    console.log(styleText('yellow', '⚠️  All values are identical, showing single value'));
    console.log(`${styleText('cyan', 'Value:')} ${minValue.toLocaleString()} ${styleText('dim', `(${values.length} occurrences)`)}`);
    return;
  }

  // Create bins
  const binSize = valueRange / bins;
  const binCounts = new Array(bins).fill(0);
  const binRanges = [];

  // Calculate bin ranges and populate counts
  for (let i = 0; i < bins; i++) {
    const binStart = minValue + (i * binSize);
    const binEnd = minValue + ((i + 1) * binSize);
    binRanges.push({ start: binStart, end: binEnd, label: `${binStart.toLocaleString('en-AU', {maximumFractionDigits: 0})}-${binEnd.toLocaleString('en-AU', {maximumFractionDigits: 0})}` });
  }

  // Count values in each bin
  values.forEach(value => {
    let binIndex = Math.floor((value - minValue) / binSize);
    // Handle edge case where value equals maxValue
    if (binIndex >= bins) binIndex = bins - 1;
    binCounts[binIndex]++;
  });

  const maxCount = Math.max(...binCounts);
  if (maxCount === 0) return;

  // Calculate which bins contain thresholds
  const thresholdBins = new Set();
  if (showThresholds) {
    if (thresholds.critical && thresholds.critical >= minValue && thresholds.critical <= maxValue) {
      const criticalBin = Math.min(Math.floor((thresholds.critical - minValue) / binSize), bins - 1);
      thresholdBins.add(criticalBin);
    }
    if (thresholds.warning && thresholds.warning >= minValue && thresholds.warning <= maxValue) {
      const warningBin = Math.min(Math.floor((thresholds.warning - minValue) / binSize), bins - 1);
      thresholdBins.add(warningBin);
    }
  }

  // Find max label width for alignment
  const maxLabelWidth = Math.max(...binRanges.map(range => range.label.length));

  // Draw histogram
  for (let i = 0; i < bins; i++) {
    const count = binCounts[i];
    const barLength = Math.round((count / maxCount) * width);
    const label = binRanges[i].label.padEnd(maxLabelWidth);
    
    // Choose bar character and color based on threshold
    let barChar = '█';
    let barColor = 'cyan';
    
    if (thresholdBins.has(i)) {
      if (thresholds.critical && Math.abs(binRanges[i].start - thresholds.critical) < binSize) {
        barColor = 'red';
      } else if (thresholds.warning && Math.abs(binRanges[i].start - thresholds.warning) < binSize) {
        barColor = 'yellow';
      }
    }

    const bar = barChar.repeat(barLength);
    const coloredBar = barLength > 0 ? styleText(barColor, bar) : '';
    const countLabel = count > 0 ? styleText('white', ` ${count}`) : '';
    
    console.log(`${styleText('dim', label)} │${coloredBar}${countLabel}`);
  }

  // Print statistics
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sortedValues[Math.floor(sortedValues.length / 2)];
  const p95 = sortedValues[Math.floor(sortedValues.length * 0.95)];
  
  console.log(`\n${styleText('dim', 'Statistics:')}`);
  console.log(`  ${styleText('blue', 'Mean:')} ${mean.toLocaleString('en-AU', {maximumFractionDigits: 0})}`);
  console.log(`  ${styleText('blue', 'Median:')} ${median.toLocaleString()}`);
  console.log(`  ${styleText('blue', 'P95:')} ${p95.toLocaleString()}`);
  console.log(`  ${styleText('blue', 'Total samples:')} ${values.length.toLocaleString()}`);

  if (showThresholds) {
    console.log(`\n${styleText('dim', 'Threshold Analysis:')}`);
    if (thresholds.critical) {
      const aboveCritical = values.filter(v => v >= thresholds.critical).length;
      const criticalPercent = ((aboveCritical / values.length) * 100).toFixed(1);
      console.log(`  ${styleText('red', 'Above Critical:')} ${aboveCritical} (${criticalPercent}%)`);
    }
    if (thresholds.warning) {
      const aboveWarning = values.filter(v => v >= thresholds.warning && (!thresholds.critical || v < thresholds.critical)).length;
      const warningPercent = ((aboveWarning / values.length) * 100).toFixed(1);
      console.log(`  ${styleText('yellow', 'Above Warning:')} ${aboveWarning} (${warningPercent}%)`);
    }
  }
}

/**
 * Create histogram for distribution analysis
 * @param {Array} timeSeriesData - Array of {timestamp, value} objects
 * @param {Object} thresholds - Object with critical/warning thresholds
 * @param {Object} options - Chart configuration options
 */
function createComprehensiveCharts(timeSeriesData, thresholds = {}, options = {}) {
  const {
    title = 'Monitor Analysis',
    histogramOptions = {}
  } = options;

  console.log(`\n${styleText('bold', `📊 ${title} - Distribution Analysis`)}`);
  console.log(styleText('dim', '═'.repeat(80)));

  // Create histogram from the values
  const values = timeSeriesData.map(d => d.value);
  createHistogram(values, thresholds, {
    title: 'Value Distribution - Frequency Analysis',
    ...histogramOptions
  });

  console.log(styleText('dim', '═'.repeat(80)));
}

module.exports = {
  createHistogram,
  createComprehensiveCharts
};

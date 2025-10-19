# Watch-Dog

A simple tool to pull some statistics for datadog monitors. It's mostly helpful when assessing if alert thresholds make sense after traffic changes. Down with annoying alerts. 

Note: this tool is basically entirely AI generated. I've kept its dependencies to the bare minimum and most of the code is pretty sane. But trust it slightly less then you would some random code on the internet.

## Prerequisites

- Node.js (see package.json for dependencies)
- Datadog API key and Application key
- Environment variables: `DD_API_KEY` and `DD_APP_KEY`

## Setup

```bash
npm install
```

Create a `.env` file with your Datadog credentials:
```sh
# DataDog API Credentials
# Get these from: https://app.datadoghq.com/organization-settings/api-keys

DD_API_KEY=XXXX
DD_APP_KEY=XXXX
```

## Tools

### Monitor Analysis

```bash
node analyse-monitor.js <monitor_id> [--debug] [--days=N] [--charts]
```

Analyzes monitor performance with:
- High-resolution data analysis (5-minute intervals)
- Rolling window calculations matching monitor logic
- Threshold breach detection and timing
- Statistical analysis and recommendations
- Evaluation window suggestions

**Options:**
- `--debug` - Enable detailed debug output
- `--days=N` - Number of days to analyze (default: 3, max: 28)
- `--charts` - Display visual distribution histogram

**Example:**
```bash
node analyse-monitor.js 9564272 --days=2 --charts
```

## Components

- **analyse-monitor.js** - Main analysis tool with recommendations
- **datadog-fetcher.js** - Optimized data fetching with automatic rollup selection
- **rollup-calculator.js** - Rolling window calculations and query parsing
- **cli-charts.js** - Terminal-based visualization tools

## Testing

```bash
npm test
```

## Example Output
```sh
node analyse-monitor.js 1234567 --days=7

░██       ░██               ░██               ░██        ░███████
░██       ░██               ░██               ░██        ░██   ░██
░██  ░██  ░██  ░██████   ░████████  ░███████  ░████████  ░██    ░██  ░███████   ░████████
░██ ░████ ░██       ░██     ░██    ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██
░██░██ ░██░██  ░███████     ░██    ░██        ░██    ░██ ░██    ░██ ░██    ░██ ░██    ░██
░████   ░████ ░██   ░██     ░██    ░██    ░██ ░██    ░██ ░██   ░██  ░██    ░██ ░██   ░███
░███     ░███  ░█████░██     ░████  ░███████  ░██    ░██ ░███████    ░███████   ░█████░██
                                                                                      ░██
                                                                                ░███████

🐶 Monitor Analysis: 1234567
   Name: Dummy Monitor
   ID: 123456
   Query: min(last_4h):avg:dummy > 600
   Current State: OK
   Rollup: avg over 30m (1800s intervals)

📈 CURRENT THRESHOLDS:
   Critical: 600
   Warning: Not set
   Critical Recovery: Not set
   Direction: High values are bad

🔍 BREACH DETAILS:
   Critical: 16/10/2025, 6:00:00 pm → 16/10/2025, 7:00:00 pm (60 minutes, peak: 2,586)
   Critical: 17/10/2025, 9:30:00 pm → 17/10/2025, 10:35:00 pm (65 minutes, peak: 2,669)
   Critical: 17/10/2025, 11:10:00 pm → 18/10/2025, 12:10:00 am (60 minutes, peak: 2,655)

📊 MONITOR STATISTICS:
   Raw data points: 1,845 (5-minute intervals)
   Range: 0 - 2,669
   Mean: 37
   Median: 1
   P95: 5
   P99: 1,758
   Standard Deviation: 254

🚨 THRESHOLD BREACHES:
   Total Breaches: 3
   Critical Breaches: 3
   Warning Breaches: 0
   Average Duration: 62 minutes
   Longest Breach: 65 minutes
   Quick Recovery (<15min): 0
   Sustained Issues (>30min): 3
   Max Deviation: 2,069
   Volatility Score: 10/10 (higher = more volatile)

🎯 THRESHOLD RECOMMENDATIONS:
   Strategy: Conservative (High volatility or sustained breaches)
   Warning: > 1,214 (65-80% of critical for early warning)
   Critical: > 1,868 (Conservative (High volatility or sustained breaches) based on P95/P99 analysis)
   Recovery: > 1,588 (Hysteresis to prevent alert flapping)

🕥 EVALUATION WINDOW RECOMMENDATIONS:
   Current Window: 30m
   Recommended Window: avg(last_15m) (Based on 62min average breach duration)
   Recommended Delay: 900 seconds (Prevents false alarms during brief fluctuations)

💡 KEY INSIGHTS:
   • Long average breach duration suggests 15-minute window appropriate
   • High volatility (10/10) suggests conservative thresholds
   • 3 sustained breaches detected - monitor for recurring issues
   • Maximum deviation: 2,069 - shows severity of worst breaches
```
# Data Schema and Cache Structures

This document describes the folder structure, data files, JSON schemas, and caching layers of the **SEC Filing NLP Alpha Engine**.

---

## 1. Storage Layout

The data directory is divided into raw, processed, and public frontend folders:

```
sec_nlp/
├── data/
│   ├── raw/                  # Cached raw HTML files downloaded from SEC EDGAR
│   │   └── {TICKER}/
│   │       └── {ACCESSION}.html
│   ├── processed/            # Extracted MD&A and Risk Factors sections
│   │   └── {TICKER}/
│   │       ├── {ACCESSION}_mda.txt
│   │       └── {ACCESSION}_risk_factors.txt
│   └── prices/               # Cached adjusted close prices from yfinance
│       └── {TICKER}.csv
├── backend/
│   └── data/
│       └── finbert_cache.json # Cached FinBERT logits to prevent re-running model
└── frontend/
    └── public/
        └── data/             # Exported JSON databases consumed by Next.js SPA
            ├── summary.json  # Global stats, IC scores, and active tickers
            ├── {TICKER}.json # Ticker timeline metrics
            └── sections/     # Section texts loaded on demand by diff viewer
                └── {TICKER}/
                    ├── {ACCESSION}_mda.txt
                    └── {ACCESSION}_risk_factors.txt
```

---

## 2. Output Schema Specifications

### `summary.json`
Contains aggregate statistics and cross-sectional Information Coefficient (IC) scores.
```json
{
  "tickers": ["AAPL", "MSFT"],
  "total_filings": 24,
  "ic_scores": {
    "1": 0.0660201953598867,
    "5": -0.0048544261294034335,
    "21": -0.20874032356434766,
    "63": 0.09312386775705078
  },
  "last_updated": "2026-06-25 23:45:00",
  "recent_filings": [
    {
      "ticker": "AAPL",
      "form": "10-Q",
      "filing_date": "2026-05-01",
      "composite_signal": 0.4285
    }
  ]
}
```

### `{TICKER}.json` (e.g., `AAPL.json`)
A chronological array of filing events containing raw counts, readability metrics, NLP sentiment scores, forward returns, and composite signals.
```json
[
  {
    "ticker": "AAPL",
    "accession": "000032019326000042",
    "form": "10-Q",
    "filing_date": "2026-05-01",
    "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000042/aapl-20260328.htm",
    "lm_sentiment_score": 0.0812,
    "lm_uncertainty_score": 0.0245,
    "fog_index": 16.42,
    "flesch_reading_ease": 38.5,
    "risk_word_count": 5204,
    "finbert_sentiment_score": 0.1245,
    "fwd_return_1d": 0.0125,
    "fwd_return_5d": 0.0310,
    "fwd_return_21d": 0.0450,
    "fwd_return_63d": null,
    "fwd_return_1d_bench": 0.0050,
    "fwd_return_5d_bench": 0.0120,
    "fwd_return_21d_bench": 0.0180,
    "fwd_return_63d_bench": null,
    "alpha_1d": 0.0075,
    "alpha_5d": 0.0190,
    "alpha_21d": 0.0270,
    "alpha_63d": null,
    "sentiment_yoy_change": 0.0124,
    "finbert_yoy_change": 0.0450,
    "risk_wordcount_yoy_pct": 0.052,
    "uncertainty_change": -0.0021,
    "readability_change": 0.25,
    "sentiment_yoy_change_z": 0.421,
    "finbert_yoy_change_z": 0.852,
    "risk_wordcount_yoy_pct_z": 0.125,
    "uncertainty_change_z": -0.052,
    "readability_change_z": 0.114,
    "composite_signal": 0.4285
  }
]
```

---

## 3. Caching Layouts

### `finbert_cache.json`
FinBERT evaluations take considerable time. We cache computed results locally to bypass GPU/CPU calculations on subsequent pipeline runs.
*   **Key:** `{accession}_{section}`
*   **Value:** Score (float, range -1.0 to 1.0)
```json
{
  "000032019326000042_mda": 0.1245,
  "000078901925000035_mda": -0.0842
}
```

### Price Caching (`data/prices/{TICKER}.csv`)
Historical stock prices are saved as simple CSV structures containing adjusted close values to speed up backtest evaluation:
```csv
Date,Adj Close
2023-01-03,124.2162
2023-01-04,125.5015
2023-01-05,124.1666
```
The engine automatically appends dates if the cached range is older than the lookback request, ensuring the price history is always complete.

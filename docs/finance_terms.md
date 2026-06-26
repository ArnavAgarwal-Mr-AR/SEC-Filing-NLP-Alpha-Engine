# Finance Terms and Concepts

This document explains the core finance concepts, metrics, and quantitative methodologies implemented in the **SEC Filing NLP Alpha Engine**.

---

## 1. Central Index Key (CIK)
The **Central Index Key** is a unique 10-digit number assigned by the SEC (Securities and Exchange Commission) to identify companies, individuals, or mutual funds that submit filings.
*   **Format:** Ticker mapping converts symbols (e.g., `AAPL`) to zero-padded integers (e.g., `0000320193`).
*   **Significance:** CIK is the standard key used across the SEC EDGAR submissions API, as tickers can change during mergers or delistings, whereas CIK remains permanent.

---

## 2. Year-over-Year (YoY) Deltas
Quant strategies rarely use raw sentiment scores (e.g., *"this company has a sentiment of 0.35"*) because each firm has a unique writing style and boilerplate text. 
Instead, they look at the **change in tone** relative to the company's historical baseline.

*   **Quarterly Alignment:** Filings are seasonal. Companies report Q1, Q2, Q3 (10-Q) and Q4 (10-K).
*   **Calculation:** We compute changes using a 4-quarter lag (YoY) to filter out seasonal patterns:
    $$\Delta \text{Sentiment}_{t} = \text{Sentiment}_{t} - \text{Sentiment}_{t-4}$$
    $$\% \Delta \text{Risk Word Count}_{t} = \frac{\text{Risk Word Count}_{t} - \text{Risk Word Count}_{t-4}}{\text{Risk Word Count}_{t-4}}$$

---

## 3. Cross-Sectional Z-Score & Composite Signal
To rank companies and construct long/short portfolios, raw time-series changes must be normalized cross-sectionally.

### Standard Z-Score Formula
For a given metric $X_i$ of company $i$:
$$Z(X_i) = \frac{X_i - \mu_{X}}{\sigma_{X}}$$

Where:
*   $\mu_{X}$ is the cross-sectional mean of the change across all companies in the target universe.
*   $\sigma_{X}$ is the cross-sectional standard deviation.

### Composite Alpha Signal
The final composite signal combines normalized deltas into a single score:
$$\text{Composite Signal} = 0.5 \times Z(\Delta \text{LM Sent}) + 0.5 \times Z(\Delta \text{FinBERT}) - 0.5 \times Z(\% \Delta \text{Risk Count}) - 0.5 \times Z(\Delta \text{Uncertainty}) - 0.5 \times Z(\Delta \text{Fog})$$

A positive composite score represents improving sentiment, shrinking risk factor sections, and simpler writing compared to peers.

---

## 4. Forward Returns & Benchmark Relative Returns (Alpha)
To evaluate signal efficacy, we track stock returns over several holding periods starting from the filing release date ($T_0$):
$$\text{Forward Return}_{H} = \frac{\text{Price}_{T_0 + H}}{\text{Price}_{T_0}} - 1$$

*   **Horizons ($H$):** We track 1d, 5d, 21d (1 month), and 63d (3 months) horizons.
*   **Benchmark (SPY):** Raw stock returns are affected by market movements. We isolate stock-specific return (**Alpha**) by subtracting the index return:
    $$\text{Alpha}_{H} = \text{Forward Return}_{H,\text{ Stock}} - \text{Forward Return}_{H,\text{ SPY}}$$

---

## 5. Information Coefficient (IC)
The **Information Coefficient** is a standard metric used by quantitative analysts to measure the predictive skill of a factor.
It is calculated as the **Spearman Rank Correlation** between the signal score at the filing date and subsequent stock alpha:

$$\text{IC}_{H} = \rho \left( \text{Rank}(\text{Composite Signal}), \text{Rank}(\text{Alpha}_{H}) \right)$$

*   **Range:** -1.0 to +1.0.
*   **Significance:** An IC of $0.05$ to $0.15$ is typical for a successful, research-grade quantitative equity signal. An IC decay curve indicates how fast the signal's predictive power decays over longer holding periods.

---

## 6. Post-Earnings-Announcement Drift (PEAD)
**Post-Earnings-Announcement Drift** is a well-documented market anomaly where stock prices continue to drift in the direction of an earnings surprise (either positive or negative) for weeks or months after the announcement, rather than adjusting instantly.
*   **Textual Alpha Link:** Sentiment changes in 10-Ks and 10-Qs are a form of non-numerical "surprise". If management uses significantly more hedging or risk language, the market often underreacts initially, leading to a negative price drift over the subsequent quarter. The backtester measures this effect.

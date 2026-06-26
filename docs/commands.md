# Command Reference Guide

This document lists all available commands, scripts, and parameters you can run to manage, ingest data, backtest, test, and host the **SEC Filing NLP Alpha Engine**.

---

## 1. Setup & Environment
Run these commands to initialize the project and install all required libraries.

```bash
# Run setup (installs Python backend packages and Node frontend packages)
npm run setup
```

To install GPU-enabled PyTorch (optional, to speed up FinBERT scoring):
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

---

## 2. Ingestion & Scoring Pipeline (Backend Compiler)
The backend pipeline downloads, parses, and scores filings. You can control the ticker lists, history depth, and NLP models.

### Run Dictionary Scorer (Fast Mode - Recommended)
Runs Loughran-McDonald sentiment, readability, and forward return backtesting, skipping FinBERT models.
*   **Run on default tickers (AAPL, MSFT, GOOGL, AMZN, META) for 3 years:**
    ```bash
    npm run pipeline-fast
    ```
*   **Run on custom tickers (e.g., NVIDIA, Tesla, AMD) for 5 years:**
    ```bash
    python backend/run_pipeline.py --tickers NVDA TSLA AMD --years 5 --skip-finbert
    ```

### Run Full NLP Model (FinBERT Scorer Mode)
Enables FinBERT deep-learning scoring. (Downloads weights from Hugging Face on the first run, then caches output logits to `backend/data/finbert_cache.json`).
*   **Run on default tickers:**
    ```bash
    npm run pipeline
    ```
*   **Run on custom tickers:**
    ```bash
    python backend/run_pipeline.py --tickers NVDA TSLA --years 3
    ```

### CLI Command Options (`run_pipeline.py`)
```bash
python backend/run_pipeline.py [OPTIONS]
```
*   `--tickers TICKER1 TICKER2 ...` : Space-separated list of stock tickers (default: AAPL, MSFT, GOOGL, AMZN, META).
*   `--years N` : Number of years of history to fetch from SEC submissions (default: 5).
*   `--skip-finbert` : Skip the transformer-based scorer to run instantly.

---

## 3. Launching the Web Dashboard (Frontend)
Run these commands to boot the dashboard.

### Production Mode (Bypasses Slow Disk / Network Drive Latencies - Recommended)
Compiles static assets once and launches the production server. Operates fully in-memory at sub-second speeds.
```bash
# Compile fast data pipeline, build Next.js, and start production host
npm run start
```
*To build and start the frontend only (without re-compiling backend data):*
```bash
cd frontend
npm run build
npm run start
```

### Development Mode (For Code Modifying & Iterations)
Starts Next.js hot-reloading dev server. Re-compiles modules dynamically when files are edited.
```bash
# Start Next.js hot-reloader
npm run dev
```

---

## 4. Testing & Verification
Verifies the modules and algorithms locally.

```bash
# Runs backend unit tests (parsers, negation lookbacks, z-scoring, deltas)
npm run test
```

Manual execution:
```bash
python -m unittest discover -s backend/tests -p "test_*.py"
```

---

## 5. Maintenance & Cache Clearing
To reset files or trigger fresh evaluations:

*   **To clear raw filing HTML caches:** Delete `data/raw/` directory.
*   **To clear stock price caches:** Delete `data/prices/` directory.
*   **To reset FinBERT score logs:** Delete `backend/data/finbert_cache.json` file.

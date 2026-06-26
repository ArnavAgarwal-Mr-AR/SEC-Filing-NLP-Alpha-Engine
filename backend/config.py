import os
from pathlib import Path

# Base Paths
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

# Data Directories
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
SIGNALS_DIR = DATA_DIR / "signals"

# Create directories if they do not exist
for path in [DATA_DIR, RAW_DIR, PROCESSED_DIR, SIGNALS_DIR]:
    path.mkdir(parents=True, exist_ok=True)

# Frontend Public Data Directory (for Vercel app zero-cold-start JSON files)
FRONTEND_DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"
FRONTEND_DATA_DIR.mkdir(parents=True, exist_ok=True)

# SEC API Ingestion Configuration
# Generic compliant header to prevent SEC blocks without exposing personal user details
SEC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AcademicResearch/1.0 (nlp@research.com)",
    "Accept-Encoding": "gzip, deflate"
}
SEC_RATE_LIMIT_SLEEP = 0.15  # seconds (max 10 requests per second allowed by SEC)

# Default tickers for backtesting and dashboard
DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "NFLX", "AMD", "QCOM"]

# Backtest Configuration
FWD_RETURN_HORIZONS = [1, 5, 21, 63]  # trading days
BENCHMARK_TICKER = "SPY"

# NLP Configuration
LM_SUBSET_PATH = BACKEND_DIR / "resources" / "lm_subset.json"
FINBERT_MODEL_NAME = "ProsusAI/finbert"
FINBERT_CHUNK_SIZE = 512  # max tokens per chunk for BERT
FINBERT_MAX_CHUNKS = 50   # cap chunks per filing to manage compute time

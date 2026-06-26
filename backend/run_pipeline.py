import os
import argparse
import json
import pandas as pd
from pathlib import Path
from backend.config import (
    DEFAULT_TICKERS, FRONTEND_DATA_DIR, RAW_DIR, PROCESSED_DIR, FWD_RETURN_HORIZONS
)
from backend.data_pipeline.downloader import get_cik, get_filing_metadata, download_and_cache_filing
from backend.data_pipeline.parser import process_filing_file
from backend.nlp_engine.scorers import LoughranMcDonaldScorer, ReadabilityScorer, FinBERTScorer
from backend.signals.generator import generate_signals
from backend.backtest.engine import BacktestEngine

def load_finbert_cache(cache_path: Path) -> dict:
    if cache_path.exists():
        try:
            with open(cache_path, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_finbert_cache(cache: dict, cache_path: Path):
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=2)

def main():
    parser = argparse.ArgumentParser(description="SEC Filing NLP Alpha Engine Ingestion & Processing Pipeline")
    parser.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS, help="List of tickers to process")
    parser.add_argument("--years", type=int, default=5, help="Number of years to look back")
    parser.add_argument("--skip-finbert", action="store_true", help="Skip running the transformer-based FinBERT scorer")
    args = parser.parse_args()

    print("=" * 60)
    print("STARTING SEC NLP ALPHA PIPELINE")
    print(f"Tickers: {args.tickers}")
    print(f"Lookback: {args.years} years")
    print(f"FinBERT: {'SKIPPED' if args.skip_finbert else 'ENABLED (cached)'}")
    print("=" * 60)

    # Initialize components
    lm_scorer = LoughranMcDonaldScorer()
    readability_scorer = ReadabilityScorer()
    
    finbert_scorer = None
    finbert_cache_path = Path(__file__).resolve().parent / "data" / "finbert_cache.json"
    finbert_cache = {}
    
    if not args.skip_finbert:
        try:
            finbert_scorer = FinBERTScorer()
            finbert_cache = load_finbert_cache(finbert_cache_path)
            print("FinBERT model initialized successfully.")
        except Exception as e:
            print(f"Could not load FinBERT. Falling back to dictionary-only: {e}")
            args.skip_finbert = True

    backtest_engine = BacktestEngine()
    
    ticker_cache = {}
    for ticker in args.tickers:
        ticker_path = FRONTEND_DATA_DIR / f"{ticker}.json"
        if ticker_path.exists():
            with open(ticker_path, "r") as f:
                try:
                    data = json.load(f)
                    ticker_cache[ticker] = {r["accession"]: r for r in data}
                except:
                    ticker_cache[ticker] = {}
        else:
            ticker_cache[ticker] = {}
    
    filing_records = []
    
    # Process each ticker
    for ticker in args.tickers:
        ticker = ticker.upper().strip()
        print(f"\nProcessing {ticker}...")
        
        try:
            cik = get_cik(ticker)
            print(f"  CIK resolved: {cik}")
        except Exception as e:
            print(f"  Error resolving CIK: {e}")
            continue
            
        try:
            filings = get_filing_metadata(cik, lookback_years=args.years)
            print(f"  Found {len(filings)} filings in lookback period.")
        except Exception as e:
            print(f"  Error fetching metadata: {e}")
            continue
            
        for idx, filing in enumerate(filings):
            cached_rec = ticker_cache.get(ticker, {}).get(filing["accession"])
            if cached_rec and "top_positive" in cached_rec:
                print(f"  [{idx+1}/{len(filings)}] Skipping {filing['accession']} (cached)")
                filing_records.append(cached_rec)
                continue

            print(f"  [{idx+1}/{len(filings)}] Filing {filing['form']} on {filing['filing_date']}...")
            
            try:
                # 1. Download / cache raw file
                raw_path = download_and_cache_filing(ticker, filing)
                
                # 2. Clean & parse sections
                parse_results = process_filing_file(
                    raw_path, ticker, filing["accession"], filing["form"]
                )
                
                # 3. Extract section texts for scoring and frontend storage
                mda_text = ""
                risk_text = ""
                
                with open(parse_results["mda_path"], "r", encoding="utf-8") as f:
                    mda_text = f.read()
                with open(parse_results["risk_factors_path"], "r", encoding="utf-8") as f:
                    risk_text = f.read()
                    
                # 4. Copy parsed sections to frontend public folder so the UI diff viewer works offline
                front_section_dir = FRONTEND_DATA_DIR / "sections" / ticker
                front_section_dir.mkdir(parents=True, exist_ok=True)
                
                # Save to frontend public folder
                with open(front_section_dir / f"{filing['accession']}_mda.txt", "w", encoding="utf-8") as f:
                    f.write(mda_text)
                with open(front_section_dir / f"{filing['accession']}_risk_factors.txt", "w", encoding="utf-8") as f:
                    f.write(risk_text)

                # Combine texts for overall dictionary scoring
                combined_text = mda_text + " " + risk_text
                
                # 5. Score with LM Dictionary and Readability
                lm_metrics = lm_scorer.score(combined_text)
                read_metrics = readability_scorer.score(combined_text)
                
                # Count risk word counts
                risk_words_count = len(risk_text.split())
                
                # 6. Score with FinBERT (MD&A is primary context-aware sentiment source)
                finbert_score = 0.0
                if not args.skip_finbert:
                    cache_key = f"{filing['accession']}_mda"
                    if cache_key in finbert_cache:
                        finbert_score = finbert_cache[cache_key]
                    else:
                        print("    Running FinBERT inference (will cache)...")
                        # Run FinBERT on MD&A text
                        finbert_score = finbert_scorer.score(mda_text)
                        finbert_cache[cache_key] = finbert_score
                
                # Assemble record
                record = {
                    "ticker": ticker,
                    "accession": filing["accession"],
                    "form": filing["form"],
                    "filing_date": filing["filing_date"],
                    "url": filing["url"],
                    "lm_sentiment_score": lm_metrics["lm_sentiment_score"],
                    "lm_uncertainty_score": lm_metrics["lm_uncertainty_score"],
                    "lm_pos_words": lm_metrics["lm_pos_words"],
                    "lm_neg_words": lm_metrics["lm_neg_words"],
                    "lm_unc_words": lm_metrics["lm_unc_words"],
                    "total_words": lm_metrics["total_words"],
                    "fog_index": read_metrics["fog_index"],
                    "flesch_reading_ease": read_metrics["flesch_reading_ease"],
                    "risk_word_count": risk_words_count,
                    "finbert_sentiment_score": finbert_score,
                    "top_positive": lm_metrics["top_positive"],
                    "top_negative": lm_metrics["top_negative"],
                    "top_uncertainty": lm_metrics["top_uncertainty"]
                }
                
                filing_records.append(record)
                
            except Exception as e:
                print(f"    Error processing filing {filing['accession']}: {e}")
                
    if not filing_records:
        print("\nNo filings processed successfully. Exiting.")
        return
        
    df_raw = pd.DataFrame(filing_records)
    
    # 7. Download forward prices and compute returns
    print("\nComputing forward returns & alphas...")
    all_dates = df_raw["filing_date"].unique().tolist()
    
    # Pre-download SPY
    try:
        backtest_engine.get_prices("SPY", "2018-01-01", pd.Timestamp.now().strftime("%Y-%m-%d"))
    except Exception as e:
        print(f"Warning: could not pre-download SPY prices: {e}")
        
    fwd_returns_list = []
    for ticker in df_raw["ticker"].unique():
        ticker_dates = df_raw[df_raw["ticker"] == ticker]["filing_date"].tolist()
        try:
            ret_df = backtest_engine.run_event_returns(ticker, ticker_dates)
            if not ret_df.empty:
                fwd_returns_list.append(ret_df)
        except Exception as e:
            print(f"Error getting returns for {ticker}: {e}")
            
    if fwd_returns_list:
        df_returns = pd.concat(fwd_returns_list)
        # Drop overlapping return/alpha columns from df_raw to prevent suffixes during merge
        cols_to_drop = [c for c in df_returns.columns if c in df_raw.columns and c not in ["ticker", "filing_date"]]
        df_raw_clean = df_raw.drop(columns=cols_to_drop)
        df_merged = pd.merge(df_raw_clean, df_returns, left_on=["ticker", "filing_date"], right_on=["ticker", "event_date"], how="left")
    else:
        # Create empty return columns if download failed
        df_merged = df_raw.copy()
        for h in FWD_RETURN_HORIZONS:
            df_merged[f"fwd_return_{h}d"] = 0.0
            df_merged[f"alpha_{h}d"] = 0.0

    # 8. Generate Signals
    print("Constructing signals & z-scores...")
    df_signals = generate_signals(df_merged)
    
    # 9. Evaluate Information Coefficient
    print("Evaluating signal predictive power (IC)...")
    ic_scores = BacktestEngine.calculate_information_coefficient(df_signals, "composite_signal")
    print(f"  Information Coefficient (composite_signal vs. alpha): {ic_scores}")
    
    # 10. Export results to Frontend Data folder
    print("\nExporting files for frontend...")
    
    # Save individual ticker timelines
    for ticker, group in df_signals.groupby("ticker"):
        ticker_path = FRONTEND_DATA_DIR / f"{ticker}.json"
        
        # Convert dataframe to list of dicts with JSON-friendly dates
        records = group.to_dict(orient="records")
        # Handle nan values
        records_json = json.loads(pd.Series(records).to_json(orient="values"))
        
        with open(ticker_path, "w") as f:
            json.dump(records_json, f, indent=2)
            
    # Save summary stats
    summary_data = {
        "tickers": df_signals["ticker"].unique().tolist(),
        "total_filings": len(df_signals),
        "ic_scores": ic_scores,
        "last_updated": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        "recent_filings": df_signals.sort_values("filing_date", ascending=False).head(10)[
            ["ticker", "form", "filing_date", "composite_signal"]
        ].to_dict(orient="records")
    }
    
    with open(FRONTEND_DATA_DIR / "summary.json", "w") as f:
        json.dump(summary_data, f, indent=2)
        
    # Save FinBERT cache
    if not args.skip_finbert:
        save_finbert_cache(finbert_cache, finbert_cache_path)
        
    print(f"\nSUCCESS! Pipeline run complete. Exported files to {FRONTEND_DATA_DIR}")

if __name__ == "__main__":
    main()

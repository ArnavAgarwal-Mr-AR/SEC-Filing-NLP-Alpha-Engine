import pandas as pd
import numpy as np
import yfinance as yf
from pathlib import Path
from backend.config import DATA_DIR, FWD_RETURN_HORIZONS, BENCHMARK_TICKER

class BacktestEngine:
    """
    Downloads historical price data and evaluates the predictive power
    of sentiment signals on subsequent stock returns.
    """
    def __init__(self, cache_dir=DATA_DIR / "prices"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._price_cache = {}

    def get_prices(self, ticker: str, start_date: str, end_date: str) -> pd.Series:
        """
        Fetches adjusted close prices for a ticker from yfinance, caching them to disk.
        """
        ticker = ticker.upper().strip()
        cache_file = self.cache_dir / f"{ticker}.csv"
        
        # Check in-memory cache
        cache_key = (ticker, start_date, end_date)
        if cache_key in self._price_cache:
            return self._price_cache[cache_key]

        df = None
        # Check disk cache
        if cache_file.exists():
            df = pd.read_csv(cache_file, index_col=0, parse_dates=True)
            # Verify if dates are covered
            # If the requested range is covered, use the cached version
            min_date = df.index.min().strftime("%Y-%m-%d")
            max_date = df.index.max().strftime("%Y-%m-%d")
            if min_date <= start_date and max_date >= end_date:
                prices = df["Adj Close"]
                self._price_cache[cache_key] = prices.loc[start_date:end_date]
                return self._price_cache[cache_key]
        
        # Download from yfinance (buffer start and end date to handle weekends/holidays)
        today_str = pd.Timestamp.now().strftime("%Y-%m-%d")
        buffered_start = (pd.Timestamp(start_date) - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
        buffered_end = (pd.Timestamp(end_date) + pd.Timedelta(days=120)).strftime("%Y-%m-%d")
        if pd.Timestamp(buffered_end) > pd.Timestamp(today_str):
            buffered_end = today_str
        
        # Download ticker
        data = yf.download(ticker, start=buffered_start, end=buffered_end, progress=False)
        if data.empty:
            raise ValueError(f"No price data returned for {ticker}")
            
        # Standardize index
        data.index = pd.to_datetime(data.index)
        
        # Extract Adj Close (handling multi-index headers sometimes returned by yfinance)
        if isinstance(data.columns, pd.MultiIndex):
            if "Adj Close" in data.columns.levels[0]:
                prices_df = data["Adj Close"]
            elif "Close" in data.columns.levels[0]:
                prices_df = data["Close"]
            else:
                prices_df = data.iloc[:, 0]
        else:
            prices_df = data["Adj Close"] if "Adj Close" in data.columns else data["Close"]

        # Ensure single series
        if isinstance(prices_df, pd.DataFrame):
            # If multiple columns (e.g. ticker was parsed as list), select the column
            prices = prices_df.iloc[:, 0]
        else:
            prices = prices_df
            
        prices = prices.dropna()
        
        # Save full downloaded history to disk cache
        prices.to_csv(cache_file)
        
        # Return requested slice
        sliced = prices.loc[start_date:end_date]
        self._price_cache[cache_key] = sliced
        return sliced

    def compute_forward_returns(self, ticker: str, event_date_str: str, horizons=FWD_RETURN_HORIZONS) -> dict:
        """
        Calculates the forward returns for a ticker starting from an event date.
        Returns a dictionary of returns for each horizon.
        """
        event_date = pd.Timestamp(event_date_str)
        # Fetch prices for a wide window around event date
        start_str = (event_date - pd.Timedelta(days=5)).strftime("%Y-%m-%d")
        end_str = (event_date + pd.Timedelta(days=150)).strftime("%Y-%m-%d")
        
        try:
            prices = self.get_prices(ticker, start_str, end_str)
        except Exception as e:
            # Fallback if download fails
            return {f"fwd_return_{h}d": 0.0 for h in horizons}

        if prices.empty:
            return {f"fwd_return_{h}d": 0.0 for h in horizons}
            
        # Find the first trading day on or after the event date
        trading_days = prices.index[prices.index >= event_date]
        if len(trading_days) == 0:
            return {f"fwd_return_{h}d": 0.0 for h in horizons}
            
        t0_date = trading_days[0]
        t0_idx = prices.index.get_loc(t0_date)
        p0 = prices.iloc[t0_idx]
        
        results = {}
        for h in horizons:
            target_idx = t0_idx + h
            if target_idx < len(prices):
                p_h = prices.iloc[target_idx]
                results[f"fwd_return_{h}d"] = (p_h / p0) - 1.0
            else:
                results[f"fwd_return_{h}d"] = np.nan
                
        return results

    def run_event_returns(self, ticker: str, event_dates: list) -> pd.DataFrame:
        """
        Runs forward return calculations for a list of event dates for a given ticker,
        including benchmark (SPY) relative returns (alpha).
        """
        ticker_returns = []
        spy_returns = []
        
        for date_str in event_dates:
            t_ret = self.compute_forward_returns(ticker, date_str)
            s_ret = self.compute_forward_returns(BENCHMARK_TICKER, date_str)
            
            t_ret["event_date"] = date_str
            t_ret["ticker"] = ticker
            ticker_returns.append(t_ret)
            
            s_ret["event_date"] = date_str
            spy_returns.append(s_ret)
            
        df_ticker = pd.DataFrame(ticker_returns)
        df_spy = pd.DataFrame(spy_returns)
        
        if df_ticker.empty:
            return df_ticker
            
        # Compute abnormal returns (alpha)
        df_merged = pd.merge(df_ticker, df_spy, on="event_date", suffixes=("", "_bench"))
        
        for h in FWD_RETURN_HORIZONS:
            df_merged[f"alpha_{h}d"] = df_merged[f"fwd_return_{h}d"] - df_merged[f"fwd_return_{h}d_bench"]
            
        return df_merged
        
    @staticmethod
    def calculate_information_coefficient(df: pd.DataFrame, signal_col: str) -> dict:
        """
        Computes Information Coefficient (Rank Correlation) between signal and forward returns.
        """
        ic_results = {}
        for h in FWD_RETURN_HORIZONS:
            ret_col = f"alpha_{h}d"
            if ret_col in df.columns:
                valid = df[[signal_col, ret_col]].dropna()
                if len(valid) > 3:
                    # Spearman rank correlation
                    ic, _ = pd.Series.corr(valid[signal_col], valid[ret_col], method="spearman"), 0
                    ic_results[h] = float(ic) if not np.isnan(ic) else 0.0
                else:
                    ic_results[h] = 0.0
            else:
                ic_results[h] = 0.0
        return ic_results

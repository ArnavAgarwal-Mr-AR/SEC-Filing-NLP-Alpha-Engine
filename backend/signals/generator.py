import pandas as pd
import numpy as np

def compute_time_series_deltas(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes YoY deltas (using a 4-quarter lag) for sentiment, uncertainty,
    readability, and word count statistics.
    Expects input sorted by filing_date.
    """
    if df.empty:
        return df
        
    df = df.sort_values("filing_date").copy()
    
    # Fill zero word counts to avoid division by zero
    word_count_min = df["risk_word_count"].replace(0, np.nan)
    
    # Calculate YoY changes (4 periods back for quarterly reports)
    df["sentiment_yoy_change"] = df["lm_sentiment_score"].diff(4)
    df["finbert_yoy_change"] = df["finbert_sentiment_score"].diff(4)
    df["risk_wordcount_yoy_pct"] = word_count_min.pct_change(4)
    df["uncertainty_change"] = df["lm_uncertainty_score"].diff(4)
    df["readability_change"] = df["fog_index"].diff(4)
    
    # Fallback to QoQ diff(1) if there are fewer than 4 filings
    if len(df) < 5:
        df["sentiment_yoy_change"] = df["lm_sentiment_score"].diff(1)
        df["finbert_yoy_change"] = df["finbert_sentiment_score"].diff(1)
        df["risk_wordcount_yoy_pct"] = word_count_min.pct_change(1)
        df["uncertainty_change"] = df["lm_uncertainty_score"].diff(1)
        df["readability_change"] = df["fog_index"].diff(1)
        
    # Fill NaNs with 0 to prevent downstream z-score issues
    for col in ["sentiment_yoy_change", "finbert_yoy_change", "risk_wordcount_yoy_pct", "uncertainty_change", "readability_change"]:
        df[col] = df[col].fillna(0.0)
        
    return df

def generate_signals(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes a dataframe containing multiple tickers, computes time-series deltas per ticker,
    and then calculates cross-sectional z-scores to construct a composite signal.
    """
    if df.empty:
        return df
        
    # 1. Compute time-series deltas per ticker
    processed_dfs = []
    for ticker, group in df.groupby("ticker"):
        processed_dfs.append(compute_time_series_deltas(group))
    df_deltas = pd.concat(processed_dfs)
    
    # 2. Compute cross-sectional z-scores group-by filing date or year-quarter
    # For a smaller set of tickers, we can do global z-scoring if dates are scattered
    # Let's standardize the columns globally or by year-quarter if there are many entries
    
    # Create z-score columns
    cols_to_zscore = ["sentiment_yoy_change", "finbert_yoy_change", "risk_wordcount_yoy_pct", "uncertainty_change", "readability_change"]
    
    for col in cols_to_zscore:
        mean_val = df_deltas[col].mean()
        std_val = df_deltas[col].std()
        
        # Avoid division by zero if std is zero
        if std_val == 0 or np.isnan(std_val):
            df_deltas[f"{col}_z"] = 0.0
        else:
            df_deltas[f"{col}_z"] = (df_deltas[col] - mean_val) / std_val
            
    # 3. Construct the Composite Signal
    # Positive sentiment increase -> +composite
    # Positive FinBERT sentiment increase -> +composite
    # Risk word count increase -> -composite
    # Uncertainty increase -> -composite
    # Complexity (Fog Index) increase -> -composite
    df_deltas["composite_signal"] = (
        0.5 * df_deltas["sentiment_yoy_change_z"]
        + 0.5 * df_deltas["finbert_yoy_change_z"]
        - 0.5 * df_deltas["risk_wordcount_yoy_pct_z"]
        - 0.5 * df_deltas["uncertainty_change_z"]
        - 0.5 * df_deltas["readability_change_z"]
    )
    
    return df_deltas

import json
import time
import requests
from pathlib import Path
from backend.config import SEC_HEADERS, SEC_RATE_LIMIT_SLEEP, RAW_DIR

def get_cik(ticker: str) -> str:
    """
    Resolves a stock ticker to a 10-digit padded CIK string using the SEC company_tickers endpoint.
    """
    ticker = ticker.upper().strip()
    url = "https://www.sec.gov/files/company_tickers.json"
    
    # Need to run with headers
    response = requests.get(url, headers=SEC_HEADERS)
    response.raise_for_status()
    
    data = response.json()
    for entry in data.values():
        if entry["ticker"].upper() == ticker:
            # Return padded CIK
            return str(entry["cik_str"]).zfill(10)
            
    raise ValueError(f"Ticker '{ticker}' not found in SEC company directory.")

def get_filing_metadata(cik: str, form_types=("10-K", "10-Q"), lookback_years=5) -> list:
    """
    Retrieves metadata for recent filings of a given CIK from SEC Submissions API.
    """
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    response = requests.get(url, headers=SEC_HEADERS)
    response.raise_for_status()
    
    data = response.json()
    recent = data["filings"]["recent"]
    
    filings = []
    cutoff_time_struct = time.gmtime(time.time() - (lookback_years * 365 * 24 * 3600))
    cutoff_date_str = time.strftime("%Y-%m-%d", cutoff_time_struct)
    
    for i, form in enumerate(recent["form"]):
        if form in form_types:
            filing_date = recent["filingDate"][i]
            if filing_date < cutoff_date_str:
                continue
                
            accession = recent["accessionNumber"][i].replace("-", "")
            primary_doc = recent["primaryDocument"][i]
            
            # Construct download URL
            doc_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/{primary_doc}"
            
            filings.append({
                "cik": cik,
                "form": form,
                "filing_date": filing_date,
                "accession": accession,
                "primary_document": primary_doc,
                "url": doc_url
            })
            
    return filings

def download_and_cache_filing(ticker: str, filing: dict) -> Path:
    """
    Downloads raw SEC filing HTML content and caches it to disk.
    If the file is already cached, skips the network request.
    """
    ticker_dir = RAW_DIR / ticker.upper()
    ticker_dir.mkdir(parents=True, exist_ok=True)
    
    cache_path = ticker_dir / f"{filing['accession']}.html"
    
    if cache_path.exists() and cache_path.stat().st_size > 0:
        # File is already cached
        return cache_path
        
    # Respect rate limits
    time.sleep(SEC_RATE_LIMIT_SLEEP)
    
    response = requests.get(filing["url"], headers=SEC_HEADERS)
    # SEC might return 403 if headers are wrong or if we hit rate limits
    response.raise_for_status()
    
    # Save raw HTML/text to disk
    with open(cache_path, "w", encoding="utf-8", errors="ignore") as f:
        f.write(response.text)
        
    return cache_path

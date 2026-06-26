import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

class handler(BaseHTTPRequestHandler):
    """
    Vercel Serverless Function to serve compiled SEC NLP Engine signals.
    Provides simple API access to summary.json and individual ticker timelines.
    """
    def do_GET(self):
        # Set CORS headers
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)
        
        # Determine paths relative to root deployment directory
        # Vercel deploys the entire workspace, so frontend is at the same level
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(base_dir, "frontend", "public", "data")
        
        if path == "/api/summary" or path == "/api/tickers":
            summary_path = os.path.join(data_dir, "summary.json")
            if os.path.exists(summary_path):
                with open(summary_path, "r", encoding="utf-8") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                # Return template if no pipeline runs have been executed yet
                fallback = {
                    "tickers": [],
                    "total_filings": 0,
                    "ic_scores": {"1": 0, "5": 0, "21": 0, "63": 0},
                    "message": "Pipeline data not found. Please run the local backend pipeline to generate results."
                }
                self.wfile.write(json.dumps(fallback).encode("utf-8"))
                
        elif path == "/api/ticker":
            ticker_symbol = query.get("symbol", [None])[0]
            if not ticker_symbol:
                self.wfile.write(json.dumps({"error": "Missing 'symbol' parameter. Usage: /api/ticker?symbol=AAPL"}).encode("utf-8"))
                return
                
            ticker_symbol = ticker_symbol.upper().strip()
            ticker_path = os.path.join(data_dir, f"{ticker_symbol}.json")
            
            if os.path.exists(ticker_path):
                with open(ticker_path, "r", encoding="utf-8") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                self.wfile.write(json.dumps({"error": f"Data for ticker '{ticker_symbol}' not found. Run the pipeline locally."}).encode("utf-8"))
                
        else:
            self.wfile.write(json.dumps({
                "message": "Welcome to the SEC Filing NLP Alpha Engine API",
                "endpoints": {
                    "/api/tickers": "Get general summary stats and list of analyzed tickers",
                    "/api/ticker?symbol={TICKER}": "Get timeline of sentiment signals and returns for a specific ticker"
                }
            }).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

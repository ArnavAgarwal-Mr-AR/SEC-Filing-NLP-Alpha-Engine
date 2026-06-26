import re
from bs4 import BeautifulSoup
from pathlib import Path
from backend.config import PROCESSED_DIR

def clean_html(html_content: str) -> str:
    """
    Strips HTML tags, styles, scripts, and tables (since table numbers interfere with text metrics).
    Collapses whitespace into single spaces.
    """
    soup = BeautifulSoup(html_content, "lxml")
    
    # Remove tags that do not contain readable text or contain irrelevant tables
    for tag in soup(["script", "style", "table", "noscript", "iframe"]):
        tag.decompose()
        
    text = soup.get_text(separator=" ")
    
    # Replace multiple whitespaces and newlines with a single space
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def extract_section_text(clean_text: str, form_type: str, section: str) -> str:
    """
    Attempts to extract MD&A or Risk Factors from a cleaned filing text.
    Handles differences between 10-K and 10-Q structures with regex fallbacks.
    """
    form_type = form_type.upper()
    section = section.lower()
    
    patterns = []
    
    if section == "risk_factors":
        if "10-K" in form_type:
            # 10-K: Item 1A (Risk Factors) -> Item 1B (Unresolved Staff Comments) or Item 2 (Properties)
            patterns = [
                r"item\s+1a[.\s:]+risk\s+factors(.*?)(?:item\s+1b|item\s+2\b)",
                r"item\s+1a[.\s:]+risk\s+factors(.*?)$" # End of document fallback
            ]
        elif "10-Q" in form_type:
            # 10-Q Part II: Item 1A (Risk Factors) -> Item 2 (Unregistered Sales) or Item 3 (Defaults)
            patterns = [
                r"part\s+ii.*?item\s+1a[.\s:]+risk\s+factors(.*?)(?:item\s+2\b|item\s+3\b|part\s+i)",
                r"item\s+1a[.\s:]+risk\s+factors(.*?)(?:item\s+2\b|item\s+3\b)",
                r"item\s+1a[.\s:]+risk\s+factors(.*?)$"
            ]
    elif section == "mda":
        if "10-K" in form_type:
            # 10-K: Item 7 (MD&A) -> Item 7A (Quantitative/Qualitative Disclosures about Market Risk) or Item 8 (Financial Statements)
            patterns = [
                r"item\s+7[.\s:]+management\s*[\u2019']\s*s\s+discussion\s+and\s+analysis(.*?)(?:item\s+7a|item\s+8\b)",
                r"item\s+7[.\s:]+management\s+s\s+discussion(.*?)(?:item\s+7a|item\s+8\b)",
                r"item\s+7[.\s:]+management.*?discussion(.*?)(?:item\s+7a|item\s+8\b)",
                r"item\s+7[.\s:]+management.*?discussion(.*?)$"
            ]
        elif "10-Q" in form_type:
            # 10-Q Part I: Item 2 (MD&A) -> Item 3 (Quantitative/Qualitative Disclosures) or Item 4 (Controls)
            patterns = [
                r"part\s+i.*?item\s+2[.\s:]+management\s*[\u2019']\s*s\s+discussion\s+and\s+analysis(.*?)(?:item\s+3\b|item\s+4\b|part\s+ii)",
                r"item\s+2[.\s:]+management\s*[\u2019']\s*s\s+discussion(.*?)(?:item\s+3\b|item\s+4\b)",
                r"item\s+2[.\s:]+management.*?discussion(.*?)(?:item\s+3\b|item\s+4\b)",
                r"item\s+2[.\s:]+management.*?discussion(.*?)$"
            ]
            
    for pattern in patterns:
        match = re.search(pattern, clean_text, re.IGNORECASE | re.DOTALL)
        if match:
            extracted = match.group(1).strip()
            # Ensure we didn't just match a Table of Contents entry (TOC entries are usually very short)
            if len(extracted) > 1000:
                return extracted
                
    # Return empty string if no valid section text was extracted
    return ""

def process_filing_file(raw_filepath: Path, ticker: str, accession: str, form_type: str) -> dict:
    """
    Reads a cached raw HTML filing, cleans it, extracts Item 1A and Item 7,
    saves the cleaned text, and returns the lengths/status.
    """
    ticker = ticker.upper()
    ticker_dir = PROCESSED_DIR / ticker
    ticker_dir.mkdir(parents=True, exist_ok=True)
    
    with open(raw_filepath, "r", encoding="utf-8", errors="ignore") as f:
        html_content = f.read()
        
    clean_text = clean_html(html_content)
    
    # Extract Risk Factors (Item 1A) and MD&A (Item 7)
    risk_text = extract_section_text(clean_text, form_type, "risk_factors")
    mda_text = extract_section_text(clean_text, form_type, "mda")
    
    # Save extracted sections
    risk_path = ticker_dir / f"{accession}_risk_factors.txt"
    mda_path = ticker_dir / f"{accession}_mda.txt"
    
    with open(risk_path, "w", encoding="utf-8") as f:
        f.write(risk_text)
        
    with open(mda_path, "w", encoding="utf-8") as f:
        f.write(mda_text)
        
    return {
        "accession": accession,
        "form": form_type,
        "clean_text_len": len(clean_text),
        "risk_factors_len": len(risk_text),
        "mda_len": len(mda_text),
        "risk_factors_path": str(risk_path),
        "mda_path": str(mda_path)
    }

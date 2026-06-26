import unittest
import json
import tempfile
import shutil
from pathlib import Path
import pandas as pd
import numpy as np

# Adjust path to find backend modules
import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from backend.data_pipeline.parser import clean_html, extract_section_text
from backend.nlp_engine.scorers import LoughranMcDonaldScorer
from backend.signals.generator import compute_time_series_deltas, generate_signals

class TestPipeline(unittest.TestCase):
    
    def setUp(self):
        # Create temp folder for test files
        self.test_dir = Path(tempfile.mkdtemp())
        
        # Create mock dictionary subset
        self.mock_dict_path = self.test_dir / "lm_subset_test.json"
        mock_dict = {
            "positive": ["growth", "profitable", "benefit", "improve"],
            "negative": ["loss", "failure", "risk", "decline"],
            "uncertainty": ["may", "might", "could", "perhaps"]
        }
        with open(self.mock_dict_path, "w", encoding="utf-8") as f:
            json.dump(mock_dict, f)

    def tearDown(self):
        # Clean up temp folder
        shutil.rmtree(self.test_dir)

    def test_clean_html(self):
        html = """
        <html>
            <head><style>body {color: red;}</style></head>
            <body>
                <script>alert("hello");</script>
                <h1>Heading Text</h1>
                <table><tr><td>12.5%</td><td>Numbers to strip</td></tr></table>
                <p>Hello, this is a test filing document.</p>
            </body>
        </html>
        """
        cleaned = clean_html(html)
        # Heading and paragraph should be present
        self.assertIn("Heading Text", cleaned)
        self.assertIn("Hello, this is a test filing document", cleaned)
        # Style, script and table should be stripped
        self.assertNotIn("color: red", cleaned)
        self.assertNotIn("alert", cleaned)
        self.assertNotIn("12.5%", cleaned)

    def test_extract_section_text(self):
        clean_text = "Some intro text... Item 1A. Risk Factors " + ("Here is a list of risk factors for the company. " * 30) + " Item 1B. Unresolved Staff Comments... more text."
        extracted = extract_section_text(clean_text, "10-K", "risk_factors")
        self.assertIn("Here is a list of risk factors", extracted)
        self.assertNotIn("Some intro text", extracted)
        
        # Test short section rejection (Table of Contents entry detection)
        short_text = "Some text... Item 1A. Risk Factors (TOC) Item 1B. Properties"
        extracted_short = extract_section_text(short_text, "10-K", "risk_factors")
        self.assertEqual(extracted_short, "")

    def test_loughran_mcdonald_scorer(self):
        scorer = LoughranMcDonaldScorer(dict_path=self.mock_dict_path)
        
        # Normal positive
        metrics = scorer.score("The company experienced growth and was highly profitable.")
        self.assertEqual(metrics["lm_pos_words"], 2)
        self.assertEqual(metrics["lm_neg_words"], 0)
        self.assertEqual(metrics["lm_unc_words"], 0)
        
        # Normal negative + uncertainty
        metrics2 = scorer.score("There is a significant risk of decline. We might face failure.")
        self.assertEqual(metrics2["lm_pos_words"], 0)
        self.assertEqual(metrics2["lm_neg_words"], 3)  # risk, decline, failure
        self.assertEqual(metrics2["lm_unc_words"], 1)  # might
        
        # Negation handling
        metrics_negated = scorer.score("We did not experience growth and saw no improve.")
        # "growth" is preceded by "not" (index -2) -> counted as negative
        # "improve" is preceded by "no" (index -2) -> counted as negative
        self.assertEqual(metrics_negated["lm_pos_words"], 0)
        self.assertEqual(metrics_negated["lm_neg_words"], 2)

    def test_generate_signals(self):
        # Create mock pandas dataframe
        data = {
            "ticker": ["AAPL", "AAPL", "AAPL", "AAPL", "AAPL"],
            "filing_date": ["2023-01-01", "2023-04-01", "2023-07-01", "2023-10-01", "2024-01-01"],
            "lm_sentiment_score": [0.1, 0.12, 0.15, 0.11, 0.22],
            "finbert_sentiment_score": [0.2, 0.22, 0.25, 0.21, 0.35],
            "lm_uncertainty_score": [0.05, 0.04, 0.03, 0.05, 0.02],
            "fog_index": [15.0, 15.2, 15.1, 15.5, 14.8],
            "risk_word_count": [5000, 5200, 5100, 5300, 4800]
        }
        df = pd.DataFrame(data)
        
        # Run generator
        df_signals = generate_signals(df)
        
        self.assertIn("composite_signal", df_signals.columns)
        self.assertIn("sentiment_yoy_change", df_signals.columns)
        
        # Row 4 (index 4) represents 2024-01-01, which is 4 quarters after 2023-01-01
        # Sentiment score changed from 0.1 to 0.22 -> YoY change = 0.12
        self.assertAlmostEqual(df_signals.iloc[4]["sentiment_yoy_change"], 0.12)
        
        # Uncertainty changed from 0.05 to 0.02 -> YoY change = -0.03
        self.assertAlmostEqual(df_signals.iloc[4]["uncertainty_change"], -0.03)

if __name__ == "__main__":
    unittest.main()

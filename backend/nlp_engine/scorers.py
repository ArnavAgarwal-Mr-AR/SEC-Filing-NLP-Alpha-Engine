import json
import re
import warnings
from pathlib import Path
from backend.config import LM_SUBSET_PATH, FINBERT_MODEL_NAME, FINBERT_CHUNK_SIZE, FINBERT_MAX_CHUNKS

# Silence warnings from transformers/torch if possible
warnings.filterwarnings("ignore")

class LoughranMcDonaldScorer:
    """
    Computes sentiment and uncertainty scores using a preprocessed Loughran-McDonald subset.
    Includes basic negation handling.
    """
    def __init__(self, dict_path=LM_SUBSET_PATH):
        self.dict_path = Path(dict_path)
        self.positive_words = set()
        self.negative_words = set()
        self.uncertainty_words = set()
        
        self.negation_words = {
            "no", "not", "never", "neither", "nor", "none", "without",
            "cannot", "cant", "couldnt", "didnt", "doesnt", "dont",
            "isnt", "wasnt", "werent", "wont", "wouldnt", "rarely", "seldom"
        }
        
        self._load_dictionary()

    def _load_dictionary(self):
        if not self.dict_path.exists():
            raise FileNotFoundError(f"Loughran-McDonald subset dictionary not found at {self.dict_path}")
            
        with open(self.dict_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        self.positive_words = set(w.lower() for w in data.get("positive", []))
        self.negative_words = set(w.lower() for w in data.get("negative", []))
        self.uncertainty_words = set(w.lower() for w in data.get("uncertainty", []))

    def score(self, text: str) -> dict:
        """
        Tokenizes text and calculates sentiment scores.
        If a positive word is preceded by a negation word (within 3 tokens), it is counted as negative.
        Tracks word frequencies to report top contributing terms.
        """
        if not text.strip():
            return {
                "lm_sentiment_score": 0.0,
                "lm_uncertainty_score": 0.0,
                "lm_pos_words": 0,
                "lm_neg_words": 0,
                "lm_unc_words": 0,
                "total_words": 0,
                "top_positive": [],
                "top_negative": [],
                "top_uncertainty": []
            }
            
        from collections import Counter
        words = re.findall(r"\b[a-z']+\b", text.lower())
        total_words = len(words)
        
        pos_words_counter = Counter()
        neg_words_counter = Counter()
        unc_words_counter = Counter()
        
        pos_count = 0
        neg_count = 0
        unc_count = 0
        
        for i, word in enumerate(words):
            # Check uncertainty
            if word in self.uncertainty_words:
                unc_count += 1
                unc_words_counter[word] += 1
                
            # Check positive (with negation checking)
            if word in self.positive_words:
                # Look back up to 3 tokens for negation
                is_negated = False
                start_idx = max(0, i - 3)
                for prev_word in words[start_idx:i]:
                    if prev_word in self.negation_words:
                        is_negated = True
                        break
                
                if is_negated:
                    neg_count += 1  # Flip positive to negative
                    neg_words_counter[f"not {word}"] += 1
                else:
                    pos_count += 1
                    pos_words_counter[word] += 1
                    
            # Check negative
            elif word in self.negative_words:
                neg_count += 1
                neg_words_counter[word] += 1
                
        # Calculate rates
        n = total_words or 1
        return {
            "lm_sentiment_score": (pos_count - neg_count) / n,
            "lm_uncertainty_score": unc_count / n,
            "lm_pos_words": pos_count,
            "lm_neg_words": neg_count,
            "lm_unc_words": unc_count,
            "total_words": total_words,
            "top_positive": pos_words_counter.most_common(5),
            "top_negative": neg_words_counter.most_common(5),
            "top_uncertainty": unc_words_counter.most_common(5)
        }

class ReadabilityScorer:
    """
    Computes structural readability metrics using textstat.
    """
    def __init__(self):
        # textstat is imported dynamically to avoid slow startup
        import textstat
        self.ts = textstat

    def score(self, text: str) -> dict:
        if not text.strip() or len(text.split()) < 10:
            return {
                "fog_index": 0.0,
                "flesch_reading_ease": 100.0
            }
            
        return {
            "fog_index": self.ts.gunning_fog(text),
            "flesch_reading_ease": self.ts.flesch_reading_ease(text)
        }

class FinBERTScorer:
    """
    Computes context-aware financial sentiment scores using the FinBERT transformer model.
    Loads models lazily to minimize startup overhead.
    """
    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.device = None

    def _init_model(self):
        if self.model is not None:
            return
            
        import torch
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained(FINBERT_MODEL_NAME)
        self.model = AutoModelForSequenceClassification.from_pretrained(FINBERT_MODEL_NAME).to(self.device)
        self.model.eval()

    def score(self, text: str) -> float:
        """
        Chunks text, runs them through FinBERT, and returns the average sentiment score:
        Score = Probability(Positive) - Probability(Negative).
        """
        if not text.strip():
            return 0.0
            
        # Initialize torch and model lazily
        self._init_model()
        import torch
        
        # Split text into sentences using simple regex
        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks = []
        current_chunk = []
        current_word_count = 0
        
        for sentence in sentences:
            sentence_words = len(sentence.split())
            if current_word_count + sentence_words < 350:  # Stay safe below 512 token limit
                current_chunk.append(sentence)
                current_word_count += sentence_words
            else:
                if current_chunk:
                    chunks.append(" ".join(current_chunk))
                current_chunk = [sentence]
                current_word_count = sentence_words
                
        if current_chunk:
            chunks.append(" ".join(current_chunk))
            
        # Cap chunks to manage execution time
        chunks = chunks[:FINBERT_MAX_CHUNKS]
        
        if not chunks:
            return 0.0
            
        scores = []
        for chunk in chunks:
            inputs = self.tokenizer(chunk, return_tensors="pt", truncation=True, max_length=FINBERT_CHUNK_SIZE)
            # Move to device (GPU or CPU)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                logits = self.model(**inputs).logits
                
            probs = torch.softmax(logits, dim=1)[0]
            # FinBERT labels mapping: Index 0 is Positive, Index 1 is Negative, Index 2 is Neutral
            pos_prob = probs[0].item()
            neg_prob = probs[1].item()
            
            scores.append(pos_prob - neg_prob)
            
        return sum(scores) / len(scores) if scores else 0.0

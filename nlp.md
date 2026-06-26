## The NLP Layer, In Depth

This is genuinely the hardest and most important part of the system, so let me break down *why* each piece exists, what actually works on SEC filings (which are weird, dense legal documents — not tweets or news headlines), and where the real engineering tradeoffs are.

### The core problem: generic NLP sentiment tools fail badly on filings

If you ran a standard sentiment model (VADER, generic BERT sentiment, TextBlob) on a 10-K, it would call almost everything negative. Words like "litigation," "loss," "liability," "claims," and "default" appear constantly in routine legal boilerplate — they're not actually signaling bad news, they're just how risk sections are legally required to be written. This is the exact finding that motivated the Loughran-McDonald paper in 2011: generic dictionaries misclassify ~75% of "negative" words in 10-Ks as false positives.

So the NLP design has to solve three distinct problems, and I'll go through each with the actual technique:

---

### 1. Lexicon-based sentiment (Loughran-McDonald) — the baseline, finance-specific

This isn't a model at all — it's a word list built specifically from analyzing thousands of actual 10-Ks, classifying words into categories: Positive, Negative, Uncertainty, Litigious, Constraining, Strong/Weak Modal.

```python
def lm_sentiment(text: str) -> dict:
    words = re.findall(r"\b[a-z]+\b", text.lower())
    n = len(words) or 1
    pos = sum(1 for w in words if w in positive_words)
    neg = sum(1 for w in words if w in negative_words)
    unc = sum(1 for w in words if w in uncertainty_words)
    return {
        "lm_sentiment_score": (pos - neg) / n,
        "lm_uncertainty_score": unc / n,
    }
```

**Why this is the foundation, not just a fallback:** it's deterministic, explainable (you can show *exactly* which words drove the score), fast (no GPU, no inference time), and it's the academic standard — every published textual-alpha paper benchmarks against it. The "Uncertainty," "Litigious," and "Modal" categories matter as much as Positive/Negative — a filing that suddenly uses more hedging words ("may," "could," "possibly") without becoming explicitly "negative" is often a stronger signal than raw polarity.

**Where it breaks down:** it's bag-of-words — no context, no negation handling ("we do not expect a decline" scores as negative because of "decline," even though the sentence is reassuring). It also can't catch tone shifts that don't use dictionary words at all (e.g., a management team that goes from "we are confident" to "we believe" — both fine words, but a meaningful confidence downgrade).

### 2. Transformer-based sentiment (FinBERT) — context-aware layer

FinBERT is BERT further pretrained on financial text (analyst reports, earnings calls) then fine-tuned for sentiment. Critically, it handles negation and context that bag-of-words can't.

```python
def finbert_sentiment(text: str, chunk_size=400) -> float:
    # filings are too long for one pass (BERT max = 512 tokens),
    # so we chunk and average
    ...
    probs = torch.softmax(logits, dim=1)[0]  # [positive, negative, neutral]
    scores.append(probs[0].item() - probs[1].item())
```

**The real engineering challenge here isn't the model, it's the chunking.** A 10-K's MD&A section might be 8,000+ words; FinBERT's context window is 512 tokens (~380 words). So you have to:
- Split into overlapping or sentence-bounded chunks
- Score each chunk independently
- Aggregate (mean, or weighted by chunk length) back to a document-level score

This means FinBERT gives you something LM dictionary scoring can't: **sentence-level resolution**. You can find *which specific sentences* are most negative/positive, not just a single document score — this is what powers a good "filing diff" or "highlight the concerning sentence" UI feature.

**Tradeoff:** It's expensive (you're running a transformer over every chunk of every filing — for 5 years × 20 filings × ~20 chunks each = manageable, but for a multi-ticker cross-sectional version this adds up and you'd want batching + GPU). It's also still occasionally fooled by financial jargon it wasn't trained on (obscure GAAP terminology, company-specific acronyms).

### 3. Structural/linguistic features — not sentiment at all, but often more predictive

This is the part people underrate. Some of the strongest documented signals in the textual-alpha literature aren't "is this positive or negative" — they're about *how* something is written:

```python
def readability_features(text: str) -> dict:
    return {
        "fog_index": textstat.gunning_fog(text),       # complexity/obfuscation proxy
        "flesch_score": textstat.flesch_reading_ease(text),
    }
```

- **Readability/Fog Index** — there's published research (Li, 2008) showing filings that get *harder to read* often correlate with worse subsequent earnings — a "obfuscation" signal, i.e., management writing more confusingly when there's something to bury.
- **Document length change** — Risk Factors sections that grow substantially YoY (even with neutral language) often precede negative events, because legal teams add new risk disclosures defensively.
- **Modal word ratio** (strong modal: "will," "must," "clearly" vs. weak modal: "may," "might," "could") — a shift from strong to weak modal language is a classic hedging signal that predates explicit bad news.

These features are cheap to compute, highly interpretable, and in my view should be weighted *equally* with sentiment scores, not treated as an afterthought.

### 4. Change-detection — where the actual signal lives

None of the three layers above matter much as an absolute score — "AAPL's 10-K has a sentiment score of 0.34" tells you almost nothing in isolation, because we don't know AAPL's natural baseline writing style. What matters is **delta**:

```python
df["sentiment_yoy_change"] = df["lm_sentiment_score"].diff(4)
df["risk_wordcount_yoy_pct"] = df["risk_section_wordcount"].pct_change(4)
df["uncertainty_change"] = df["lm_uncertainty_score"].diff()
```

This is why I compare YoY (same quarter, prior year) rather than QoQ — it controls for seasonal filing patterns and each company's idiosyncratic writing style, isolating the *change in tone* as the feature, not the tone itself. This is the same logic as earnings surprise models comparing to consensus rather than absolute EPS.

---

### How the three layers combine into one signal

```python
def build_composite_signal(df):
    for col in ["sentiment_yoy_change", "risk_wordcount_yoy_pct", "uncertainty_change"]:
        df[f"{col}_z"] = (df[col] - df[col].mean()) / df[col].std()
    df["composite_signal"] = (
        df["sentiment_yoy_change_z"]
        - df["risk_wordcount_yoy_pct_z"]
        - df["uncertainty_change_z"]
    )
    return df
```

I'd actually extend this to include FinBERT and the LM dictionary as *separate* inputs rather than collapsing them into one "sentiment" number too early — that lets you measure later which layer actually carries predictive power (you might find LM dictionary changes correlate with returns better than FinBERT, or vice versa, which is itself a useful research finding worth reporting).

---

### A design decision worth flagging explicitly

You could go further and fine-tune your own classifier (e.g., train a model where the label is "did this filing precede a >X% drawdown" rather than generic positive/negative) — that's closer to what a real quant shop would eventually do. I deliberately didn't lead with that because:

1. You need a large multi-ticker, multi-year labeled dataset for it to generalize at all
2. It's a black box compared to LM/FinBERT — harder to debug *why* a signal fired
3. It's the natural "v2" once the v1 pipeline (lexicon + transformer + structural deltas) proves there's *any* signal worth refining

**My recommendation on sequencing:** build LM dictionary scoring first (gets the whole pipeline working end-to-end fast, fully explainable), layer in FinBERT for sentence-level resolution second, add structural/readability features in parallel (they're nearly free), and treat custom fine-tuning as a stretch goal only if the backtest shows the simpler signals have real IC.
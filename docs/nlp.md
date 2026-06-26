# Natural Language Processing Layer

This document details the NLP engineering design, challenges, methodologies, and choices made for the **SEC Filing NLP Alpha Engine**.

---

## 1. The Core Problem: Filings are Non-Standard Text
Generic NLP models (e.g., standard VADER, TextBlob, or general-purpose BERT) fail when applied to SEC corporate filings (10-K, 10-Q).
*   **The False Positive Issue:** Words like *loss*, *default*, *liability*, *litigation*, and *claims* appear constantly in routine legal disclosures. Generic classifiers flag these as strongly negative, misclassifying ~75% of negative terms (Loughran-McDonald, 2011).
*   **Boilerplate Dilution:** SEC filings are filled with mandatory legal boilerplate. Tone shifts are subtle and occur within highly structured disclosures.
*   **Readability obfuscation:** Complex sentence construction and GAAP jargon are often used defensively by management to bury poor performance.

To extract predictive textual alpha, the engine uses a **three-tier NLP feature design**:

---

## 2. Tier 1: Lexicon-Based Sentiment (Loughran-McDonald)
The foundational baseline uses the finance-specific **Loughran-McDonald (LM) Dictionary**.

### Why it is utilized:
*   **Explainable & Deterministic:** You can see exactly which tokens drove a score.
*   **Zero Compute Overhead:** Performs token-matching without neural network inference or GPU requirements.
*   **Academic Standard:** The benchmark for empirical asset pricing research.

### Limitations & Overcoming Them:
*   *Bag-of-Words Limitation:* It cannot capture context or word ordering.
*   *Negation:* Fails on negated expressions (e.g., *"not a failure"*).
*   *Negation Handling Solution:* We implement a 3-token look-back check. When a positive word is detected, the engine scans the previous 3 words. If a negation word (e.g., *not*, *no*, *never*) is present, the positive word is counted as negative.

---

## 3. Tier 2: Transformer-Based Sentiment (FinBERT)
To handle context, negation, and complex financial grammar, the engine layers in **FinBERT** (`ProsusAI/finbert`), a BERT-based model further pretrained on financial texts.

### Key Implementations:
*   **Overcoming the 512-Token Window:** SEC filings are too long to process in a single pass. The pipeline splits text into sentence groups (boundary split), packages them into chunks of under 350 words, runs inference, and averages logits across chunks.
*   **Local Caching:** Evaluating neural networks on CPU is slow. We save computed results to `backend/data/finbert_cache.json`. Subsequent runs complete instantly by reading from this cache.
*   **Resolution:** FinBERT gives sentence-level resolution, allowing the frontend to locate and visualize the exact sentences carrying strong positive or negative sentiments.

---

## 4. Tier 3: Structural & Readability Metrics
Textual alpha is not just about positive/negative tone; **how** things are written is highly predictive.

### Evaluated Metrics:
*   **Readability (Gunning Fog Index):** Measures text complexity. Research (Li, 2008) shows that when readability worsens (Fog Index increases), subsequent earnings are often poorer. This is the **obfuscation signal**.
*   **Document Length Changes:** Increases in the length of Item 1A (Risk Factors) YoY often precede adverse events because legal departments proactively add defensive disclosures before bad news becomes public.
*   **Uncertainty/Hedging Ratio:** Captures the frequency of uncertainty terms (e.g., *may*, *could*, *pending*, *perhaps*).

---

## 5. Signal Construction (YoY Deltas)
Absolute sentiment scores (e.g., *"sentiment is 0.22"*) are noisy due to company-specific boilerplate profiles. The true alpha signal lies in the **Year-over-Year Delta**:
$$\Delta \text{Sentiment}_{t} = \text{Sentiment}_{t} - \text{Sentiment}_{t-4}$$

By comparing the current quarter against the same quarter in the previous year, we:
1.  Control for seasonal filing disclosures.
2.  Control for each company's specific boilerplate layout.
3.  Isolate the actual shift in management tone.

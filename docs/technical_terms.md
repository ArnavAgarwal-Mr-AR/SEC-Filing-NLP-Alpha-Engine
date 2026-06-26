# Technical Terms and Specifications

This document outlines the core technical terms, specifications, algorithms, and models integrated into the **SEC Filing NLP Alpha Engine**.

---

## 1. Loughran-McDonald Lexicon Sentiment
The baseline financial sentiment engine is based on the **Loughran & McDonald Master Dictionary (2011)**. Unlike general-purpose sentiment lists (like VADER or TextBlob) which misclassify ~75% of "negative" words in legal filings (e.g., words like *liability*, *loss*, *default*, and *litigation* appear as routine legal disclosures rather than indicators of financial distress), the LM dictionary classifies words specifically based on their contextual meaning in financial text.

### Categorized Word Classes
*   **Positive:** Indicates optimism, growth, progress, or profitability (e.g., *profitable*, *improve*, *grow*).
*   **Negative:** Indicates underperformance, distress, or setbacks (e.g., *loss*, *decline*, *failure*).
*   **Uncertainty:** Indicates hedging, doubt, or lack of predictability (e.g., *may*, *might*, *could*, *speculate*).

### Negation Handling Algorithm
Financial disclosures often contain qualified statements (e.g., *"we do not expect a loss"* or *"no material decline"*). A simple bag-of-words count would misclassify these as negative due to *loss* or *decline*.
We implement a **3-token look-back negation check**:
1.  Tokens are extracted using the pattern `\b[a-z']+\b`.
2.  If a word matches a Positive term, the engine scans the preceding 3 tokens.
3.  If any of those preceding tokens is a negation word (e.g., *no*, *not*, *never*, *without*, *cannot*, *dont*), the sentiment is flipped:
    $$\text{Negative Count} = \text{Negative Count} + 1$$
    $$\text{Positive Count} = \text{Positive Count} \text{ (unchanged)}$$
4.  Uncertainty terms are counted directly.
5.  Scores are normalized:
    $$\text{LM Sentiment Score} = \frac{\text{Positive Count} - \text{Negative Count}}{\text{Total Words}}$$
    $$\text{LM Uncertainty Score} = \frac{\text{Uncertainty Count}}{\text{Total Words}}$$

---

## 2. FinBERT Sentiment
**FinBERT** is a domain-specific BERT (Bidirectional Encoder Representations from Transformers) model further pretrained on financial texts (analyst reports, earnings call transcripts, news) and fine-tuned for sentiment analysis.

### Model Specs
*   **Source Model:** `ProsusAI/finbert` (Hugging Face)
*   **Vocabulary Size:** ~30,522 tokens
*   **Parameters:** ~110 million

### Context Window & Sentence-Level Chunking
BERT has a maximum input length of **512 tokens** (roughly 350-400 words). Because SEC filings contain sections containing tens of thousands of words, feeding them into BERT directly causes truncation.
We resolve this by:
1.  Splitting the text into sentences using sentence-boundary punctuation: `(?<=[.!?])\s+`.
2.  Grouping sentences into chunks keeping word counts under **350 words** to allow room for tokenizer special characters (`[CLS]`, `[SEP]`).
3.  Capping the evaluations to the first **50 chunks** (~17,500 words) to manage local processing time.
4.  Running inference on each chunk to obtain softmax logits for three classes:
    $$P_{\text{pos}}, P_{\text{neg}}, P_{\text{neutral}}$$
5.  Calculating the chunk score:
    $$\text{Score}_{\text{chunk}} = P_{\text{pos}} - P_{\text{neg}}$$
6.  Averaging scores across all chunks to produce the document score:
    $$\text{FinBERT Score} = \frac{1}{N} \sum_{i=1}^{N} \text{Score}_{\text{chunk}, i}$$

---

## 3. Readability & Complexity (Gunning Fog Index)
The **Gunning Fog Index** estimates the years of formal education needed to understand a piece of writing on the first reading. Higher scores represent higher complexity (obfuscation), which research correlates with management attempting to bury negative developments (Li, 2008).

### Calculation Formula
$$\text{Fog Index} = 0.4 \times \left( \frac{\text{Total Words}}{\text{Total Sentences}} + 100 \times \frac{\text{Complex Words}}{\text{Total Words}} \right)$$

*   **Complex Words:** Words containing 3 or more syllables (excluding common suffixes, proper nouns, and compound words).
*   **Flesch Reading Ease:** A companion metric scored from 0 to 100, where lower scores indicate harder-to-read materials:
    $$\text{Ease} = 206.835 - 1.015 \times \left( \frac{\text{Total Words}}{\text{Total Sentences}} \right) - 84.6 \times \left( \frac{\text{Total Syllables}}{\text{Total Words}} \right)$$

---

## 4. Longest Common Subsequence (LCS) Text Diff
The dashboard compares consecutive filings to identify what risk factors or explanations were modified. 

To compare texts efficiently, we implement a **Sentence-Level Longest Common Subsequence (LCS)** algorithm in React:
1.  Both current and prior texts are split into sentences using punctuation boundaries.
2.  A Dynamic Programming table of size $(M+1) \times (N+1)$ is built, where $M$ is the number of prior sentences and $N$ is the number of current sentences.
3.  If sentence $S_{\text{old}, i} == S_{\text{new}, j}$, the DP value is updated:
    $$\text{DP}[i][j] = \text{DP}[i-1][j-1] + 1$$
4.  Otherwise:
    $$\text{DP}[i][j] = \max(\text{DP}[i-1][j], \text{DP}[i][j-1])$$
5.  A traceback is run to build the diff array, labeling sentences as `unchanged`, `added`, or `removed`.
6.  Adjacent block types are grouped together on the fly to prevent React from rendering too many DOM nodes.

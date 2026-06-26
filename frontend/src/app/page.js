'use client';

import React, { useState, useEffect } from 'react';

const FWD_RETURN_HORIZONS = [1, 5, 21, 63];

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [tickerData, setTickerData] = useState([]);
  const [activeFilingIndex, setActiveFilingIndex] = useState(0);
  
  // Diff viewer state
  const [activeSection, setActiveSection] = useState('risk_factors'); // risk_factors or mda
  const [currentText, setCurrentText] = useState('');
  const [priorText, setPriorText] = useState('');
  const [diffResult, setDiffResult] = useState([]);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  
  // Loughran-McDonald tab state: 'profile', 'historical', 'explainer'
  const [lmTab, setLmTab] = useState('profile');
  const [lmHoveredNode, setLmHoveredNode] = useState(null);

  // Main sentiment chart type: 'trend' (line chart) or 'correlation' (grouped bar chart)
  const [chartType, setChartType] = useState('trend');
  const [chartHoveredIdx, setChartHoveredIdx] = useState(null);

  // Load summary.json on mount
  useEffect(() => {
    fetch('/data/summary.json')
      .then((res) => {
        if (!res.ok) throw new Error('Summary data not found');
        return res.json();
      })
      .then((data) => {
        setSummary(data);
        if (data.tickers && data.tickers.length > 0) {
          setSelectedTicker(data.tickers[0]);
        }
      })
      .catch((err) => {
        console.error('Error fetching summary:', err);
      });
  }, []);

  // Load selected ticker data
  useEffect(() => {
    if (!selectedTicker) return;
    setIsLoadingData(true);
    fetch(`/data/${selectedTicker}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Data for ticker ${selectedTicker} not found`);
        return res.json();
      })
      .then((data) => {
        // Sort from oldest to newest for timeline/deltas, but we can reverse it for the UI dropdown
        const sortedData = data.sort((a, b) => new Date(a.filing_date) - new Date(b.filing_date));
        setTickerData(sortedData);
        // Default to the most recent filing (last in sorted list)
        setActiveFilingIndex(sortedData.length - 1);
        setIsLoadingData(false);
      })
      .catch((err) => {
        console.error(err);
        setTickerData([]);
        setIsLoadingData(false);
      });
  }, [selectedTicker]);

  // Load texts for diffing when active filing or section changes
  useEffect(() => {
    if (tickerData.length === 0 || activeFilingIndex < 0) return;
    
    const currentFiling = tickerData[activeFilingIndex];
    if (!currentFiling) return;
    
    setIsLoadingDiff(true);
    setDiffResult([]);
    
    // Fetch current filing section text
    const fetchCurrent = fetch(`/data/sections/${selectedTicker}/${currentFiling.accession}_${activeSection}.txt`)
      .then((res) => (res.ok ? res.text() : ''))
      .catch(() => '');
      
    // Fetch prior filing section text (if available)
    let fetchPrior = Promise.resolve('');
    if (activeFilingIndex > 0) {
      const priorFiling = tickerData[activeFilingIndex - 1];
      fetchPrior = fetch(`/data/sections/${selectedTicker}/${priorFiling.accession}_${activeSection}.txt`)
        .then((res) => (res.ok ? res.text() : ''))
        .catch(() => '');
    }
    
    Promise.all([fetchCurrent, fetchPrior]).then(([curr, prev]) => {
      setCurrentText(curr);
      setPriorText(prev);
      
      // Calculate diff
      if (!curr) {
        setDiffResult([{ type: 'info', text: 'No text extracted for this section.' }]);
      } else if (!prev) {
        setDiffResult([{ type: 'added', text: curr }]);
      } else {
        // Fast sentence-level diff
        const diff = calculateSentenceDiff(prev, curr);
        setDiffResult(diff);
      }
      setIsLoadingDiff(false);
    });
  }, [tickerData, activeFilingIndex, activeSection, selectedTicker]);

  // Fast sentence-level diff algorithm using LCS-inspired mapping
  const calculateSentenceDiff = (oldText, newText) => {
    // Clean text helper
    const splitSentences = (text) => {
      return text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);
    };

    const oldSentences = splitSentences(oldText);
    const newSentences = splitSentences(newText);
    
    // Standard LCS for sentences
    const m = oldSentences.length;
    const n = newSentences.length;
    
    // Create LCS DP table
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));
      
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldSentences[i - 1] === newSentences[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // Trace back to build diff path
    let i = m;
    let j = n;
    const diff = [];
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldSentences[i - 1] === newSentences[j - 1]) {
        diff.unshift({ type: 'unchanged', text: oldSentences[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.unshift({ type: 'added', text: newSentences[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        diff.unshift({ type: 'removed', text: oldSentences[i - 1] });
        i--;
      }
    }
    
    // Group adjacent elements to reduce DOM nodes
    const groupedDiff = [];
    let currentGroup = null;
    
    for (const item of diff) {
      if (currentGroup && currentGroup.type === item.type) {
        currentGroup.text += ' ' + item.text;
      } else {
        if (currentGroup) {
          groupedDiff.push(currentGroup);
        }
        currentGroup = { ...item };
      }
    }
    if (currentGroup) {
      groupedDiff.push(currentGroup);
    }
    
    return groupedDiff;
  };

  const getSignalBadge = (score) => {
    if (score > 0.5) return <span className="badge badge-positive">Strong Bullish Shift</span>;
    if (score > 0.1) return <span className="badge badge-positive">Moderate Bullish</span>;
    if (score < -0.5) return <span className="badge badge-negative">Strong Bearish Shift</span>;
    if (score < -0.1) return <span className="badge badge-negative">Moderate Bearish</span>;
    return <span className="badge badge-neutral">Stable Tone</span>;
  };

  const getHorizonLabel = (h) => {
    switch(h) {
      case 1: return '1d Fwd';
      case 5: return '5d Fwd (1w)';
      case 21: return '21d Fwd (1m)';
      case 63: return '63d Fwd (3m)';
      default: return `${h}d`;
    }
  };

  const currentFiling = tickerData[activeFilingIndex] || null;

  // Render setup pipeline placeholder if summary is not available
  if (!summary) {
    return (
      <div style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }} className="animate-fade-in">
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '20px', fontWeight: '800' }}>SEC NLP Alpha Engine</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '30px', fontSize: '1.1rem', lineHeight: '1.6' }}>
            Welcome! The backend pipeline has not been executed yet, or the summary data is missing. Run the local backend script to ingest filings, run NLP analysis, and generate signal outputs.
          </p>
          
          <div style={{ background: '#12141c', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '24px', textAlign: 'left', marginBottom: '30px' }}>
            <h3 style={{ color: 'var(--color-primary)', marginBottom: '12px', fontSize: '1rem', fontWeight: '600' }}>To Run Ingestion & NLP Scoring locally:</h3>
            <pre style={{ color: '#00ffcc', overflowX: 'auto', fontSize: '0.9rem', fontFamily: 'monospace' }}>
              cd backend<br />
              pip install -r requirements.txt<br />
              python run_pipeline.py --tickers AAPL MSFT GOOGL AMZN META --years 5
            </pre>
          </div>
          
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            This process will fetch SEC submissions, extract sections, cache FinBERT scores, and export files to <code style={{color:'white'}}>frontend/public/data/</code> automatically.
          </div>
        </div>
      </div>
    );
  }

  // Calculate coordinates for SVG Line Chart (Sentiment Timeline)
  const isFinbertEnabled = tickerData.length > 0 && tickerData.some(d => d.finbert_sentiment_score !== 0.0);
  
  let lmPoints = '';
  let bertPoints = '';
  let lmAreaPath = '';
  let bertAreaPath = '';
  let dateLabels = [];
  const chartHeight = 150;
  const chartWidth = 500;
  const paddingX = 40;
  const paddingY = 20;
  
  let overallMinLM = -0.01;
  let overallMaxLM = 0.01;
  let overallMinBert = -0.1;
  let overallMaxBert = 0.1;
  let spreadBert = 0.2;
  
  // yZero represents the vertical coordinate of the zero horizontal line
  let yZero = chartHeight / 2;

  if (tickerData.length > 1) {
    const minLM = Math.min(...tickerData.map(d => d.lm_sentiment_score));
    const maxLM = Math.max(...tickerData.map(d => d.lm_sentiment_score));
    
    // Add 15% padding so lines don't hit the exact top/bottom boundaries of the canvas
    const marginLM = (maxLM - minLM) * 0.15 || 0.002;
    overallMinLM = minLM - marginLM;
    overallMaxLM = maxLM + marginLM;
    const spreadLM = overallMaxLM - overallMinLM || 0.001;

    // Zero-line Y coordinate for LM
    const zeroY_LM = chartHeight - paddingY - ((0.0 - overallMinLM) / spreadLM) * (chartHeight - 2 * paddingY);

    let zeroY_Bert = chartHeight / 2;

    if (isFinbertEnabled) {
      const minBert = Math.min(...tickerData.map(d => d.finbert_sentiment_score));
      const maxBert = Math.max(...tickerData.map(d => d.finbert_sentiment_score));
      const marginBert = (maxBert - minBert) * 0.15 || 0.1;
      overallMinBert = minBert - marginBert;
      overallMaxBert = maxBert + marginBert;
      spreadBert = overallMaxBert - overallMinBert || 0.1;
      
      zeroY_Bert = chartHeight - paddingY - ((0.0 - overallMinBert) / spreadBert) * (chartHeight - 2 * paddingY);
      yZero = zeroY_Bert; // Use FinBERT's zero-line as reference when enabled
    } else {
      yZero = zeroY_LM; // Use LM's zero-line when FinBERT is disabled
    }

    tickerData.forEach((d, idx) => {
      const x = paddingX + (idx / (tickerData.length - 1)) * (chartWidth - 2 * paddingX);
      
      // Calculate coordinates using independent scaling ranges
      const yLM = chartHeight - paddingY - ((d.lm_sentiment_score - overallMinLM) / spreadLM) * (chartHeight - 2 * paddingY);
      lmPoints += `${idx === 0 ? '' : ' '}${x},${yLM}`;
      
      if (isFinbertEnabled) {
        const yBert = chartHeight - paddingY - ((d.finbert_sentiment_score - overallMinBert) / spreadBert) * (chartHeight - 2 * paddingY);
        bertPoints += `${idx === 0 ? '' : ' '}${x},${yBert}`;
      }
      
      dateLabels.push({ x, label: d.filing_date.substring(2, 7) });
    });

    lmAreaPath = `M ${paddingX},${chartHeight - paddingY} L ${lmPoints.split(' ').join(' L ')} L ${chartWidth - paddingX},${chartHeight - paddingY} Z`;
    if (isFinbertEnabled) {
      bertAreaPath = `M ${paddingX},${chartHeight - paddingY} L ${bertPoints.split(' ').join(' L ')} L ${chartWidth - paddingX},${chartHeight - paddingY} Z`;
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* HEADER NAVBAR */}
      <header style={{ borderBottom: '1px solid var(--border-card)', padding: '20px 40px', background: 'rgba(8, 9, 12, 0.8)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1440px', margin: '0 auto' }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: '1.6rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              SEC FILING NLP ALPHA ENGINE
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
              TEXTUAL SENTIMENT ANALYSIS & SIGNAL BACKTESTING
            </p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Active Ticker:</span>
            <select
              value={selectedTicker}
              onChange={(e) => setSelectedTicker(e.target.value)}
              style={{
                background: '#161922',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '0.9rem',
                fontWeight: '600',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {summary.tickers.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* DASHBOARD CONTENT GRID */}
      <main style={{ flex: 1, padding: '40px', maxWidth: '1440px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {isLoadingData ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '40px', height: '40px', border: '3px solid rgba(0,242,254,0.1)', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'loadingDot 1s linear infinite', margin: '0 auto 16px' }}></div>
              <p style={{ color: 'var(--text-secondary)' }}>Loading filing data for {selectedTicker}...</p>
            </div>
          </div>
        ) : tickerData.length === 0 ? (
          <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-danger)' }}>No parsed filings found for {selectedTicker}. Run the backend pipeline to generate it.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '30px' }}>
            
            {/* OVERVIEW PANEL AND CHART */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '30px' }}>
              
              {/* CURRENT FILING SUMMARY */}
              <div className="glass-panel animate-fade-in" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <div>
                      <h2 style={{ fontSize: '2rem', fontWeight: '800', color: 'white' }}>{selectedTicker}</h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Filing Timeline ({tickerData.length} records parsed)
                      </p>
                    </div>
                    {currentFiling && getSignalBadge(currentFiling.composite_signal)}
                  </div>
                  
                  {currentFiling && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Filing Form:</span>
                        <span style={{ fontWeight: '600' }}>{currentFiling.form}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Filing Date:</span>
                        <span style={{ fontWeight: '600' }}>{currentFiling.filing_date}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Composite Signal Score:</span>
                        <span style={{ fontWeight: '700', color: currentFiling.composite_signal >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {currentFiling.composite_signal ? currentFiling.composite_signal.toFixed(4) : '0.0000'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* FILING PICKER */}
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Select Filing Event to Inspect
                  </label>
                  <select
                    value={activeFilingIndex}
                    onChange={(e) => setActiveFilingIndex(Number(e.target.value))}
                    style={{
                      width: '100%',
                      background: '#12141c',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '0.9rem',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {tickerData.map((d, index) => (
                      <option key={d.accession} value={index}>
                        {d.filing_date} ({d.form}) - Score: {d.composite_signal ? d.composite_signal.toFixed(2) : '0.00'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* SENTIMENT TIMELINE SVG CHART */}
              <div className="glass-panel animate-fade-in" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  
                  {/* Chart Title and Toggle Selector */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{chartType === 'trend' ? 'Sentiment & Tone Trend' : 'YoY Sentiment Shift vs. 21d Alpha'}</span>
                      <span className="badge badge-neutral" style={{ textTransform: 'none', fontSize: '0.65rem' }}>
                        {chartType === 'trend' ? 'Dynamic Area Chart' : 'Correlation View'}
                      </span>
                    </h3>
                    
                    {/* Toggle controls */}
                    <div style={{ display: 'flex', background: '#12141c', borderRadius: '6px', padding: '3px', border: '1px solid var(--border-card)' }}>
                      <button
                        onClick={() => setChartType('trend')}
                        style={{
                          background: chartType === 'trend' ? 'rgba(255,255,255,0.08)' : 'transparent',
                          color: chartType === 'trend' ? 'white' : 'var(--text-secondary)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Tone Trend
                      </button>
                      <button
                        onClick={() => setChartType('correlation')}
                        style={{
                          background: chartType === 'correlation' ? 'rgba(255,255,255,0.08)' : 'transparent',
                          color: chartType === 'correlation' ? 'white' : 'var(--text-secondary)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Shift vs. Alpha
                      </button>
                    </div>
                  </div>

                  {/* Chart Subtitle / Legend */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', marginBottom: '15px', color: 'var(--text-secondary)' }}>
                    {chartType === 'trend' ? (
                      <div style={{ display: 'flex', gap: '16px' }}>
                        {isFinbertEnabled && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '10px', height: '2px', background: 'var(--color-primary)', display: 'inline-block' }}></span>
                            FinBERT Sentiment (Context)
                          </span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '2px', background: 'var(--color-secondary)', display: 'inline-block' }}></span>
                          Loughran-McDonald (Lexicon)
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '6px', background: 'var(--color-success)', display: 'inline-block', borderRadius: '1px' }}></span>
                          Positive Shift (YoY)
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '6px', background: 'var(--color-danger)', display: 'inline-block', borderRadius: '1px' }}></span>
                          Negative Shift (YoY)
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '6px', background: 'var(--color-primary)', display: 'inline-block', borderRadius: '1px' }}></span>
                          Positive Alpha (21d)
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '6px', background: 'var(--color-secondary)', display: 'inline-block', borderRadius: '1px' }}></span>
                          Negative Alpha (21d)
                        </span>
                      </div>
                    )}
                    
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {chartType === 'trend' ? 'Click circles to select and inspect filing' : 'Compare shifts to alpha outcomes'}
                    </span>
                  </div>
                  
                  {tickerData.length > 1 ? (
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" height={chartHeight} style={{ overflow: 'visible' }}>
                        
                        {/* SVG Gradient definitions */}
                        <defs>
                          <linearGradient id="lm-gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-secondary)" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="var(--color-secondary)" stopOpacity="0.0" />
                          </linearGradient>
                          <linearGradient id="bert-gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* MODE 1: TONE TREND LINE/AREA CHART */}
                        {chartType === 'trend' && (
                          <>
                            {/* Horizontal gridlines */}
                            <line x1={paddingX} y1={paddingY} x2={chartWidth - paddingX} y2={paddingY} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                            <line x1={paddingX} y1={chartHeight - paddingY} x2={chartWidth - paddingX} y2={chartHeight - paddingY} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                            
                            {/* Dynamic zero line */}
                            {yZero >= paddingY && yZero <= chartHeight - paddingY && (
                              <line x1={paddingX} y1={yZero} x2={chartWidth - paddingX} y2={yZero} stroke="rgba(255,255,255,0.07)" strokeWidth="1.5" strokeDasharray="3" />
                            )}
                            
                            {/* Y-axis Labels */}
                            <text x={paddingX - 8} y={paddingY + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              {isFinbertEnabled ? `${overallMaxBert >= 0 ? '+' : ''}${overallMaxBert.toFixed(2)}` : `${overallMaxLM >= 0 ? '+' : ''}${overallMaxLM.toFixed(3)}`}
                            </text>
                            <text x={paddingX - 8} y={chartHeight / 2 + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              {isFinbertEnabled ? `${((overallMaxBert + overallMinBert)/2).toFixed(2)}` : `${((overallMaxLM + overallMinLM)/2).toFixed(3)}`}
                            </text>
                            <text x={paddingX - 8} y={chartHeight - paddingY + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              {isFinbertEnabled ? `${overallMinBert.toFixed(2)}` : `${overallMinLM.toFixed(3)}`}
                            </text>

                            {/* Area Glow paths */}
                            {isFinbertEnabled && bertAreaPath && <path d={bertAreaPath} fill="url(#bert-gradient)" />}
                            {lmAreaPath && <path d={lmAreaPath} fill="url(#lm-gradient)" />}
                            
                            {/* Line curves */}
                            {isFinbertEnabled && <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2.5" points={bertPoints} />}
                            <polyline fill="none" stroke="var(--color-secondary)" strokeWidth={isFinbertEnabled ? "1.5" : "2.5"} strokeDasharray={isFinbertEnabled ? "4 2" : "none"} points={lmPoints} />
                            
                            {/* Primary Interactive nodes */}
                            {tickerData.map((d, idx) => {
                              const x = paddingX + (idx / (tickerData.length - 1)) * (chartWidth - 2 * paddingX);
                              
                              let yDot = 0;
                              let dotColor = '';
                              let scoreVal = 0;
                              let metricName = '';

                              if (isFinbertEnabled) {
                                const minBert = Math.min(...tickerData.map(val => val.finbert_sentiment_score));
                                const maxBert = Math.max(...tickerData.map(val => val.finbert_sentiment_score));
                                const marginBert = (maxBert - minBert) * 0.15 || 0.1;
                                const overallMinBert = minBert - marginBert;
                                const overallMaxBert = maxBert + marginBert;
                                const spreadBert = overallMaxBert - overallMinBert || 0.1;
                                yDot = chartHeight - paddingY - ((d.finbert_sentiment_score - overallMinBert) / spreadBert) * (chartHeight - 2 * paddingY);
                                dotColor = 'var(--color-primary)';
                                scoreVal = d.finbert_sentiment_score;
                                metricName = 'FinBERT';
                              } else {
                                const minLM = Math.min(...tickerData.map(val => val.lm_sentiment_score));
                                const maxLM = Math.max(...tickerData.map(val => val.lm_sentiment_score));
                                const marginLM = (maxLM - minLM) * 0.15 || 0.002;
                                const overallMinLM = minLM - marginLM;
                                const overallMaxLM = maxLM + marginLM;
                                const spreadLM = overallMaxLM - overallMinLM || 0.001;
                                yDot = chartHeight - paddingY - ((d.lm_sentiment_score - overallMinLM) / spreadLM) * (chartHeight - 2 * paddingY);
                                dotColor = 'var(--color-secondary)';
                                scoreVal = d.lm_sentiment_score;
                                metricName = 'LM Lexicon';
                              }

                              const isCurrent = idx === activeFilingIndex;

                              return (
                                <g key={d.accession}>
                                  <circle
                                    cx={x}
                                    cy={yDot}
                                    r={isCurrent ? 6 : 4}
                                    fill={isCurrent ? dotColor : '#08090c'}
                                    stroke={dotColor}
                                    strokeWidth="2"
                                    style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                                    onClick={() => setActiveFilingIndex(idx)}
                                  >
                                    <title>{d.filing_date} ({d.form}): {metricName} Score = {scoreVal.toFixed(4)}</title>
                                  </circle>
                                </g>
                              );
                            })}
                          </>
                        )}

                        {/* MODE 2: SENTIMENT SHIFT VS FORWARD ALPHA BAR CHART */}
                        {chartType === 'correlation' && (
                          <>
                            {/* Horizontal Grid lines */}
                            <line x1={paddingX} y1={paddingY} x2={chartWidth - paddingX} y2={paddingY} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                            <line x1={paddingX} y1={chartHeight - paddingY} x2={chartWidth - paddingX} y2={chartHeight - paddingY} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                            
                            {/* Center Zero Horizontal line */}
                            <line x1={paddingX} y1={chartHeight / 2} x2={chartWidth - paddingX} y2={chartHeight / 2} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

                            {/* Axis Labels */}
                            <text x={paddingX - 8} y={paddingY + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              Positive
                            </text>
                            <text x={paddingX - 8} y={chartHeight / 2 + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              0
                            </text>
                            <text x={paddingX - 8} y={chartHeight - paddingY + 3} fill="var(--text-muted)" fontSize="8.5" textAnchor="end">
                              Negative
                            </text>

                            {/* Render Grouped Bars */}
                            {tickerData.map((d, idx) => {
                              const xCenter = paddingX + (idx / (tickerData.length - 1)) * (chartWidth - 2 * paddingX);
                              
                              const maxZ = Math.max(...tickerData.map(val => Math.abs(val.sentiment_yoy_change_z || 0)), 1.0) * 1.1;
                              const maxAlpha = Math.max(...tickerData.map(val => Math.abs(val.alpha_21d || 0)), 0.05) * 1.1;
                              const centerY = chartHeight / 2;
                              const maxBarHeight = chartHeight / 2 - paddingY;

                              const z = d.sentiment_yoy_change_z || 0;
                              const alpha = d.alpha_21d || 0;
                              const hasAlpha = d.alpha_21d !== null && !isNaN(d.alpha_21d);

                              // 1. Z-Score Sentiment Shift Bar
                              const hZ = (Math.abs(z) / maxZ) * maxBarHeight;
                              const yZ = z >= 0 ? centerY - hZ : centerY;
                              const colorZ = z >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

                              // 2. Forward Alpha Bar
                              const hAlpha = (Math.abs(alpha) / maxAlpha) * maxBarHeight;
                              const yAlpha = alpha >= 0 ? centerY - hAlpha : centerY;
                              const colorAlpha = alpha >= 0 ? 'var(--color-primary)' : 'var(--color-secondary)';

                              const isCurrent = idx === activeFilingIndex;

                              return (
                                <g key={d.accession} style={{ cursor: 'pointer' }} onClick={() => setActiveFilingIndex(idx)}>
                                  {/* Hover background highlighting */}
                                  <rect
                                    x={xCenter - 12}
                                    y={paddingY}
                                    width={24}
                                    height={chartHeight - 2 * paddingY}
                                    className={`chart-col-highlight ${isCurrent ? 'active' : ''}`}
                                    strokeWidth="1"
                                    rx="4"
                                  />
                                  
                                  {/* Z-score Bar */}
                                  <rect
                                    x={xCenter - 7}
                                    y={yZ}
                                    width={5}
                                    height={Math.max(2, hZ)}
                                    fill={colorZ}
                                    opacity={isCurrent ? 1.0 : 0.75}
                                    rx="1"
                                  >
                                    <title>{d.filing_date} ({d.form}): YoY Sentiment Shift = {z.toFixed(2)} SDs</title>
                                  </rect>
                                  
                                  {/* Alpha Bar */}
                                  {hasAlpha ? (
                                    <rect
                                      x={xCenter + 1}
                                      y={yAlpha}
                                      width={5}
                                      height={Math.max(2, hAlpha)}
                                      fill={colorAlpha}
                                      opacity={isCurrent ? 1.0 : 0.75}
                                      rx="1"
                                    >
                                      <title>{d.filing_date} ({d.form}): Fwd 21d Alpha = {(alpha * 100).toFixed(2)}%</title>
                                    </rect>
                                  ) : (
                                    /* Dotted indicator for pending alpha */
                                    <rect
                                      x={xCenter + 1}
                                      y={centerY - 5}
                                      width={5}
                                      height={10}
                                      fill="none"
                                      stroke="rgba(255,255,255,0.2)"
                                      strokeWidth="1"
                                      strokeDasharray="1.5"
                                    >
                                      <title>{d.filing_date} ({d.form}): Alpha Pending</title>
                                    </rect>
                                  )}
                                </g>
                              );
                            })}
                          </>
                        )}

                        {/* Date axis labels */}
                        {dateLabels.map((lbl, idx) => (
                          // Draw every second label if there are too many
                          (tickerData.length < 8 || idx % 2 === 0) && (
                            <text
                              key={idx}
                              x={lbl.x}
                              y={chartHeight - 2}
                              fill="var(--text-muted)"
                              fontSize="9"
                              textAnchor="middle"
                            >
                              {lbl.label}
                            </text>
                          )
                        ))}
                      </svg>
                    </div>
                  ) : (
                    <div style={{ height: '120px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
                      Not enough data points to plot trend line.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* DETAIL METRIC CARDS */}
            {currentFiling && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }} className="animate-fade-in">
                
                {/* LM SENTIMENT */}
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>LM Dictionary Sentiment</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: '800' }}>{currentFiling.lm_sentiment_score.toFixed(4)}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: currentFiling.sentiment_yoy_change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {currentFiling.sentiment_yoy_change >= 0 ? '+' : ''}{currentFiling.sentiment_yoy_change.toFixed(4)} YoY
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Baseline dictionary score
                  </div>
                </div>

                {/* FINBERT SENTIMENT */}
                <div className="glass-panel" style={{ padding: '20px', borderLeft: '3px solid var(--color-primary)', opacity: isFinbertEnabled ? 1 : 0.65 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>FinBERT Sentiment</span>
                  {isFinbertEnabled ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--color-primary)' }}>{currentFiling.finbert_sentiment_score.toFixed(4)}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: '600', color: currentFiling.finbert_yoy_change >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {currentFiling.finbert_yoy_change >= 0 ? '+' : ''}{currentFiling.finbert_yoy_change.toFixed(4)} YoY
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Transformer-based contextual score
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-muted)', marginTop: '10px' }}>
                        Not Evaluated
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '14px', lineHeight: '1.3' }}>
                        Run the pipeline without the <code>--skip-finbert</code> flag to enable.
                      </div>
                    </>
                  )}
                </div>

                {/* RISK SECTION WORD COUNT */}
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Risk Word Count</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: '800' }}>{currentFiling.risk_word_count.toLocaleString()}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: currentFiling.risk_wordcount_yoy_pct >= 0.05 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                      {currentFiling.risk_wordcount_yoy_pct >= 0 ? '+' : ''}{(currentFiling.risk_wordcount_yoy_pct * 100).toFixed(1)}% YoY
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Item 1A Risk Factors length
                  </div>
                </div>

                {/* READABILITY FOG INDEX */}
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Readability (Gunning Fog)</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: '800' }}>{currentFiling.fog_index.toFixed(2)}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: currentFiling.readability_change >= 0.5 ? 'var(--color-warning)' : 'var(--text-secondary)' }}>
                      {currentFiling.readability_change >= 0 ? '+' : ''}{currentFiling.readability_change.toFixed(2)} YoY
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Higher means more complex/obfuscated
                  </div>
                </div>
              </div>
            )}

            {/* LOUGHRAN-MCDONALD LEXICON BREAKDOWN */}
            {currentFiling && (
              <div className="glass-panel animate-fade-in" style={{ padding: '30px' }}>
                
                {/* Section Header with Tabs */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '15px', marginBottom: '25px', flexWrap: 'wrap', gap: '15px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>Loughran-McDonald Lexicon Analytics</span>
                      <span className="badge badge-neutral" style={{ textTransform: 'none', fontSize: '0.7rem' }}>Academic Standard</span>
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Analyze sentiment structure, word distribution, and language hedging.
                    </p>
                  </div>
                  
                  {/* Tab buttons */}
                  <div style={{ display: 'flex', background: '#12141c', borderRadius: '8px', padding: '4px', border: '1px solid var(--border-card)' }}>
                    <button
                      onClick={() => setLmTab('profile')}
                      style={{
                        background: lmTab === 'profile' ? 'var(--color-primary)' : 'transparent',
                        color: lmTab === 'profile' ? '#08090c' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Sentiment Profile
                    </button>
                    <button
                      onClick={() => setLmTab('historical')}
                      style={{
                        background: lmTab === 'historical' ? 'var(--color-primary)' : 'transparent',
                        color: lmTab === 'historical' ? '#08090c' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Historical Trajectory
                    </button>
                    <button
                      onClick={() => setLmTab('explainer')}
                      style={{
                        background: lmTab === 'explainer' ? 'var(--color-primary)' : 'transparent',
                        color: lmTab === 'explainer' ? '#08090c' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Lexicon Theory
                    </button>
                  </div>
                </div>

                {/* TAB CONTENT: PROFILE */}
                {lmTab === 'profile' && (
                  <div className="animate-fade-in">
                    {/* Proportions and Density Gauges Grid */}
                    {(() => {
                      const pos = currentFiling.lm_pos_words || 0;
                      const neg = currentFiling.lm_neg_words || 0;
                      const unc = currentFiling.lm_unc_words || 0;
                      const totalMatched = pos + neg + unc;
                      const totalWords = currentFiling.total_words || 1;
                      
                      const density = ((totalMatched / totalWords) * 100).toFixed(2);
                      const uncLoad = (totalMatched > 0 ? (unc / totalMatched) * 100 : 0).toFixed(1);
                      const tone = currentFiling.lm_sentiment_score;

                      // Normalizing tone (-1.0 to 1.0) into percentage (0% to 100%) for visual slider
                      const tonePct = ((tone + 1) / 2 * 100).toFixed(1);

                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                          
                          {/* Net Tone Indicator */}
                          <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Net Sentiment Tone</span>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
                                <span style={{ fontSize: '1.4rem', fontWeight: '800', color: tone >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                  {tone.toFixed(4)}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Range: -1.0 to +1.0</span>
                              </div>
                            </div>
                            
                            {/* Visual slider */}
                            <div style={{ marginTop: '14px', position: 'relative' }}>
                              <div style={{ height: '6px', background: 'linear-gradient(90deg, var(--color-danger) 0%, rgba(255,255,255,0.1) 50%, var(--color-success) 100%)', borderRadius: '3px' }}></div>
                              <div style={{ position: 'absolute', top: '-4px', left: `${tonePct}%`, width: '14px', height: '14px', background: 'white', border: '2px solid var(--bg-dark)', borderRadius: '50%', transform: 'translateX(-7px)', boxShadow: '0 0 8px rgba(255,255,255,0.8)' }}></div>
                            </div>
                          </div>

                          {/* Density Gauge */}
                          <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lexicon Density</span>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
                              <span style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--color-primary)' }}>{density}%</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {totalMatched.toLocaleString()} of {totalWords.toLocaleString()} words
                              </span>
                            </div>
                            <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', marginTop: '14px', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, parseFloat(density) * 15)}%`, height: '100%', background: 'var(--color-primary)' }}></div>
                            </div>
                          </div>

                          {/* Uncertainty Load Gauge */}
                          <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uncertainty Ratio</span>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
                              <span style={{ fontSize: '1.4rem', fontWeight: '800', color: '#a78bfa' }}>{uncLoad}%</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {unc.toLocaleString()} uncertainty words
                              </span>
                            </div>
                            <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', marginTop: '14px', overflow: 'hidden' }}>
                              <div style={{ width: `${uncLoad}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed 0%, #8b5cf6 100%)' }}></div>
                            </div>
                          </div>

                        </div>
                      );
                    })()}

                    {/* Proportions stacked bar */}
                    {(() => {
                      const pos = currentFiling.lm_pos_words || 0;
                      const neg = currentFiling.lm_neg_words || 0;
                      const unc = currentFiling.lm_unc_words || 0;
                      const totalMatched = pos + neg + unc;

                      if (totalMatched === 0) {
                        return <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>No lexicon words matched in this filing.</p>;
                      }

                      const posPct = ((pos / totalMatched) * 100).toFixed(1);
                      const negPct = ((neg / totalMatched) * 100).toFixed(1);
                      const uncPct = ((unc / totalMatched) * 100).toFixed(1);

                      return (
                        <div style={{ marginBottom: '35px' }}>
                          <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.05em' }}>
                            Lexicon Category Proportions
                          </h4>
                          <div style={{ height: '28px', background: 'rgba(255,255,255,0.04)', borderRadius: '14px', overflow: 'hidden', display: 'flex', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ width: `${posPct}%`, background: 'var(--gradient-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: 'white', fontWeight: 'bold' }} title={`${pos} Positive Words (${posPct}%)`}>
                              {pos > 0 && `${posPct}%`}
                            </div>
                            <div style={{ width: `${negPct}%`, background: 'var(--gradient-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: 'white', fontWeight: 'bold' }} title={`${neg} Negative Words (${negPct}%)`}>
                              {neg > 0 && `${negPct}%`}
                            </div>
                            <div style={{ width: `${uncPct}%`, background: 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: 'white', fontWeight: 'bold' }} title={`${unc} Uncertainty Words (${uncPct}%)`}>
                              {unc > 0 && `${uncPct}%`}
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '10px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', background: 'var(--color-success)', borderRadius: '50%' }}></span>
                              Positive: <strong>{pos}</strong> ({posPct}%)
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', background: 'var(--color-danger)', borderRadius: '50%' }}></span>
                              Negative: <strong>{neg}</strong> ({negPct}%)
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', background: '#8b5cf6', borderRadius: '50%' }}></span>
                              Uncertainty: <strong>{unc}</strong> ({uncPct}%)
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Word Tag Clouds / Pill Grid */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '15px', letterSpacing: '0.05em' }}>
                        Top Contributing Terms (Frequency Cloud)
                      </h4>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                        
                        {/* Positive Cloud */}
                        <div style={{ background: 'rgba(16, 185, 129, 0.02)', border: '1px solid rgba(16, 185, 129, 0.08)', borderRadius: '12px', padding: '20px' }}>
                          <h5 style={{ color: 'var(--color-success)', fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '15px', borderBottom: '1px solid rgba(16, 185, 129, 0.1)', paddingBottom: '8px', letterSpacing: '0.05em' }}>
                            Positive Disclosures
                          </h5>
                          {currentFiling.top_positive && currentFiling.top_positive.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                              {(() => {
                                const maxVal = Math.max(...currentFiling.top_positive.map(([_, c]) => c)) || 1;
                                return currentFiling.top_positive.map(([word, count]) => {
                                  const ratio = count / maxVal;
                                  return (
                                    <span
                                      key={word}
                                      title={`Occurred ${count} times`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        background: `rgba(16, 185, 129, ${0.05 + ratio * 0.15})`,
                                        color: 'var(--text-primary)',
                                        border: `1px solid rgba(16, 185, 129, ${0.15 + ratio * 0.35})`,
                                        borderRadius: '20px',
                                        padding: '4px 10px',
                                        fontSize: `${0.8 + ratio * 0.25}rem`,
                                        fontWeight: ratio > 0.5 ? '600' : '400',
                                        transition: 'all 0.2s ease',
                                        cursor: 'default',
                                        boxShadow: ratio > 0.7 ? '0 0 10px rgba(16, 185, 129, 0.1)' : 'none'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.transform = 'scale(1.05)';
                                        e.target.style.borderColor = 'var(--color-success)';
                                        e.target.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.3)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.transform = 'scale(1)';
                                        e.target.style.borderColor = `rgba(16, 185, 129, ${0.15 + ratio * 0.35})`;
                                        e.target.style.boxShadow = ratio > 0.7 ? '0 0 10px rgba(16, 185, 129, 0.1)' : 'none';
                                      }}
                                    >
                                      {word}
                                      <span style={{ fontSize: '0.7rem', color: 'var(--color-success)', background: 'rgba(16, 185, 129, 0.15)', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '6px', fontWeight: 'bold' }}>
                                        {count}
                                      </span>
                                    </span>
                                  );
                                });
                              })()}
                            </div>
                          ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No positive terms detected.</p>
                          )}
                        </div>

                        {/* Negative Cloud */}
                        <div style={{ background: 'rgba(239, 68, 68, 0.02)', border: '1px solid rgba(239, 68, 68, 0.08)', borderRadius: '12px', padding: '20px' }}>
                          <h5 style={{ color: 'var(--color-danger)', fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '15px', borderBottom: '1px solid rgba(239, 68, 68, 0.1)', paddingBottom: '8px', letterSpacing: '0.05em' }}>
                            Negative Disclosures
                          </h5>
                          {currentFiling.top_negative && currentFiling.top_negative.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                              {(() => {
                                const maxVal = Math.max(...currentFiling.top_negative.map(([_, c]) => c)) || 1;
                                return currentFiling.top_negative.map(([word, count]) => {
                                  const ratio = count / maxVal;
                                  return (
                                    <span
                                      key={word}
                                      title={`Occurred ${count} times`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        background: `rgba(239, 68, 68, ${0.05 + ratio * 0.15})`,
                                        color: 'var(--text-primary)',
                                        border: `1px solid rgba(239, 68, 68, ${0.15 + ratio * 0.35})`,
                                        borderRadius: '20px',
                                        padding: '4px 10px',
                                        fontSize: `${0.8 + ratio * 0.25}rem`,
                                        fontWeight: ratio > 0.5 ? '600' : '400',
                                        transition: 'all 0.2s ease',
                                        cursor: 'default',
                                        boxShadow: ratio > 0.7 ? '0 0 10px rgba(239, 68, 68, 0.1)' : 'none'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.transform = 'scale(1.05)';
                                        e.target.style.borderColor = 'var(--color-danger)';
                                        e.target.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.3)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.transform = 'scale(1)';
                                        e.target.style.borderColor = `rgba(239, 68, 68, ${0.15 + ratio * 0.35})`;
                                        e.target.style.boxShadow = ratio > 0.7 ? '0 0 10px rgba(239, 68, 68, 0.1)' : 'none';
                                      }}
                                    >
                                      {word}
                                      <span style={{ fontSize: '0.7rem', color: 'var(--color-danger)', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '6px', fontWeight: 'bold' }}>
                                        {count}
                                      </span>
                                    </span>
                                  );
                                });
                              })()}
                            </div>
                          ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No negative terms detected.</p>
                          )}
                        </div>

                        {/* Uncertainty Cloud */}
                        <div style={{ background: 'rgba(139, 92, 246, 0.02)', border: '1px solid rgba(139, 92, 246, 0.08)', borderRadius: '12px', padding: '20px' }}>
                          <h5 style={{ color: '#a78bfa', fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', marginBottom: '15px', borderBottom: '1px solid rgba(139, 92, 246, 0.1)', paddingBottom: '8px', letterSpacing: '0.05em' }}>
                            Uncertainty / Hedging
                          </h5>
                          {currentFiling.top_uncertainty && currentFiling.top_uncertainty.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                              {(() => {
                                const maxVal = Math.max(...currentFiling.top_uncertainty.map(([_, c]) => c)) || 1;
                                return currentFiling.top_uncertainty.map(([word, count]) => {
                                  const ratio = count / maxVal;
                                  return (
                                    <span
                                      key={word}
                                      title={`Occurred ${count} times`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        background: `rgba(139, 92, 246, ${0.05 + ratio * 0.15})`,
                                        color: 'var(--text-primary)',
                                        border: `1px solid rgba(139, 92, 246, ${0.15 + ratio * 0.35})`,
                                        borderRadius: '20px',
                                        padding: '4px 10px',
                                        fontSize: `${0.8 + ratio * 0.25}rem`,
                                        fontWeight: ratio > 0.5 ? '600' : '400',
                                        transition: 'all 0.2s ease',
                                        cursor: 'default',
                                        boxShadow: ratio > 0.7 ? '0 0 10px rgba(139, 92, 246, 0.1)' : 'none'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.target.style.transform = 'scale(1.05)';
                                        e.target.style.borderColor = '#8b5cf6';
                                        e.target.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.3)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.target.style.transform = 'scale(1)';
                                        e.target.style.borderColor = `rgba(139, 92, 246, ${0.15 + ratio * 0.35})`;
                                        e.target.style.boxShadow = ratio > 0.7 ? '0 0 10px rgba(139, 92, 246, 0.1)' : 'none';
                                      }}
                                    >
                                      {word}
                                      <span style={{ fontSize: '0.7rem', color: '#c084fc', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '6px', fontWeight: 'bold' }}>
                                        {count}
                                      </span>
                                    </span>
                                  );
                                });
                              })()}
                            </div>
                          ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No uncertainty terms detected.</p>
                          )}
                        </div>

                      </div>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: HISTORICAL TRAJECTORY */}
                {lmTab === 'historical' && (
                  <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    
                    {/* SVG Chart Wrapper */}
                    {(() => {
                      // Prepare history data
                      const history = tickerData.map((d, index) => {
                        const total = d.total_words || 1;
                        const pos = d.lm_pos_words || 0;
                        const neg = d.lm_neg_words || 0;
                        const unc = d.lm_unc_words || 0;
                        
                        return {
                          index,
                          date: d.filing_date,
                          form: d.form,
                          posRate: (pos / total) * 100,
                          negRate: (neg / total) * 100,
                          uncRate: (unc / total) * 100
                        };
                      });

                      if (history.length <= 1) {
                        return (
                          <div style={{ height: '180px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
                            Not enough historical filings for this ticker to plot trajectory.
                          </div>
                        );
                      }

                      // Find max rate for scaling Y axis
                      const maxR = Math.max(
                        ...history.map(h => Math.max(h.posRate, h.negRate, h.uncRate)),
                        0.1
                      ) * 1.1;

                      const svgW = 600;
                      const svgH = 180;
                      const padX = 40;
                      const padY = 20;

                      // Map points to SVG coordinates
                      const getCoords = (idx, rate) => {
                        const x = padX + (idx / (history.length - 1)) * (svgW - 2 * padX);
                        const y = svgH - padY - (rate / maxR) * (svgH - 2 * padY);
                        return { x, y };
                      };

                      let posPointsStr = '';
                      let negPointsStr = '';
                      let uncPointsStr = '';

                      history.forEach((h, idx) => {
                        const cPos = getCoords(idx, h.posRate);
                        const cNeg = getCoords(idx, h.negRate);
                        const cUnc = getCoords(idx, h.uncRate);
                        
                        posPointsStr += `${idx === 0 ? '' : ' '}${cPos.x},${cPos.y}`;
                        negPointsStr += `${idx === 0 ? '' : ' '}${cNeg.x},${cNeg.y}`;
                        uncPointsStr += `${idx === 0 ? '' : ' '}${cUnc.x},${cUnc.y}`;
                      });

                      return (
                        <div className="trajectory-layout">
                          
                          {/* Main Chart */}
                          <div style={{ width: '100%', overflowX: 'auto', background: '#0a0c12', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px 12px 10px' }}>
                            <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" height={svgH} style={{ overflow: 'visible' }}>
                              
                              {/* Grid lines */}
                              <line x1={padX} y1={padY} x2={svgW - padX} y2={padY} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                              <line x1={padX} y1={svgH/2} x2={svgW - padX} y2={svgH/2} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                              <line x1={padX} y1={svgH - padY} x2={svgW - padX} y2={svgH - padY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                              
                              {/* Draw lines */}
                              <polyline fill="none" stroke="var(--color-success)" strokeWidth="2.5" points={posPointsStr} />
                              <polyline fill="none" stroke="var(--color-danger)" strokeWidth="2.5" points={negPointsStr} />
                              <polyline fill="none" stroke="#8b5cf6" strokeWidth="2.5" points={uncPointsStr} />

                              {/* Interactive Nodes */}
                              {history.map((h, idx) => {
                                const cPos = getCoords(idx, h.posRate);
                                const cNeg = getCoords(idx, h.negRate);
                                const cUnc = getCoords(idx, h.uncRate);

                                const isCurrent = idx === activeFilingIndex;

                                return (
                                  <g key={idx}>
                                    {/* X-axis label */}
                                    {(history.length < 8 || idx % 2 === 0) && (
                                      <text x={cPos.x} y={svgH - 2} fill="var(--text-muted)" fontSize="8.5" textAnchor="middle">
                                        {h.date.substring(2, 7)}
                                      </text>
                                    )}

                                    {/* Positive Node */}
                                    <circle
                                      cx={cPos.x}
                                      cy={cPos.y}
                                      r={isCurrent ? 6 : 4}
                                      fill={isCurrent ? 'var(--color-success)' : '#0a0c12'}
                                      stroke="var(--color-success)"
                                      strokeWidth="2"
                                      style={{ cursor: 'pointer' }}
                                      onMouseEnter={() => setLmHoveredNode(idx)}
                                      onMouseLeave={() => setLmHoveredNode(null)}
                                      onClick={() => setActiveFilingIndex(idx)}
                                    />

                                    {/* Negative Node */}
                                    <circle
                                      cx={cNeg.x}
                                      cy={cNeg.y}
                                      r={isCurrent ? 6 : 4}
                                      fill={isCurrent ? 'var(--color-danger)' : '#0a0c12'}
                                      stroke="var(--color-danger)"
                                      strokeWidth="2"
                                      style={{ cursor: 'pointer' }}
                                      onMouseEnter={() => setLmHoveredNode(idx)}
                                      onMouseLeave={() => setLmHoveredNode(null)}
                                      onClick={() => setActiveFilingIndex(idx)}
                                    />

                                    {/* Uncertainty Node */}
                                    <circle
                                      cx={cUnc.x}
                                      cy={cUnc.y}
                                      r={isCurrent ? 6 : 4}
                                      fill={isCurrent ? '#8b5cf6' : '#0a0c12'}
                                      stroke="#8b5cf6"
                                      strokeWidth="2"
                                      style={{ cursor: 'pointer' }}
                                      onMouseEnter={() => setLmHoveredNode(idx)}
                                      onMouseLeave={() => setLmHoveredNode(null)}
                                      onClick={() => setActiveFilingIndex(idx)}
                                    />
                                  </g>
                                );
                              })}
                            </svg>
                          </div>

                          {/* Detail Overlay Sidebar */}
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
                            <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px', minHeight: '130px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {(() => {
                                const activeNode = lmHoveredNode !== null ? lmHoveredNode : activeFilingIndex;
                                const data = history[activeNode];
                                if (!data) return null;

                                return (
                                  <div className="animate-fade-in">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px', marginBottom: '8px' }}>
                                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'white' }}>
                                        {data.date} ({data.form})
                                      </span>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                                        {lmHoveredNode !== null ? 'Hovered' : 'Selected'}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Positive Rate:</span>
                                        <span style={{ color: 'var(--color-success)', fontWeight: '600' }}>{data.posRate.toFixed(3)}%</span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Negative Rate:</span>
                                        <span style={{ color: 'var(--color-danger)', fontWeight: '600' }}>{data.negRate.toFixed(3)}%</span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Uncertainty Rate:</span>
                                        <span style={{ color: '#a78bfa', fontWeight: '600' }}>{data.uncRate.toFixed(3)}%</span>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center', borderTop: '1px dashed rgba(255,255,255,0.04)', paddingTop: '6px' }}>
                                      Click chart nodes to select and inspect filing
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>

                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* TAB CONTENT: EXPLAINER */}
                {lmTab === 'explainer' && (
                  <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '25px' }}>
                    
                    <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '20px' }}>
                      <h4 style={{ color: 'var(--color-primary)', fontSize: '0.95rem', fontWeight: '700', marginBottom: '10px' }}>
                        Why Loughran-McDonald (LM)?
                      </h4>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                        General-purpose dictionaries (like the Harvard General Inquirer) fail on corporate financial filings because words that are negative in common speech are neutral in business.
                      </p>
                      <ul style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '20px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li><strong>"Liability":</strong> A negative word in general speech, but simply a standard balance sheet term in finance.</li>
                        <li><strong>"Depreciation" & "Cost":</strong> Standard financial operations, not negative sentiment.</li>
                        <li><strong>"Board" & "Vice":</strong> Often flagged as negative/conflict words by generic NLP, but represent corporate officers in SEC text.</li>
                      </ul>
                    </div>

                    <div style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', padding: '20px' }}>
                      <h4 style={{ color: '#a78bfa', fontSize: '0.95rem', fontWeight: '700', marginBottom: '10px' }}>
                        Uncertainty & Negation Mechanics
                      </h4>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                        SEC text is highly formal and uses "hedging" words (uncertainty) to manage legal liability. We monitor both hedging patterns and linguistic negations:
                      </p>
                      <ul style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '20px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li><strong>Uncertainty Words:</strong> Words like <i>could, approximate, risk, fluctuate, predict, hypothetical</i> map corporate hesitation. High uncertainty levels often correlate with higher return variance.</li>
                        <li><strong>3-Token Lookback Negation:</strong> If a positive word (e.g. <i>effective</i>) is preceded by a negation (e.g. <i>"not"</i>) within 3 tokens (e.g. <i>"is not effective"</i>), we count it as a negative event.</li>
                      </ul>
                    </div>

                  </div>
                )}

              </div>
            )}

            {/* FORWARD RETURNS & BACKTEST PERFORMANCE */}
            {currentFiling && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '30px' }} className="animate-fade-in">
                
                {/* FORWARD RETURNS CARD */}
                <div className="glass-panel" style={{ padding: '30px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '20px' }}>
                    Fwd Returns vs. Benchmark (SPY) for this Event
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {FWD_RETURN_HORIZONS.map((h) => {
                      const fwd_ret = currentFiling[`fwd_return_${h}d`];
                      const alpha = currentFiling[`alpha_${h}d`];
                      
                      const hasReturn = fwd_ret !== null && !isNaN(fwd_ret);
                      
                      return (
                        <div key={h} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '10px' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{getHorizonLabel(h)}</span>
                          
                          {/* Visual performance bar */}
                          <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden', margin: '0 16px', position: 'relative' }}>
                            {hasReturn && (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: alpha >= 0 ? '50%' : `${50 + alpha * 200}%`,
                                  width: `${Math.min(0.5, Math.abs(alpha)) * 200}%`,
                                  height: '100%',
                                  background: alpha >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                                  borderRadius: '4px'
                                }}
                              ></div>
                            )}
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            {hasReturn ? (
                              <>
                                <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>{(fwd_ret * 100).toFixed(2)}%</div>
                                <div style={{ fontSize: '0.75rem', fontWeight: '600', color: alpha >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                  {alpha >= 0 ? '+' : ''}{(alpha * 100).toFixed(2)}% Alpha
                                </div>
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Data Pending</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* OVERALL PORTFOLIO BACKTEST TEARSHEET */}
                <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '8px' }}>
                      Overall Signal Backtest Performance
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                      Information Coefficient (Spearman Rank Correlation of composite signal to forward Alpha)
                    </p>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', textAlign: 'center' }}>
                      {FWD_RETURN_HORIZONS.map((h) => {
                        const ic = summary.ic_scores[h.toString()] || 0.0;
                        return (
                          <div key={h} style={{ background: '#12141c', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px 8px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{h}d Horizon</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: '800', marginTop: '6px', color: ic >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {ic.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>IC Score</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px', marginTop: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      <span>System Total Filings Scored:</span>
                      <span style={{ fontWeight: '600', color: 'white' }}>{summary.total_filings}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      <span>Quant Alpha Strategy:</span>
                      <span style={{ fontWeight: '600', color: 'var(--color-primary)' }}>Cross-Sectional Decile Long/Short</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <span>Last Updated:</span>
                      <span style={{ fontWeight: '600', color: 'white' }}>{summary.last_updated}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DYNAMIC TEXT DIFF VIEWER */}
            {currentFiling && (
              <div className="glass-panel animate-fade-in" style={{ padding: '35px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '20px', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '800' }}>
                      Filing Section Diff Viewer
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Compare changes in disclosures YoY (Added lines in green, deleted lines in red).
                    </p>
                  </div>
                  
                  {/* Selector for Section Type */}
                  <div style={{ display: 'flex', background: '#12141c', borderRadius: '8px', padding: '4px', border: '1px solid var(--border-card)' }}>
                    <button
                      onClick={() => setActiveSection('risk_factors')}
                      style={{
                        background: activeSection === 'risk_factors' ? 'var(--color-primary)' : 'transparent',
                        color: activeSection === 'risk_factors' ? '#08090c' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Item 1A (Risk Factors)
                    </button>
                    <button
                      onClick={() => setActiveSection('mda')}
                      style={{
                        background: activeSection === 'mda' ? 'var(--color-primary)' : 'transparent',
                        color: activeSection === 'mda' ? '#08090c' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      Item 7 (MD&A)
                    </button>
                  </div>
                </div>

                {isLoadingDiff ? (
                  <div style={{ minHeight: '200px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ width: '30px', height: '30px', border: '3px solid rgba(189,0,255,0.1)', borderTop: '3px solid var(--color-secondary)', borderRadius: '50%', animation: 'loadingDot 1s linear infinite', margin: '0 auto 12px' }}></div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Analyzing textual differences...</p>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      background: '#040508',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '10px',
                      padding: '24px',
                      fontSize: '0.95rem',
                      lineHeight: '1.7',
                      color: '#d1d5db',
                      textAlign: 'left'
                    }}
                  >
                    {diffResult.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No text available to display.</p>
                    ) : (
                      diffResult.map((block, idx) => {
                        if (block.type === 'added') {
                          return (
                            <span key={idx} className="diff-added" style={{ display: 'inline', marginRight: '4px' }}>
                              {block.text}
                            </span>
                          );
                        } else if (block.type === 'removed') {
                          return (
                            <span key={idx} className="diff-removed" style={{ display: 'inline', marginRight: '4px' }}>
                              {block.text}
                            </span>
                          );
                        } else if (block.type === 'info') {
                          return (
                            <span key={idx} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              {block.text}
                            </span>
                          );
                        } else {
                          return (
                            <span key={idx} style={{ marginRight: '4px' }}>
                              {block.text}
                            </span>
                          );
                        }
                      })
                    )}
                  </div>
                )}
                
                {activeFilingIndex === 0 && !isLoadingDiff && (
                  <div style={{ marginTop: '16px', background: 'rgba(0, 242, 254, 0.05)', border: '1px dashed rgba(0, 242, 254, 0.2)', borderRadius: '8px', padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Note: This is the oldest filing in the dataset. No prior year filing is loaded, so the entire document is shown as new additions.
                  </div>
                )}
              </div>
            )}
            
          </div>
        )}
        
      </main>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--border-card)', padding: '20px 40px', background: 'rgba(8, 9, 12, 0.9)', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <span>SEC Filing NLP Alpha Engine - Academic Quant Research Platform</span>
          <span>Deployable on Vercel Serverless Platform</span>
        </div>
      </footer>

    </div>
  );
}

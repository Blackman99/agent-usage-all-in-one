import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));

const logoSvg = readFileSync(join(root, 'static/brand/agent-usage-logo.svg'), 'utf8');
const openaiSvg = readFileSync(join(root, 'static/brands/openai.svg'), 'utf8');
const claudeSvg = readFileSync(join(root, 'static/brands/claude.svg'), 'utf8');
const opencodeSvg = readFileSync(join(root, 'static/brands/opencode-light.svg'), 'utf8');
const grokSvg = readFileSync(join(root, 'static/brands/grok-light.svg'), 'utf8');
const deepseekSvg = readFileSync(join(root, 'static/brands/deepseek.svg'), 'utf8');
const antigravitySvg = readFileSync(join(root, 'static/brands/antigravity.svg'), 'utf8');

function toBase64(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 2400px;
    height: 2400px;
    background: radial-gradient(circle at 50% 12%, #131d36 0%, #090e1c 55%, #050811 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #e4e8f3;
    padding: 64px 80px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 36px;
  }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 28px;
  }
  .logo-wrap {
    width: 90px;
    height: 90px;
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  }
  .logo-wrap svg { width: 100%; height: 100%; }
  .title-area h3 {
    font-size: 16px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    color: #7b8ebb;
    margin-bottom: 6px;
  }
  .title-area h1 {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: -1px;
    color: #ffffff;
    margin-bottom: 6px;
  }
  .title-area p {
    font-size: 22px;
    color: #94a3c4;
  }

  .header-badges {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .provider-pill {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    background: #141c2e;
    border: 1px solid rgba(130, 150, 200, 0.22);
    border-radius: 999px;
    font-size: 18px;
    font-weight: 600;
    color: #e2e8f0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }
  .provider-pill img {
    width: 24px;
    height: 24px;
    border-radius: 4px;
  }
  .provider-pill.active {
    border-color: rgba(99, 140, 255, 0.8);
    background: #19243d;
    box-shadow: 0 0 24px rgba(99, 140, 255, 0.35);
  }

  /* Grid layout */
  .grid-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 36px;
  }

  .panel-card {
    background: #0f1626;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 28px;
    padding: 34px;
    position: relative;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }
  .panel-tag {
    position: absolute;
    top: 24px;
    left: 28px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.8px;
    color: #8da4d0;
    text-transform: uppercase;
    background: rgba(40, 56, 92, 0.6);
    border: 1px solid rgba(130, 160, 220, 0.25);
    padding: 6px 14px;
    border-radius: 8px;
  }
  .panel-top-controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .control-pill {
    padding: 6px 16px;
    background: #172238;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    font-size: 14px;
    color: #8da0c4;
    font-weight: 500;
  }
  .control-pill.active {
    background: #2b457a;
    color: #fff;
    font-weight: 600;
  }

  /* Quota Provider Cards */
  .quota-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .agent-card {
    background: #141d30;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 20px;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .agent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .agent-identity {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .agent-name {
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
  }
  .agent-status {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #4ade80;
    background: rgba(74, 222, 128, 0.12);
    border: 1px solid rgba(74, 222, 128, 0.25);
    padding: 4px 10px;
    border-radius: 6px;
  }
  .agent-bar-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar-info {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
  }
  .bar-name {
    color: #9bb0d3;
    font-weight: 500;
  }
  .bar-val {
    font-weight: 700;
    color: #ffffff;
  }
  .bar-track {
    width: 100%;
    height: 8px;
    background: #1c2742;
    border-radius: 999px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
  }
  .bar-fill.blue { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
  .bar-fill.emerald { background: linear-gradient(90deg, #10b981, #34d399); }
  .bar-fill.purple { background: linear-gradient(90deg, #8b5cf6, #a78bfa); }
  .bar-fill.orange { background: linear-gradient(90deg, #f97316, #fb923c); }
  .bar-fill.red { background: linear-gradient(90deg, #ef4444, #f87171); }

  /* Token KPI Row */
  .kpi-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 24px;
    padding: 18px 22px;
    background: #141d30;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px;
  }
  .kpi-main h2 {
    font-size: 40px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 4px;
  }
  .kpi-main p {
    font-size: 13px;
    color: #7d90b8;
  }
  .kpi-stats {
    display: flex;
    gap: 24px;
  }
  .stat-item {
    text-align: right;
  }
  .stat-label {
    font-size: 12px;
    color: #7b8dae;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .stat-val {
    font-size: 19px;
    font-weight: 700;
    color: #e2e8f0;
  }

  /* Donut and trend chart */
  .charts-duo {
    display: grid;
    grid-template-columns: 270px 1fr;
    gap: 28px;
    align-items: center;
  }
  .donut-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .donut-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    justify-content: center;
    font-size: 12px;
    color: #8da4d0;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  /* Quota timeline */
  .timeline-container {
    background: #0f1626;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 28px;
    padding: 34px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    position: relative;
  }
  .timeline-lanes {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
  }
  .timeline-lane {
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .lane-label {
    width: 200px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 17px;
    font-weight: 700;
    color: #e2e8f0;
  }
  .lane-label img { width: 24px; height: 24px; border-radius: 4px; }
  .lane-track {
    flex: 1;
    height: 42px;
    background: #141c2e;
    border-radius: 12px;
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .lane-bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }

  /* Model breakdown full width */
  .model-card {
    background: #0f1626;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 28px;
    padding: 34px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    position: relative;
  }
  .model-table {
    width: 100%;
    margin-top: 16px;
    border-collapse: collapse;
  }
  .model-table th {
    text-align: left;
    font-size: 13px;
    color: #7184a8;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding-bottom: 14px;
  }
  .model-table td {
    padding: 16px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 16px;
  }
  .model-cell {
    display: flex;
    align-items: center;
    gap: 14px;
    font-weight: 700;
    color: #fff;
  }
  .model-sub {
    font-size: 13px;
    color: #7c8ea8;
    font-weight: 400;
    margin-top: 2px;
  }

  /* Local badge */
  .local-badge {
    position: absolute;
    bottom: 30px;
    right: 34px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 22px;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.35);
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    color: #34d399;
    letter-spacing: 1px;
  }
  .local-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 12px #34d399;
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    <div class="logo-wrap">${logoSvg}</div>
    <div class="title-area">
      <h3>Agent Usage</h3>
      <h1>Every agent. One usage view.</h1>
      <p>Native quotas, reset timelines, tokens, model rankings, and API retail equivalents — fully local.</p>
    </div>
  </div>
  <div class="header-badges">
    <div class="provider-pill"><img src="${toBase64(openaiSvg)}"> Codex</div>
    <div class="provider-pill"><img src="${toBase64(claudeSvg)}"> Claude Code</div>
    <div class="provider-pill"><img src="${toBase64(opencodeSvg)}"> OpenCode</div>
    <div class="provider-pill"><img src="${toBase64(grokSvg)}"> Grok</div>
    <div class="provider-pill"><img src="${toBase64(deepseekSvg)}"> dsh</div>
    <div class="provider-pill active"><img src="${toBase64(antigravitySvg)}"> Antigravity</div>
  </div>
</div>

<!-- Top row: AGENT QUOTAS & TOKENS/COSTS -->
<div class="grid-2col">

  <!-- Left: AGENT QUOTAS -->
  <div class="panel-card">
    <div class="panel-tag">Agent Quotas</div>
    <div class="panel-top-controls">
      <div class="control-pill active">Agent usage</div>
      <div class="control-pill">Tokens & costs</div>
      <div class="control-pill">Settings</div>
      <div class="control-pill">● System</div>
      <div class="control-pill">EN</div>
      <div class="control-pill">↻ Refresh</div>
    </div>

    <div class="quota-grid">
      <!-- Codex -->
      <div class="agent-card">
        <div class="agent-header">
          <div class="agent-identity">
            <img src="${toBase64(openaiSvg)}" width="24" height="24">
            <span class="agent-name">Codex</span>
          </div>
          <span class="agent-status">Connected</span>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">GPT-5.3-Codex-Spark · 5 hour</span>
            <span class="bar-val">0% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill blue" style="width: 2%;"></div></div>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">codex · Week</span>
            <span class="bar-val">90% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill orange" style="width: 90%;"></div></div>
        </div>
      </div>

      <!-- Claude Code -->
      <div class="agent-card">
        <div class="agent-header">
          <div class="agent-identity">
            <img src="${toBase64(claudeSvg)}" width="24" height="24">
            <span class="agent-name">Claude Code</span>
          </div>
          <span class="agent-status">Connected</span>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">5 hour</span>
            <span class="bar-val">6% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill emerald" style="width: 6%;"></div></div>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">Week · All models</span>
            <span class="bar-val">4% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill blue" style="width: 4%;"></div></div>
        </div>
      </div>

      <!-- Antigravity (NEW!) -->
      <div class="agent-card" style="border-color: rgba(66, 133, 244, 0.45); background: #13203a;">
        <div class="agent-header">
          <div class="agent-identity">
            <img src="${toBase64(antigravitySvg)}" width="24" height="24">
            <span class="agent-name">Antigravity</span>
          </div>
          <span class="agent-status" style="color: #60a5fa; background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.3);">Official Client</span>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">5 hour · Gemini Flash / Pro</span>
            <span class="bar-val">81% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill orange" style="width: 81%;"></div></div>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">Week · Gemini Flash / Pro</span>
            <span class="bar-val">18% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill blue" style="width: 18%;"></div></div>
        </div>
      </div>

      <!-- Grok -->
      <div class="agent-card">
        <div class="agent-header">
          <div class="agent-identity">
            <img src="${toBase64(grokSvg)}" width="24" height="24">
            <span class="agent-name">Grok</span>
          </div>
          <span class="agent-status">Connected</span>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">Weekly limit</span>
            <span class="bar-val">99% used</span>
          </div>
          <div class="bar-track"><div class="bar-fill red" style="width: 99%;"></div></div>
        </div>
        <div class="agent-bar-group">
          <div class="bar-info">
            <span class="bar-name">Shared pool allowance</span>
            <span class="bar-val">Active</span>
          </div>
          <div class="bar-track"><div class="bar-fill emerald" style="width: 100%;"></div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Right: TOKENS & MODEL COSTS -->
  <div class="panel-card">
    <div class="panel-tag">Tokens & Model Costs</div>
    <div class="panel-top-controls">
      <div class="control-pill">24h</div>
      <div class="control-pill active">7d</div>
      <div class="control-pill">30d</div>
      <div class="control-pill">CNY</div>
      <div class="control-pill active">USD</div>
    </div>

    <div class="kpi-row">
      <div class="kpi-main">
        <h2>$440.10</h2>
        <p>API retail equivalent value · 7-day range</p>
      </div>
      <div class="kpi-stats">
        <div class="stat-item">
          <div class="stat-label">Total Tokens</div>
          <div class="stat-val">981.2M</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Input</div>
          <div class="stat-val">668.5M</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Output</div>
          <div class="stat-val">133.6M</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Cache Read</div>
          <div class="stat-val">388.0M</div>
        </div>
      </div>
    </div>

    <div class="charts-duo">
      <div class="donut-wrap">
        <svg viewBox="0 0 100 100" width="170" height="170">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#2563eb" stroke-width="14" stroke-dasharray="140 100" stroke-dashoffset="0"/>
          <circle cx="50" cy="50" r="38" fill="none" stroke="#d97757" stroke-width="14" stroke-dasharray="60 180" stroke-dashoffset="-140"/>
          <circle cx="50" cy="50" r="38" fill="none" stroke="#10b981" stroke-width="14" stroke-dasharray="25 215" stroke-dashoffset="-200"/>
          <circle cx="50" cy="50" r="38" fill="none" stroke="#4285f4" stroke-width="14" stroke-dasharray="15 225" stroke-dashoffset="-225"/>
        </svg>
        <div class="donut-legend">
          <div class="legend-item"><span class="legend-dot" style="background: #2563eb"></span>Claude Code 58%</div>
          <div class="legend-item"><span class="legend-dot" style="background: #d97757"></span>dsh 26%</div>
          <div class="legend-item"><span class="legend-dot" style="background: #10b981"></span>Codex 9%</div>
          <div class="legend-item"><span class="legend-dot" style="background: #4285f4"></span>Antigravity 6%</div>
        </div>
      </div>

      <!-- Trend line chart SVG -->
      <div style="width: 100%; height: 190px; display: flex; flex-direction: column; justify-content: flex-end;">
        <svg viewBox="0 0 600 140" style="width: 100%; height: 140px; overflow: visible;">
          <defs>
            <linearGradient id="gradClaude" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="gradAntigravity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#4285f4" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#4285f4" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <line x1="0" y1="35" x2="600" y2="35" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4"/>
          <line x1="0" y1="70" x2="600" y2="70" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4"/>
          <line x1="0" y1="105" x2="600" y2="105" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4"/>
          <!-- Claude wave -->
          <path d="M0,90 Q100,50 200,80 T400,30 T600,45" fill="none" stroke="#3b82f6" stroke-width="3.5"/>
          <!-- Antigravity wave -->
          <path d="M0,120 Q120,95 240,110 T480,65 T600,75" fill="none" stroke="#4285f4" stroke-width="3" stroke-dasharray="6 3"/>
          <!-- Codex wave -->
          <path d="M0,110 Q150,115 300,90 T600,85" fill="none" stroke="#10b981" stroke-width="2.5"/>
        </svg>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #64748b; margin-top: 10px;">
          <span>Aug 27</span><span>Aug 28</span><span>Aug 29</span><span>Aug 30</span><span>Aug 31</span><span>Sep 01</span><span>Sep 02</span>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- Middle row: QUOTA TIMELINE (Full Width) -->
<div class="timeline-container">
  <div class="panel-tag">Quota Timeline</div>
  <div class="panel-top-controls">
    <div class="control-pill active">Week</div>
    <div class="control-pill">5 hour</div>
  </div>

  <div class="timeline-lanes">
    <!-- Codex -->
    <div class="timeline-lane">
      <div class="lane-label"><img src="${toBase64(openaiSvg)}"> Codex</div>
      <div class="lane-track">
        <div class="lane-bar" style="left: 8%; width: 78%; background: linear-gradient(90deg, #f59e0b, #d97706);">
          90% · Resets in 2d 11h
        </div>
      </div>
    </div>

    <!-- Claude Code -->
    <div class="timeline-lane">
      <div class="lane-label"><img src="${toBase64(claudeSvg)}"> Claude Code</div>
      <div class="lane-track">
        <div class="lane-bar" style="left: 5%; width: 45%; background: linear-gradient(90deg, #3b82f6, #2563eb);">
          4% · Resets in 5d 20h
        </div>
      </div>
    </div>

    <!-- Antigravity (NEW!) -->
    <div class="timeline-lane">
      <div class="lane-label"><img src="${toBase64(antigravitySvg)}"> Antigravity</div>
      <div class="lane-track">
        <div class="lane-bar" style="left: 12%; width: 68%; background: linear-gradient(90deg, #4285f4, #1a73e8);">
          18% Week (Resets in 6d 16h) · 81% 5h (Resets in 3h 21m)
        </div>
      </div>
    </div>

    <!-- OpenCode Go -->
    <div class="timeline-lane">
      <div class="lane-label"><img src="${toBase64(opencodeSvg)}"> OpenCode Go</div>
      <div class="lane-track">
        <div class="lane-bar" style="left: 18%; width: 42%; background: linear-gradient(90deg, #10b981, #059669);">
          Quota Healthy · Resets in 4d
        </div>
      </div>
    </div>
  </div>

  <div class="local-badge">
    <span class="local-dot"></span>
    LOCAL-FIRST · DATA STAYS ON YOUR MAC
  </div>
</div>

<!-- Bottom row: MODEL BREAKDOWN (Full Width) -->
<div class="model-card">
  <div class="panel-tag">Model Breakdown</div>
  <div class="panel-top-controls">
    <div class="control-pill active">Tokens</div>
    <div class="control-pill">Cost</div>
  </div>

  <table class="model-table">
    <thead>
      <tr>
        <th style="width: 32%;">Model</th>
        <th style="width: 36%;">Share</th>
        <th style="text-align: right; width: 16%;">Tokens</th>
        <th style="text-align: right; width: 16%;">API Retail Equiv</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="model-cell">
            <img src="${toBase64(claudeSvg)}" width="24" height="24">
            <div>
              <div>claude-3-7-sonnet</div>
              <div class="model-sub">Claude Code · Claude subscription</div>
            </div>
          </div>
        </td>
        <td>
          <div class="bar-track" style="height: 10px;"><div class="bar-fill blue" style="width: 58%;"></div></div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #fff; font-size: 18px;">572.3M</td>
        <td style="text-align: right; font-weight: 700; color: #e2e8f0; font-size: 18px;">$369.97</td>
      </tr>
      <tr>
        <td>
          <div class="model-cell">
            <img src="${toBase64(deepseekSvg)}" width="24" height="24">
            <div>
              <div>deepseek-reasoner</div>
              <div class="model-sub">dsh · DeepSeek API</div>
            </div>
          </div>
        </td>
        <td>
          <div class="bar-track" style="height: 10px;"><div class="bar-fill orange" style="width: 26%;"></div></div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #fff; font-size: 18px;">256.7M</td>
        <td style="text-align: right; font-weight: 700; color: #e2e8f0; font-size: 18px;">$2.67</td>
      </tr>
      <tr>
        <td>
          <div class="model-cell">
            <img src="${toBase64(openaiSvg)}" width="24" height="24">
            <div>
              <div>gpt-5.3-codex</div>
              <div class="model-sub">Codex · Codex subscription</div>
            </div>
          </div>
        </td>
        <td>
          <div class="bar-track" style="height: 10px;"><div class="bar-fill emerald" style="width: 9%;"></div></div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #fff; font-size: 18px;">90.9M</td>
        <td style="text-align: right; font-weight: 700; color: #e2e8f0; font-size: 18px;">$54.62</td>
      </tr>
      <tr style="background: rgba(66, 133, 244, 0.08);">
        <td>
          <div class="model-cell">
            <img src="${toBase64(antigravitySvg)}" width="24" height="24">
            <div>
              <div>gemini-3.7-flash <span style="font-size: 11px; font-weight: 700; background: rgba(59,130,246,0.3); color: #93c5fd; padding: 2px 8px; border-radius: 4px; margin-left: 6px;">NEW</span></div>
              <div class="model-sub">Antigravity · Gemini Code Assist</div>
            </div>
          </div>
        </td>
        <td>
          <div class="bar-track" style="height: 10px;"><div class="bar-fill blue" style="width: 6%; background: #4285f4;"></div></div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #fff; font-size: 18px;">60.1M</td>
        <td style="text-align: right; font-weight: 700; color: #e2e8f0; font-size: 18px;">$12.84</td>
      </tr>
    </tbody>
  </table>
</div>

</body>
</html>`;

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 2400, height: 2400 },
    deviceScaleFactor: 1
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const outPath = join(root, 'static/brand/agent-usage-showcase.jpg');
  await page.screenshot({
    path: outPath,
    type: 'jpeg',
    quality: 92
  });
  console.log('Successfully written showcase image to:', outPath);
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

// DERCKSEN Backtest — frontend logic

const RENDER_API_URL = "https://dercksen-backtest-api.onrender.com";

const STORAGE_KEYS = {
  results: 'dercksen_results_v1',
  portfolios: 'dercksen_custom_portfolios_v1',
};

let savedResults = [];
let customPortfolios = []; // [{name, filename, csvText, uploadedAt}]
let pendingDeleteIdx = null;
let latestResultIdx = null; // index into savedResults of the most recently run backtest

/* ---------- PERSISTENCE (localStorage) ---------- */
function loadFromStorage() {
  try {
    const r = localStorage.getItem(STORAGE_KEYS.results);
    savedResults = r ? JSON.parse(r) : [];
  } catch (e) { savedResults = []; }
  try {
    const p = localStorage.getItem(STORAGE_KEYS.portfolios);
    customPortfolios = p ? JSON.parse(p) : [];
  } catch (e) { customPortfolios = []; }
}

function persistResults() {
  try { localStorage.setItem(STORAGE_KEYS.results, JSON.stringify(savedResults)); }
  catch (e) { console.warn('Could not persist results (storage full or unavailable):', e); }
}

function persistPortfolios() {
  try { localStorage.setItem(STORAGE_KEYS.portfolios, JSON.stringify(customPortfolios)); }
  catch (e) { console.warn('Could not persist portfolios (storage full or unavailable):', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();

  /* ---------- TAB SWITCHING ---------- */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  /* ---------- STRATEGY CHECKBOX EXPAND ---------- */
  document.querySelectorAll('.strategy-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = cb.closest('.strategy-item');
      item.classList.toggle('expanded', cb.checked);
      updateStrategyPreview();
    });
  });

  /* ---------- LONG PUT: SHOW/HIDE CUSTOM BETA FIELD ---------- */
  document.querySelectorAll('.put-notional-method').forEach(select => {
    const row = select.closest('.strategy-fields').querySelector('.put-custom-beta-row');
    const toggle = () => { row.style.display = select.value === 'custom' ? '' : 'none'; };
    toggle();
    select.addEventListener('change', toggle);
  });

  /* ---------- LONG CALL: SHOW/HIDE FIXED VS WEIGHT SIZING FIELDS ---------- */
  document.querySelectorAll('.call-sizing-mode').forEach(select => {
    const fields = select.closest('.strategy-fields');
    const fixedRow = fields.querySelector('.call-fixed-row');
    const weightRow = fields.querySelector('.call-weight-row');
    const toggle = () => {
      const isFixed = select.value === 'fixed';
      fixedRow.style.display = isFixed ? '' : 'none';
      weightRow.style.display = isFixed ? 'none' : '';
    };
    toggle();
    select.addEventListener('change', toggle);
  });

  /* ---------- ANY STRATEGY FIELD CHANGE -> REFRESH PREVIEW ---------- */
  document.querySelectorAll('.strategy-fields input, .strategy-fields select').forEach(el => {
    el.addEventListener('input', updateStrategyPreview);
    el.addEventListener('change', updateStrategyPreview);
  });

  /* ---------- POPULATE PORTFOLIO SELECTS (default + custom) ---------- */
  function refreshPortfolioSelects() {
    document.querySelectorAll('.portfolio-select').forEach(select => {
      const currentVal = select.value;
      select.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = 'BAM_f7_default';
      defaultOpt.textContent = 'BAM_f7_default';
      select.appendChild(defaultOpt);
      customPortfolios.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + ' (custom)';
        select.appendChild(opt);
      });
      if ([...select.options].some(o => o.value === currentVal)) select.value = currentVal;
    });
  }
  refreshPortfolioSelects();

  /* ---------- STRATEGY SHAPE / PAYOFF PREVIEW ----------
     Long/Short Portfolio -> illustrative equity curve over time (unchanged).
     Option legs (long/short call/put) -> simulated payoff-at-maturity diagram:
       x-axis = spot price at maturity, expressed as % of spot at trade date.
       y-axis = P&L as % of notional, net of premium paid/received.
     Payoffs are computed directly from the strike/premium values entered
     in each leg's own fields, so the preview always reflects current inputs. */
  const PREVIEW_COLORS = {
    'long-portfolio': '#0f4c81',
    'short-portfolio': '#b3261e',
    'long-call': '#1a8a5f',
    'long-put': '#c98a1f',
    'short-call': '#6b46c1',
    'short-put': '#0e7490',
  };
  const PORTFOLIO_LABELS = {
    'long-portfolio': 'Long Portfolio (grows over time)',
    'short-portfolio': 'Short Portfolio (declines over time)',
  };

  function parsePct(str, fallback) {
    if (str === undefined || str === null || str === '') return fallback;
    const n = parseFloat(String(str).replace('%', '').trim());
    return isNaN(n) ? fallback : n / 100;
  }

  function optionLegParams(key, item) {
    switch (key) {
      case 'long-call':
        return {
          strike: parsePct(item.querySelector('.call-strike')?.value, 1.0),
          premium: parsePct(item.querySelector('.call-premium')?.value, 0),
        };
      case 'short-call':
        return {
          strike: parsePct(item.querySelector('.short-call-strike')?.value, 1.2),
          premium: parsePct(item.querySelector('.short-call-premium')?.value, 0),
        };
      case 'long-put':
        return {
          strike: parsePct(item.querySelector('.put-strike')?.value, 0.9),
          premium: parsePct(item.querySelector('.put-premium')?.value, 0),
        };
      case 'short-put':
        return {
          strike: parsePct(item.querySelector('.short-put-strike')?.value, 0.9),
          premium: parsePct(item.querySelector('.short-put-premium')?.value, 0),
        };
      default:
        return null;
    }
  }

  function optionPayoff(key, x, strike, premium) {
    switch (key) {
      case 'long-call': return Math.max(x - strike, 0) - premium;
      case 'short-call': return premium - Math.max(x - strike, 0);
      case 'long-put': return Math.max(strike - x, 0) - premium;
      case 'short-put': return premium - Math.max(strike - x, 0);
      default: return 0;
    }
  }

  function updateStrategyPreview() {
    const svg = document.getElementById('strategy-preview-svg');
    const legend = document.getElementById('strategy-preview-legend');
    const W = 600, H = 160;
    const PAD_L = 42, PAD_R = 14, PAD_T = 14, PAD_B = 22;

    const activeItems = Array.from(document.querySelectorAll('.strategy-item')).filter(item => {
      const cb = item.querySelector('.strategy-toggle');
      return cb && cb.checked;
    });

    if (activeItems.length === 0) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#6b7280">Select a strategy above to preview its shape</text>`;
      legend.innerHTML = '';
      return;
    }

    const portfolioItems = activeItems.filter(i => ['long-portfolio', 'short-portfolio'].includes(i.dataset.strategy));
    const optionItems = activeItems.filter(i => ['long-call', 'short-call', 'long-put', 'short-put'].includes(i.dataset.strategy));

    const svgParts = [];
    const legendItems = [];

    if (portfolioItems.length > 0) {
      svgParts.push(`<line x1="${PAD_L}" y1="${H - 15}" x2="${W - PAD_R}" y2="${H - 15}" stroke="#e3e6ea" stroke-width="1"/>`);
      portfolioItems.forEach(item => {
        const key = item.dataset.strategy;
        const color = PREVIEW_COLORS[key];
        if (key === 'long-portfolio') {
          svgParts.push(`<path d="M${PAD_L},${H - 30} Q${W * 0.45},${H * 0.55} ${W - PAD_R},${H * 0.18}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
        } else {
          svgParts.push(`<path d="M${PAD_L},${H * 0.18} Q${W * 0.45},${H * 0.55} ${W - PAD_R},${H - 30}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
        }
        legendItems.push({ label: PORTFOLIO_LABELS[key], color });
      });
    }

    if (optionItems.length > 0) {
      const legs = optionItems.map(item => {
        const key = item.dataset.strategy;
        const p = optionLegParams(key, item);
        return {
          key,
          color: PREVIEW_COLORS[key],
          label: item.querySelector('.strategy-check span').textContent,
          ...p,
        };
      }).filter(l => l.strike !== null && l.strike !== undefined && !isNaN(l.strike));

      if (legs.length > 0) {
        let xMin = 0.5, xMax = 1.5;
        legs.forEach(l => {
          xMin = Math.min(xMin, l.strike - 0.15);
          xMax = Math.max(xMax, l.strike + 0.15);
        });

        const xScale = x => PAD_L + ((x - xMin) / (xMax - xMin)) * (W - PAD_L - PAD_R);

        let yMin = 0, yMax = 0;
        const sampleXs = Array.from(new Set([xMin, xMax, ...legs.map(l => l.strike)]));
        legs.forEach(l => {
          sampleXs.forEach(sx => {
            const y = optionPayoff(l.key, sx, l.strike, l.premium);
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
          });
        });
        if (yMin === yMax) { yMin -= 0.05; yMax += 0.05; }
        const yPad = (yMax - yMin) * 0.15;
        yMin -= yPad; yMax += yPad;

        const plotTop = PAD_T, plotBottom = H - PAD_B;
        const yScale = y => plotBottom - ((y - yMin) / (yMax - yMin)) * (plotBottom - plotTop);

        svgParts.push(`<line x1="${PAD_L}" y1="${yScale(0).toFixed(1)}" x2="${W - PAD_R}" y2="${yScale(0).toFixed(1)}" stroke="#cbd2d9" stroke-width="1"/>`);

        if (xMin <= 1 && 1 <= xMax) {
          svgParts.push(`<line x1="${xScale(1).toFixed(1)}" y1="${plotTop}" x2="${xScale(1).toFixed(1)}" y2="${plotBottom}" stroke="#9aa4b2" stroke-width="1" stroke-dasharray="3,3"/>`);
          svgParts.push(`<text x="${xScale(1).toFixed(1)}" y="${plotBottom + 14}" font-size="9" fill="#6b7280" text-anchor="middle">100%</text>`);
        }
        svgParts.push(`<text x="${xScale(xMin).toFixed(1)}" y="${plotBottom + 14}" font-size="9" fill="#6b7280" text-anchor="start">${Math.round(xMin * 100)}%</text>`);
        svgParts.push(`<text x="${xScale(xMax).toFixed(1)}" y="${plotBottom + 14}" font-size="9" fill="#6b7280" text-anchor="end">${Math.round(xMax * 100)}%</text>`);
        svgParts.push(`<text x="${PAD_L - 6}" y="${plotTop + 8}" font-size="9" fill="#6b7280" text-anchor="end">${(yMax * 100).toFixed(0)}%</text>`);
        svgParts.push(`<text x="${PAD_L - 6}" y="${plotBottom}" font-size="9" fill="#6b7280" text-anchor="end">${(yMin * 100).toFixed(0)}%</text>`);
        svgParts.push(`<text x="${(PAD_L + W - PAD_R) / 2}" y="${H - 4}" font-size="9" fill="#6b7280" text-anchor="middle">Spot at maturity (% of spot now)</text>`);

        legs.forEach(l => {
          const xs = Array.from(new Set([xMin, l.strike, xMax])).sort((a, b) => a - b);
          const points = xs.map(x => `${xScale(x).toFixed(1)},${yScale(optionPayoff(l.key, x, l.strike, l.premium)).toFixed(1)}`).join(' ');
          svgParts.push(`<polyline points="${points}" fill="none" stroke="${l.color}" stroke-width="2.5"/>`);
          legendItems.push({
            label: `${l.label} (K=${Math.round(l.strike * 100)}%, prem=${(l.premium * 100).toFixed(2)}%)`,
            color: l.color,
          });
        });
      }
    }

    svg.innerHTML = svgParts.join('');
    legend.innerHTML = legendItems.map(li =>
      `<span><span class="legend-swatch" style="background:${li.color};"></span>${li.label}</span>`
    ).join('');
  }

  updateStrategyPreview();

  /* ---------- COLLECT LEGS FROM UI ---------- */
  function collectLegs() {
    const legs = [];

    document.querySelectorAll('.strategy-item').forEach(item => {
      const toggle = item.querySelector('.strategy-toggle');
      if (!toggle || !toggle.checked) return;

      const stratKey = item.dataset.strategy;
      const label = item.querySelector('.strategy-check span').textContent;

      if (stratKey === 'long-portfolio') {
        legs.push({
          key: 'long_portfolio', type: 'long_portfolio', label, enabled: true,
          params: {
            weight: item.querySelector('.lp-weight')?.value || '100%',
            portfolio: item.querySelector('.portfolio-select')?.value || 'BAM_f7_default',
          },
        });
      } else if (stratKey === 'short-portfolio') {
        legs.push({
          key: 'short_portfolio', type: 'short_portfolio', label, enabled: true,
          params: {
            weight: item.querySelector('.sp-weight')?.value || '100%',
            portfolio: item.querySelector('.portfolio-select')?.value || 'BAM_f7_default',
          },
        });
      } else if (stratKey === 'long-put') {
        legs.push({
          key: 'long_put', type: 'long_put', label, enabled: true,
          params: {
            strike: item.querySelector('.put-strike')?.value || '90%',
            premium: item.querySelector('.put-premium')?.value || '4%',
            notional_method: item.querySelector('.put-notional-method')?.value || 'real-beta',
            custom_beta: item.querySelector('.put-custom-beta')?.value || '',
          },
        });
      } else if (stratKey === 'long-call') {
        legs.push({
          key: 'long_call', type: 'long_call', label, enabled: true,
          params: {
            strike: item.querySelector('.call-strike')?.value || '100%',
            premium: item.querySelector('.call-premium')?.value || '9%',
            sizing_mode: item.querySelector('.call-sizing-mode')?.value || 'weight',
            fixed_pct: item.querySelector('.call-fixed-pct')?.value || '10%',
            weight_pct: item.querySelector('.call-weight-pct')?.value || '5%',
          },
        });
      } else if (stratKey === 'short-call') {
        legs.push({
          key: 'short_call', type: 'short_call', label, enabled: true,
          params: {
            strike: item.querySelector('.short-call-strike')?.value || '120%',
            premium: item.querySelector('.short-call-premium')?.value || '1.3%',
            notional: item.querySelector('.short-call-notional')?.value || '100%',
          },
        });
      } else if (stratKey === 'short-put') {
        legs.push({
          key: 'short_put', type: 'short_put', label, enabled: true,
          params: {
            strike: item.querySelector('.short-put-strike')?.value || '90%',
            premium: item.querySelector('.short-put-premium')?.value || '4.19%',
            notional: item.querySelector('.short-put-notional')?.value || '100%',
          },
        });
      }
    });

    return legs;
  }

  /* ---------- RUN BACKTEST ---------- */
  const runBtn = document.getElementById('run-backtest-btn');
  const runStatus = document.getElementById('run-status');
  const viewResultBtn = document.getElementById('view-result-btn');

  function showStatus(msg, isError, showSpinner) {
    runStatus.innerHTML = (showSpinner ? '<span class="spinner"></span>' : '') + msg;
    runStatus.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
  }

  runBtn.addEventListener('click', async () => {
    const name = document.getElementById('backtest-name').value.trim();
    const legs = collectLegs();

    viewResultBtn.classList.remove('show');

    if (!name) { showStatus('Please enter a backtest name.', true, false); return; }
    if (legs.length === 0) { showStatus('Select at least one strategy.', true, false); return; }

    const payload = {
      name,
      start_date: document.getElementById('start-date').value.trim(),
      end_date: document.getElementById('end-date').value.trim(),
      risk_free_rate: document.getElementById('risk-free-rate').value.trim(),
      legs,
    };

    showStatus('Running backtest...', false, true);
    runBtn.disabled = true;

    try {
      const res = await fetch(`${RENDER_API_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        showStatus(data.error || 'Backtest failed.', true, false);
        return;
      }

      data.created_at = new Date().toISOString();
      savedResults.push(data);
      persistResults();
      latestResultIdx = savedResults.length - 1;
      renderResultsList();
      showStatus('Backtest complete.', false, false);
      viewResultBtn.classList.add('show');
    } catch (err) {
      showStatus('Network error: ' + err.message, true, false);
    } finally {
      runBtn.disabled = false;
    }
  });

  viewResultBtn.addEventListener('click', () => {
    if (latestResultIdx !== null && savedResults[latestResultIdx]) {
      openDashboard(savedResults[latestResultIdx]);
    }
  });

  /* ---------- RESULTS LIST: accordion rows (matches .result-row-main / .result-caret / .result-details) ---------- */
  function fmtPct(v) {
    return (v === null || v === undefined || isNaN(v)) ? '--' : (v * 100).toFixed(2) + '%';
  }
  function fmtNum(v) {
    return (v === null || v === undefined || isNaN(v)) ? '--' : Number(v).toFixed(2);
  }

  function renderResultsList() {
    const list = document.getElementById('results-list');
    const empty = document.getElementById('results-empty');

    if (savedResults.length === 0) {
      list.innerHTML = '';
      list.appendChild(empty);
      return;
    }

    list.innerHTML = '';
    savedResults.forEach((r, idx) => {
      const m = (r.net && r.net.metrics) || {};
      const legLabels = Object.values(r.legs || {}).map(l => l.label).join(', ') || '--';

      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <div class="result-row-main" data-idx="${idx}">
          <button class="result-caret" tabindex="-1">&#9656;</button>
          <div class="result-name">
            ${r.name}
            <div class="result-tags">${legLabels}</div>
          </div>
          <div class="result-actions">
            <button class="btn-secondary view-btn" data-idx="${idx}">View Report</button>
            <button class="btn-secondary download-btn" data-idx="${idx}">Download HTML</button>
            <button class="btn-danger delete-btn" data-idx="${idx}">Delete</button>
          </div>
        </div>
        <div class="result-details">
          <dl>
            <dt>CAGR</dt><dd>${fmtPct(m.annualised_return)}</dd>
            <dt>Sharpe Ratio</dt><dd>${fmtNum(m.sharpe)}</dd>
            <dt>Sortino Ratio</dt><dd>${fmtNum(m.sortino)}</dd>
            <dt>Max Drawdown</dt><dd>${fmtPct(m.max_drawdown)}</dd>
            <dt>Calmar Ratio</dt><dd>${fmtNum(m.calmar)}</dd>
            <dt>Hit Rate</dt><dd>${fmtPct(m.hit_rate)}</dd>
            <dt>VaR (95%)</dt><dd>${fmtPct(m.var_95)}</dd>
            <dt>Backtest Length</dt><dd>${m.n_periods ?? '--'} periods</dd>
            <dt>Avg Turnover</dt><dd>${fmtPct(m.avg_turnover)}</dd>
          </dl>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('.result-row-main').forEach(main => {
      main.addEventListener('click', (e) => {
        if (e.target.closest('button') && !e.target.closest('.result-caret')) return;
        main.closest('.result-row').classList.toggle('expanded');
      });
    });
    list.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openDashboard(savedResults[parseInt(btn.dataset.idx, 10)]); });
    });
    list.querySelectorAll('.download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); downloadReportHtml(savedResults[parseInt(btn.dataset.idx, 10)]); });
    });
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(parseInt(btn.dataset.idx, 10)); });
    });
  }

  function openDashboard(result) {
    const modal = document.getElementById('dashboard-modal');
    const frame = document.getElementById('dashboard-frame');
    frame.srcdoc = result.dashboard_html
      || '<p style="padding:2rem;font-family:sans-serif;">Report not available for this backtest.</p>';
    modal.classList.remove('hidden');
  }

  function downloadReportHtml(result) {
    if (!result.dashboard_html) {
      alert('No report available to download for this backtest.');
      return;
    }
    const blob = new Blob([result.dashboard_html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (result.name || 'backtest_report').replace(/[^a-z0-9_\-]+/gi, '_');
    a.download = `${safeName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('dashboard-modal').classList.add('hidden');
  });

  function confirmDelete(idx) {
    pendingDeleteIdx = idx;
    document.getElementById('confirm-message').textContent =
      `Are you sure you want to delete "${savedResults[idx].name}"?`;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    pendingDeleteIdx = null;
  });

  document.getElementById('confirm-delete').addEventListener('click', () => {
    if (pendingDeleteIdx !== null) {
      savedResults.splice(pendingDeleteIdx, 1);
      persistResults();
      renderResultsList();
    }
    document.getElementById('confirm-modal').classList.add('hidden');
    pendingDeleteIdx = null;
  });

  /* ---------- DATA TAB: custom portfolio upload ---------- */
  function renderCustomPortfolioList() {
    const container = document.getElementById('custom-portfolio-list');
    if (customPortfolios.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No custom portfolios uploaded yet.</p>';
      return;
    }
    container.innerHTML = customPortfolios.map((p, idx) => `
      <div class="portfolio-list-row">
        <span>${p.name} <span class="tag">(${p.filename})</span></span>
        <button class="btn-danger delete-portfolio-btn" data-idx="${idx}">Remove</button>
      </div>
    `).join('');

    container.querySelectorAll('.delete-portfolio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        customPortfolios.splice(parseInt(btn.dataset.idx, 10), 1);
        persistPortfolios();
        renderCustomPortfolioList();
        refreshPortfolioSelects();
      });
    });
  }

  document.getElementById('upload-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('data-upload');
    const nameInput = document.getElementById('custom-portfolio-name');
    const file = fileInput.files[0];
    const name = nameInput.value.trim();

    if (!file) { alert('Choose a CSV file first.'); return; }
    if (!name) { alert('Give this portfolio a name.'); return; }
    if (customPortfolios.some(p => p.name === name)) { alert('A portfolio with this name already exists.'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      customPortfolios.push({
        name,
        filename: file.name,
        csvText: e.target.result,
        uploadedAt: new Date().toISOString(),
      });
      persistPortfolios();
      renderCustomPortfolioList();
      refreshPortfolioSelects();
      fileInput.value = '';
      nameInput.value = '';
    };
    reader.readAsText(file);
  });

  renderCustomPortfolioList();
  renderResultsList();
});

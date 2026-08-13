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

  /* ---------- FEES: SHOW/HIDE CUSTOM BENCHMARK RATE FIELD ---------- */
  const perfBenchmarkType = document.getElementById('perf-benchmark-type');
  const perfBenchmarkCustomRow = document.querySelector('.perf-benchmark-custom-row');
  function togglePerfBenchmarkCustomRow() {
    perfBenchmarkCustomRow.style.display = perfBenchmarkType.value === 'custom' ? '' : 'none';
  }
  togglePerfBenchmarkCustomRow();
  perfBenchmarkType.addEventListener('change', togglePerfBenchmarkCustomRow);

  /* ---------- ANY STRATEGY FIELD CHANGE -> REFRESH PREVIEW ---------- */
  document.querySelectorAll('.strategy-fields input, .strategy-fields select').forEach(el => {
    el.addEventListener('input', updateStrategyPreview);
    el.addEventListener('change', updateStrategyPreview);
  });

  /* ---------- INPUT VALIDATION ----------
     Live-highlights out-of-range or non-numeric values as the user types, and
     performs a full pre-submit check before a backtest is run. Bounds are
     generous sanity checks (catching fat-fingered typos), not narrow business
     rules -- mirrors the server-side bounds in app/routes.py so a value that
     passes here will also pass there. */
  const PERCENT_FIELD_RULES = [
    { id: 'risk-free-rate', min: -5, max: 25, label: 'Risk Free Rate' },
    { id: 'management-fee', min: 0, max: 10, label: 'Management Fee' },
    { id: 'performance-fee', min: 0, max: 100, label: 'Performance Fee' },
    { id: 'perf-benchmark-custom', min: -50, max: 50, label: 'Custom Benchmark Rate', optional: true },
    { selector: '.lp-weight', min: -500, max: 500, label: 'Long Portfolio Weight' },
    { selector: '.sp-weight', min: -500, max: 500, label: 'Short Portfolio Weight' },
    { selector: '.call-strike', min: 1, max: 500, label: 'Long Call Strike' },
    { selector: '.call-premium', min: 0, max: 100, label: 'Long Call Premium' },
    { selector: '.call-fixed-pct', min: 0, max: 500, label: 'Long Call Fixed Notional' },
    { selector: '.call-weight-pct', min: 0, max: 100, label: 'Long Call Weight Spend' },
    { selector: '.short-call-strike', min: 1, max: 500, label: 'Short Call Strike' },
    { selector: '.short-call-premium', min: 0, max: 100, label: 'Short Call Premium' },
    { selector: '.short-call-notional', min: 0, max: 1000, label: 'Short Call Notional' },
    { selector: '.put-strike', min: 1, max: 500, label: 'Long Put Strike' },
    { selector: '.put-premium', min: 0, max: 100, label: 'Long Put Premium' },
    { selector: '.short-put-strike', min: 1, max: 500, label: 'Short Put Strike' },
    { selector: '.short-put-premium', min: 0, max: 100, label: 'Short Put Premium' },
    { selector: '.short-put-notional', min: 0, max: 1000, label: 'Short Put Notional' },
  ];
  const NUMBER_FIELD_RULES = [
    { selector: '.put-custom-beta', min: -10, max: 10, label: 'Long Put Custom Beta', optional: true },
  ];

  function checkPercentValue(rawValue, min, max, optional) {
    if (rawValue === undefined || rawValue === null || rawValue.trim() === '') {
      return optional ? { valid: true } : { valid: false, reason: 'is required' };
    }
    const num = parseFloat(rawValue.replace('%', '').trim());
    if (isNaN(num)) return { valid: false, reason: 'is not a valid number' };
    if (num < min || num > max) return { valid: false, reason: `must be between ${min}% and ${max}%` };
    return { valid: true };
  }

  function checkNumberValue(rawValue, min, max, optional) {
    if (rawValue === undefined || rawValue === null || rawValue.trim() === '') {
      return optional ? { valid: true } : { valid: false, reason: 'is required' };
    }
    const num = parseFloat(rawValue.trim());
    if (isNaN(num)) return { valid: false, reason: 'is not a valid number' };
    if (num < min || num > max) return { valid: false, reason: `must be between ${min} and ${max}` };
    return { valid: true };
  }

  function elementsForRule(rule) {
    if (rule.id) {
      const el = document.getElementById(rule.id);
      return el ? [el] : [];
    }
    return Array.from(document.querySelectorAll(rule.selector));
  }

  function markFieldValidity(el, valid) {
    el.classList.toggle('invalid', !valid);
  }

  function attachLiveValidation(rule, checkFn) {
    elementsForRule(rule).forEach(el => {
      const revalidate = () => {
        const result = checkFn(el.value, rule.min, rule.max, rule.optional);
        markFieldValidity(el, result.valid);
      };
      el.addEventListener('input', revalidate);
      el.addEventListener('blur', revalidate);
      revalidate();
    });
  }

  PERCENT_FIELD_RULES.forEach(rule => attachLiveValidation(rule, checkPercentValue));
  NUMBER_FIELD_RULES.forEach(rule => attachLiveValidation(rule, checkNumberValue));

  /* Full pre-submit validation. Only checks fields belonging to enabled legs
     plus the always-relevant global/fee fields, so a hidden/unused leg's
     stale value never blocks a run. Returns a list of error message strings;
     empty list means valid. Also highlights every offending field. */
  function validateAllFields() {
    const errors = [];

    function checkRule(rule, checkFn) {
      elementsForRule(rule).forEach(el => {
        const item = el.closest('.strategy-item');
        if (item) {
          const toggle = item.querySelector('.strategy-toggle');
          if (!toggle || !toggle.checked) { markFieldValidity(el, true); return; }
        }
        if (rule.id === 'perf-benchmark-custom' && perfBenchmarkType.value !== 'custom') {
          markFieldValidity(el, true);
          return;
        }
        const result = checkFn(el.value, rule.min, rule.max, rule.optional);
        markFieldValidity(el, result.valid);
        if (!result.valid) errors.push(`${rule.label} ${result.reason}.`);
      });
    }

    PERCENT_FIELD_RULES.forEach(rule => checkRule(rule, checkPercentValue));
    NUMBER_FIELD_RULES.forEach(rule => {
      elementsForRule(rule).forEach(el => {
        const methodSelect = el.closest('.strategy-fields')?.querySelector('.put-notional-method');
        const isRelevant = !methodSelect || methodSelect.value === 'custom';
        const item = el.closest('.strategy-item');
        const toggle = item?.querySelector('.strategy-toggle');
        const enabled = toggle && toggle.checked;
        if (!enabled || !isRelevant) { markFieldValidity(el, true); return; }
        const result = checkNumberValue(el.value, rule.min, rule.max, rule.optional);
        markFieldValidity(el, result.valid);
        if (!result.valid) errors.push(`${rule.label} ${result.reason}.`);
      });
    });

    const dateRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    const startDateEl = document.getElementById('start-date');
    const endDateEl = document.getElementById('end-date');
    const startValid = dateRe.test(startDateEl.value.trim());
    const endValid = dateRe.test(endDateEl.value.trim());
    markFieldValidity(startDateEl, startValid);
    markFieldValidity(endDateEl, endValid);
    if (!startValid) errors.push('Start Date must be in YYYY-MM format.');
    if (!endValid) errors.push('End Date must be in YYYY-MM format.');
    if (startValid && endValid && endDateEl.value.trim() < startDateEl.value.trim()) {
      markFieldValidity(endDateEl, false);
      errors.push('End Date must not be before Start Date.');
    }

    return errors;
  }

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
     Long/Short Portfolio -> illustrative equity curve over time.
     Option legs (long/short call/put) -> simulated payoff-at-maturity diagram:
       x-axis = spot price at maturity, expressed as % of spot at trade date.
       y-axis = P&L as % of notional, net of premium paid/received.
     Payoffs are computed directly from the strike/premium values entered
     in each leg's own fields, so the preview always reflects current inputs. */
  const PREVIEW_COLORS = {
    'long-portfolio': '#1f5fbf',   // blue
    'short-portfolio': '#c0392b',  // red
    'long-put': '#d4af17',         // yellow
    'short-put': '#d4af17',        // yellow (dashed)
    'long-call': '#1a8a5f',        // green
    'short-call': '#1a8a5f',       // green (dashed)
  };
  const PREVIEW_DASH = {
    'short-put': '7,5',
    'short-call': '7,5',
  };
  const PORTFOLIO_LABELS = {
    'long-portfolio': 'Long Portfolio',
    'short-portfolio': 'Short Portfolio',
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
    const W = 600, H = 260;
    const PAD_L = 42, PAD_R = 14, PAD_T = 16, PAD_B = 28;

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
        legendItems.push({ label: PORTFOLIO_LABELS[key], color, dash: null });
      });
    }

    if (optionItems.length > 0) {
      const legs = optionItems.map(item => {
        const key = item.dataset.strategy;
        const p = optionLegParams(key, item);
        return {
          key,
          color: PREVIEW_COLORS[key],
          dash: PREVIEW_DASH[key] || null,
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
          svgParts.push(`<text x="${xScale(1).toFixed(1)}" y="${plotBottom + 16}" font-size="9" fill="#6b7280" text-anchor="middle">100%</text>`);
        }
        svgParts.push(`<text x="${xScale(xMin).toFixed(1)}" y="${plotBottom + 16}" font-size="9" fill="#6b7280" text-anchor="start">${Math.round(xMin * 100)}%</text>`);
        svgParts.push(`<text x="${xScale(xMax).toFixed(1)}" y="${plotBottom + 16}" font-size="9" fill="#6b7280" text-anchor="end">${Math.round(xMax * 100)}%</text>`);
        svgParts.push(`<text x="${PAD_L - 6}" y="${plotTop + 8}" font-size="9" fill="#6b7280" text-anchor="end">${(yMax * 100).toFixed(0)}%</text>`);
        svgParts.push(`<text x="${PAD_L - 6}" y="${plotBottom}" font-size="9" fill="#6b7280" text-anchor="end">${(yMin * 100).toFixed(0)}%</text>`);
        svgParts.push(`<text x="${(PAD_L + W - PAD_R) / 2}" y="${H - 6}" font-size="9" fill="#6b7280" text-anchor="middle">Spot at maturity (% of spot now)</text>`);

        legs.forEach(l => {
          const xs = Array.from(new Set([xMin, l.strike, xMax])).sort((a, b) => a - b);
          const points = xs.map(x => `${xScale(x).toFixed(1)},${yScale(optionPayoff(l.key, x, l.strike, l.premium)).toFixed(1)}`).join(' ');
          const dashAttr = l.dash ? ` stroke-dasharray="${l.dash}"` : '';
          svgParts.push(`<polyline points="${points}" fill="none" stroke="${l.color}" stroke-width="2.5"${dashAttr}/>`);
          legendItems.push({ label: l.label, color: l.color, dash: l.dash });
        });
      }
    }

    svg.innerHTML = svgParts.join('');
    legend.innerHTML = legendItems.map(li => {
      const swatchStyle = li.dash
        ? `background:repeating-linear-gradient(to right, ${li.color} 0 5px, transparent 5px 9px);`
        : `background:${li.color};`;
      return `<span><span class="legend-swatch" style="${swatchStyle}"></span>${li.label}</span>`;
    }).join('');
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
            portfolio: item.querySelector('.portfolio-select')?.value || 'BAM

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
  const togglePer

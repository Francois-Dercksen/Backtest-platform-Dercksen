// DERCKSEN Backtest — frontend logic

const RENDER_API_URL = "https://dercksen-backtest-api.onrender.com";

let savedResults = [];
let pendingDeleteIdx = null;

document.addEventListener('DOMContentLoaded', () => {

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
      updateFlowDiagram();
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

  function updateFlowDiagram() {
    const flow = document.getElementById('flow-diagram');
    const selected = Array.from(document.querySelectorAll('.strategy-toggle:checked'))
      .map(cb => cb.closest('.strategy-item').querySelector('span').textContent);

    if (selected.length === 0) {
      flow.innerHTML = '<p class="placeholder-text">Flow diagram will render here once a strategy is selected.</p>';
      return;
    }

    flow.innerHTML = selected.map(name =>
      `<div style="padding:0.7rem 1.2rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);margin:0 0.5rem;font-size:0.88rem;font-weight:600;color:var(--accent);">${name}</div>`
    ).join('<span style="color:var(--text-muted);font-size:1.2rem;">&rarr;</span>');
  }

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
          params: { weight: item.querySelector('.lp-weight')?.value || '100%' },
        });
      } else if (stratKey === 'short-portfolio') {
        legs.push({
          key: 'short_portfolio', type: 'short_portfolio', label, enabled: true,
          params: { weight: item.querySelector('.sp-weight')?.value || '100%' },
        });
      } else if (stratKey === 'long-put') {
        legs.push({
          key: 'long_put', type: 'long_put', label, enabled: true,
          params: {
            strike: item.querySelector('.put-strike')?.value || '90%',
            premium: item.querySelector('.put-premium')?.value || '4.19%',
            notional_method: item.querySelector('.put-notional-method')?.value || 'real-beta',
            custom_beta: item.querySelector('.put-custom-beta')?.value || '',
          },
        });
      } else if (stratKey === 'long-call') {
        legs.push({
          key: 'long_call', type: 'long_call', label, enabled: true,
          params: {
            strike: item.querySelector('.call-strike')?.value || '100%',
            premium: item.querySelector('.call-premium')?.value || '4.19%',
            sizing_mode: item.querySelector('.call-sizing-mode')?.value || 'fixed',
            fixed_pct: item.querySelector('.call-fixed-pct')?.value || '10%',
            weight_pct: item.querySelector('.call-weight-pct')?.value || '10%',
          },
        });
      } else if (stratKey === 'short-call') {
        legs.push({
          key: 'short_call', type: 'short_call', label, enabled: true,
          params: {
            strike: item.querySelector('.short-call-strike')?.value || '100%',
            premium: item.querySelector('.short-call-premium')?.value || '4%',
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

  function showStatus(msg, isError) {
    runStatus.textContent = msg;
    runStatus.style.color = isError ? 'var(--danger)' : 'var(--green, #1fae7a)';
  }

  runBtn.addEventListener('click', async () => {
    const name = document.getElementById('backtest-name').value.trim();
    const legs = collectLegs();

    if (!name) { showStatus('Please enter a backtest name.', true); return; }
    if (legs.length === 0) { showStatus('Select at least one strategy.', true); return; }

    const payload = {
      name,
      start_date: document.getElementById('start-date').value.trim(),
      end_date: document.getElementById('end-date').value.trim(),
      risk_free_rate: document.getElementById('risk-free-rate').value.trim(),
      legs,
    };

    showStatus('Running backtest...', false);
    runBtn.disabled = true;

    try {
      const res = await fetch(`${RENDER_API_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        showStatus(data.error || 'Backtest failed.', true);
        return;
      }

      data.created_at = new Date();
      savedResults.push(data);
      renderResultsList();
      showStatus('Backtest complete — view it in the Results tab.', false);
    } catch (err) {
      showStatus('Network error: ' + err.message, true);
    } finally {
      runBtn.disabled = false;
    }
  });

  /* ---------- RESULTS LIST (row-based table, matches original layout) ---------- */
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

    const table = document.createElement('table');
    table.className = 'results-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Strategies</th>
          <th>CAGR</th>
          <th>Sharpe</th>
          <th>Max DD</th>
          <th>Gearing (avg)</th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    savedResults.forEach((r, idx) => {
      const m = (r.net && r.net.metrics) || {};
      const periods = (r.net && r.net.periods) || [];
      const avgGearing = periods.length
        ? periods.reduce((s, p) => s + (p.net_gearing || 0), 0) / periods.length
        : null;
      const legLabels = Object.values(r.legs || {}).map(l => l.label).join(', ');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${legLabels || '--'}</td>
        <td>${fmtPct(m.annualised_return)}</td>
        <td>${fmtNum(m.sharpe)}</td>
        <td>${fmtPct(m.max_drawdown)}</td>
        <td>${avgGearing !== null ? avgGearing.toFixed(2) + 'x' : '--'}</td>
        <td class="row-actions">
          <button class="btn-secondary view-btn" data-idx="${idx}">View Report</button>
          <button class="btn-danger delete-btn" data-idx="${idx}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    list.innerHTML = '';
    list.appendChild(table);

    list.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => openDashboard(savedResults[parseInt(btn.dataset.idx, 10)]));
    });
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmDelete(parseInt(btn.dataset.idx, 10)));
    });
  }

  function openDashboard(result) {
    const modal = document.getElementById('dashboard-modal');
    const frame = document.getElementById('dashboard-frame');
    frame.srcdoc = result.dashboard_html
      || '<p style="padding:2rem;font-family:sans-serif;">Report not available for this backtest.</p>';
    modal.classList.remove('hidden');
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
      renderResultsList();
    }
    document.getElementById('confirm-modal').classList.add('hidden');
    pendingDeleteIdx = null;
  });

  renderResultsList();
});

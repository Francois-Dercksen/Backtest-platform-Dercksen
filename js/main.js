// DERCKSEN Backtest — frontend logic

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
      if (btn.dataset.tab === 'results') renderResults();
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

  /* ---------- FIELD COLLECTION HELPERS ---------- */
  function collectStrategyFields(item) {
    const fields = {};
    item.querySelectorAll('.field-row').forEach(row => {
      const label = row.querySelector('label').textContent;
      const input = row.querySelector('input, select');
      const value = input ? (input.value || '(placeholder)') : '(placeholder)';
      fields[label] = value;
    });
    return fields;
  }

  /* ---------- RUN BACKTEST (placeholder logic) ---------- */
  const runBtn = document.getElementById('run-backtest-btn');
  const runStatus = document.getElementById('run-status');

  runBtn.addEventListener('click', () => {
    const name = document.getElementById('backtest-name').value.trim();
    const selected = Array.from(document.querySelectorAll('.strategy-toggle:checked'));

    if (!name) {
      runStatus.textContent = 'Please enter a backtest name.';
      runStatus.style.color = 'var(--danger)';
      return;
    }
    if (selected.length === 0) {
      runStatus.textContent = 'Select at least one strategy.';
      runStatus.style.color = 'var(--danger)';
      return;
    }

    runStatus.textContent = 'Running backtest...';
    runStatus.style.color = 'var(--text-muted)';

    // Placeholder: in production this calls the backend API which runs
    // the calculation and returns/saves an HTML dashboard.
    setTimeout(() => {
      const globalParams = {
        'Start Date': document.getElementById('start-date').value,
        'End Date': document.getElementById('end-date').value,
        'Risk Free Rate': document.getElementById('risk-free-rate').value
      };

      const specs = selected.map(cb => {
        const item = cb.closest('.strategy-item');
        const strategyName = item.querySelector('span').textContent;
        return { strategy: strategyName, fields: collectStrategyFields(item) };
      });

      const backtest = {
        id: Date.now().toString(),
        name,
        createdAt: new Date().toLocaleString(),
        globalParams,
        specs,
        dashboardHtml: buildPlaceholderDashboard(name, globalParams, specs)
      };

      saveBacktest(backtest);
      runStatus.textContent = 'Backtest complete. View it in the Results tab.';
      runStatus.style.color = 'var(--accent)';
    }, 900);
  });

  function buildPlaceholderDashboard(name, globalParams, specs) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${name}</title>
    <style>body{font-family:sans-serif;padding:2rem;background:#fff;color:#1b1f27;}
    h1{color:#0f4c81;} .spec{margin-bottom:1rem;padding:1rem;border:1px solid #e3e6ea;border-radius:8px;}</style>
    </head><body><h1>${name}</h1><p>Placeholder results dashboard.</p>
    <div class="spec"><strong>Global Parameters</strong><br>${Object.entries(globalParams).map(([k,v]) => `${k}: ${v}`).join('<br>')}</div>
    ${specs.map(s => `<div class="spec"><strong>${s.strategy}</strong><br>${Object.entries(s.fields).map(([k,v]) => `${k}: ${v}`).join('<br>')}</div>`).join('')}
    </body></html>`;
  }

  /* ---------- RESULTS STORAGE (localStorage placeholder) ---------- */
  function getBacktests() {
    return JSON.parse(localStorage.getItem('dercksen_backtests') || '[]');
  }

  function saveBacktest(bt) {
    const all = getBacktests();
    all.unshift(bt);
    localStorage.setItem('dercksen_backtests', JSON.stringify(all));
    renderResults();
  }

  function deleteBacktest(id) {
    const all = getBacktests().filter(b => b.id !== id);
    localStorage.setItem('dercksen_backtests', JSON.stringify(all));
    renderResults();
  }

  function renderResults() {
    const list = document.getElementById('results-list');
    const all = getBacktests();

    if (all.length === 0) {
      list.innerHTML = '<p class="placeholder-text" id="results-empty">No backtests have been run yet.</p>';
      return;
    }

    list.innerHTML = all.map(bt => `
      <div class="result-row" data-id="${bt.id}">
        <div class="result-row-main">
          <button class="result-caret">&#9656;</button>
          <span class="result-name">${bt.name}</span>
          <span style="font-size:0.8rem;color:var(--text-muted);">${bt.createdAt}</span>
          <div class="result-actions">
            <button class="btn-secondary result-download">Download</button>
            <button class="btn-danger result-delete">Delete</button>
          </div>
        </div>
        <div class="result-details">
          <dl>
            ${Object.entries(bt.globalParams || {}).map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
            ${bt.specs.map(s => `<dt>${s.strategy}</dt><dd>${Object.entries(s.fields).map(([k,v]) => `${k}: ${v}`).join(', ')}</dd>`).join('')}
          </dl>
        </div>
      </div>
    `).join('');

    attachResultRowEvents();
  }

  function attachResultRowEvents() {
    document.querySelectorAll('.result-row').forEach(row => {
      const id = row.dataset.id;
      const bt = getBacktests().find(b => b.id === id);

      row.querySelector('.result-name').addEventListener('click', () => openDashboard(bt));

      row.querySelector('.result-caret').addEventListener('click', (e) => {
        e.stopPropagation();
        row.classList.toggle('expanded');
      });

      row.querySelector('.result-download').addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDashboard(bt);
      });

      row.querySelector('.result-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirmDelete(id);
      });
    });
  }

  function openDashboard(bt) {
    const frame = document.getElementById('dashboard-frame');
    frame.srcdoc = bt.dashboardHtml;
    document.getElementById('dashboard-modal').classList.remove('hidden');
  }

  function downloadDashboard(bt) {
    const blob = new Blob([bt.dashboardHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bt.name.replace(/\s+/g, '_')}_dashboard.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- MODALS ---------- */
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('dashboard-modal').classList.add('hidden');
  });

  let pendingDeleteId = null;

  function showConfirmDelete(id) {
    pendingDeleteId = id;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  document.getElementById('confirm-cancel').addEventListener('click', () => {
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.add('hidden');
  });

  document.getElementById('confirm-delete').addEventListener('click', () => {
    if (pendingDeleteId) deleteBacktest(pendingDeleteId);
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.add('hidden');
  });

  /* ---------- DATA TAB (placeholder) ---------- */
  document.getElementById('upload-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('data-upload');
    if (fileInput.files.length === 0) return;
    const fileName = fileInput.files[0].name;
    const list = document.getElementById('data-file-list');
    const row = document.createElement('div');
    row.className = 'data-file-row';
    row.innerHTML = `<span>${fileName}</span><span style="color:var(--text-muted);">(pending backend upload)</span>`;
    list.appendChild(row);
    fileInput.value = '';

    // Placeholder: newly uploaded portfolio CSVs should also appear
    // as options in the Long/Short Portfolio comboboxes once backend exists.
  });

  /* ---------- INITIAL RENDER ---------- */
  renderResults();
});

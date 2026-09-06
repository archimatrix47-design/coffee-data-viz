/**
 * What is currently selected: in the URL, and on screen as chips.
 *
 * Both halves answer the same question, so they live together. Before this, neither existed:
 * a filtered view could not be shared, bookmarked or reloaded, and nothing on the page told
 * you what was filtered except the controls themselves, which you have to go and read one at
 * a time. The chip styles were already sitting in shared.css, referenced by nothing.
 *
 * The URL carries only what differs from the page's defaults, so a default view has a clean
 * address and a shared link says exactly what was changed and nothing else.
 */

(function () {
  // ------------------------------------------------------------------ url state

  /**
   * Read overrides out of the query string, coerced to the type of each default.
   * Unknown keys are ignored, so a stale link cannot inject state the page does not have.
   */
  window.readUrlState = function (defaults) {
    const q = new URLSearchParams(location.search);
    const out = {};
    for (const [k, def] of Object.entries(defaults)) {
      if (!q.has(k)) continue;
      const raw = q.get(k);
      if (typeof def === 'number') { const n = +raw; if (Number.isFinite(n)) out[k] = n; }
      else if (typeof def === 'boolean') out[k] = raw === '1' || raw === 'true';
      else out[k] = raw;
    }
    return out;
  };

  /**
   * Write the non-default values back. replaceState, not pushState: dragging a year handle
   * would otherwise stack a hundred history entries and make the back button useless.
   */
  window.writeUrlState = function (state, defaults) {
    const q = new URLSearchParams();
    for (const [k, def] of Object.entries(defaults)) {
      const v = state[k];
      if (v == null || v === def) continue;
      q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    const s = q.toString();
    history.replaceState(null, '', s ? location.pathname + '?' + s : location.pathname);
  };

  // ------------------------------------------------------------------ chips

  /**
   * Render the active filters. Each chip clears just itself, because being made to reset
   * everything to change one thing is the complaint people actually have about filter bars.
   *
   * @param items [{ key, label, value, clear }] already filtered to what is not default
   */
  window.renderChips = function (host, items, onClearAll) {
    if (!host) return;
    host.innerHTML = '';
    if (!items.length) { host.hidden = true; return; }
    host.hidden = false;

    host.appendChild(Object.assign(document.createElement('span'), {
      className: 'chips-label', textContent: 'Filtered to',
    }));

    for (const it of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = `<span class="chip-k">${it.label}</span><b>${it.value}</b>`
        + `<span class="chip-x" aria-hidden="true">×</span>`;
      chip.setAttribute('aria-label', `${it.label}: ${it.value}. Activate to clear this filter.`);
      chip.addEventListener('click', it.clear);
      host.appendChild(chip);
    }

    if (items.length > 1 && onClearAll) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'chip chip-clear';
      all.textContent = 'Clear all';
      all.addEventListener('click', onClearAll);
      host.appendChild(all);
    }
  };
})();

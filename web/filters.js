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


  // ------------------------------------------------------------------ fetching

  /**
   * Fetch JSON and fail with what the server actually said.
   *
   * The server's error handler already returns { error, stack } precisely so a bad query can
   * be told apart from a broken server. Every caller here used to discard it: the data
   * fetches threw a bare `API 500`, and the /api/meta calls in each page's boot did not check
   * the status at all, so an error body was parsed as if it were meta and the first field
   * access threw "Cannot read properties of undefined (reading 'map')". That is the message a
   * deploy failure produced, and it names neither the endpoint nor the cause.
   *
   * A 200 carrying the wrong shape has to fail here too, not three lines later somewhere
   * that has no idea a request was involved.
   */
  window.fetchJSON = async function (url, expect) {
    let res, text;
    try {
      res = await fetch(url);
      text = await res.text();
    } catch (e) {
      throw new Error(`${url} could not be reached: ${e.message}`);
    }

    let body = null;
    try { body = JSON.parse(text); } catch { /* handled below */ }

    if (!res.ok) {
      // A stack means the server broke; no stack means the query was rejected. Worth
      // separating, because only one of them is the reader's fault.
      const NL = String.fromCharCode(10);
      if (body && body.stack) console.error(`${url} -> ${res.status}` + NL + body.stack.join(NL));
      else console.error(`${url} -> ${res.status}`, body ?? text.slice(0, 500));
      throw new Error(body?.error || `${url} returned ${res.status}`);
    }

    if (body === null) {
      console.error(`${url} returned 200 but not JSON:`, text.slice(0, 500));
      throw new Error(`${url} returned ${res.status} but the body was not JSON`);
    }

    // Guards against a 200 whose body is an error object, which is what a function that
    // failed at import looks like from the browser.
    if (expect && !(expect in body)) {
      console.error(`${url} returned 200 without "${expect}":`, body);
      throw new Error(body.error || body.errorMessage
        || `${url} returned 200 but no "${expect}" field`);
    }
    return body;
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

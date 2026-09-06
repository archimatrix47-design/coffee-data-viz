/**
 * The time range control.
 *
 * Two separate sliders for "year" and "span" made the reader do arithmetic to work out
 * what window they had selected. This is one dual-handle range over the whole record,
 * with the world's volume for the current filters drawn behind the track, so the
 * interesting years are visible before you scrub into them rather than being found by
 * hunting.
 *
 * Presets come before the custom range, which is the order people actually reach for
 * them. Play walks the window forward a year at a time so a trend can be watched
 * rather than reconstructed from stills.
 *
 * Reduced motion disables Play entirely: it is a looping animation, and the guidance
 * is unambiguous about those.
 */

(function () {
  const SPRING = { stiffness: 280, damping: 18, mass: 0.3 };   // sliding-number, for the readout

  window.TimeRange = function (host, opts) {
    const years = opts.years;
    const first = years[0], last = years[years.length - 1];
    let from = opts.from ?? last, to = opts.to ?? last;
    let series = null, playing = false, timer = null;
    const onChange = opts.onChange || (() => {});
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    host.classList.add('timerange');
    host.innerHTML = `
      <div class="tr-head">
        <span class="ctl-label">Years</span>
        <output class="tr-readout" id="trReadout"></output>
        <div class="tr-presets" role="group" aria-label="Range presets"></div>
        <button class="tr-play" type="button" aria-label="Play through the years" title="Play through the years">
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M3 1.6 11 6.5 3 11.4 Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="tr-track" tabindex="-1">
        <svg class="tr-spark" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="tr-rail"></div>
        <div class="tr-sel"></div>
        <input class="tr-h tr-from" type="range" aria-label="First year">
        <input class="tr-h tr-to" type="range" aria-label="Last year">
        <div class="tr-ticks"></div>
      </div>`;

    const $ = (s) => host.querySelector(s);
    const readout = $('.tr-readout'), sel = $('.tr-sel');
    const hFrom = $('.tr-from'), hTo = $('.tr-to');
    const spark = $('.tr-spark'), ticks = $('.tr-ticks'), play = $('.tr-play');

    for (const h of [hFrom, hTo]) { h.min = first; h.max = last; h.step = 1; }

    const PRESETS = [
      { id: 'latest', label: 'Latest', get: () => [last, last] },
      { id: '5y', label: '5 yr', get: () => [last - 4, last] },
      { id: '10y', label: '10 yr', get: () => [last - 9, last] },
      { id: 'c21', label: 'Since 2000', get: () => [Math.max(first, 2000), last] },
      { id: 'all', label: 'All', get: () => [first, last] },
    ];
    $('.tr-presets').innerHTML = PRESETS
      .map((p) => `<button type="button" class="tr-preset" data-id="${p.id}">${p.label}</button>`).join('');

    // ---- rendering -------------------------------------------------------

    const pct = (y) => ((y - first) / (last - first)) * 100;

    function paint() {
      const a = Math.min(from, to), b = Math.max(from, to);
      sel.style.left = pct(a) + '%';
      sel.style.width = (pct(b) - pct(a)) + '%';
      readout.textContent = a === b ? String(a) : `${a}–${b}`;
      hFrom.value = a; hTo.value = b;
      for (const el of host.querySelectorAll('.tr-preset')) {
        const p = PRESETS.find((x) => x.id === el.dataset.id);
        const [pa, pb] = p.get();
        el.setAttribute('aria-pressed', String(pa === a && pb === b));
      }
      paintSpark();
    }

    /** The volume profile behind the track: in-range bars solid, the rest ghosted. */
    function paintSpark() {
      if (!series || !series.length) { spark.innerHTML = ''; return; }
      const w = 100, h = 100;                       // drawn in a stretched viewBox
      spark.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const max = Math.max(...series.map((s) => s.value)) || 1;
      const a = Math.min(from, to), b = Math.max(from, to);
      const bw = w / series.length;
      spark.innerHTML = series.map((s, i) => {
        const bh = (s.value / max) * h;
        const inRange = s.year >= a && s.year <= b;
        return `<rect x="${(i * bw).toFixed(2)}" y="${(h - bh).toFixed(2)}"
          width="${(bw * 0.82).toFixed(2)}" height="${bh.toFixed(2)}"
          class="${inRange ? 'in' : 'out'}"/>`;
      }).join('');
    }

    function tickMarks() {
      const step = (last - first) > 25 ? 10 : 5;
      const out = [];
      for (let y = Math.ceil(first / step) * step; y <= last; y += step) {
        out.push(`<span style="left:${pct(y)}%">${y}</span>`);
      }
      ticks.innerHTML = out.join('');
    }

    function commit(a, b, source) {
      from = Math.max(first, Math.min(last, a));
      to = Math.max(first, Math.min(last, b));
      if (from > to) [from, to] = [to, from];
      paint();
      onChange({ from, to, source });
    }

    // ---- input -----------------------------------------------------------

    hFrom.addEventListener('input', () => commit(+hFrom.value, to, 'drag'));
    hTo.addEventListener('input', () => commit(from, +hTo.value, 'drag'));

    $('.tr-presets').addEventListener('click', (e) => {
      const b = e.target.closest('.tr-preset'); if (!b) return;
      const p = PRESETS.find((x) => x.id === b.dataset.id);
      stop();
      const [a, z] = p.get();
      commit(a, z, 'preset');
    });

    function step() {
      const width = to - from;
      if (to >= last) commit(first, first + width, 'play');
      else commit(from + 1, to + 1, 'play');
    }
    function start() {
      if (reduced.matches) return;
      playing = true; play.setAttribute('aria-pressed', 'true'); host.classList.add('is-playing');
      timer = setInterval(step, 900);
    }
    function stop() {
      playing = false; play.setAttribute('aria-pressed', 'false'); host.classList.remove('is-playing');
      if (timer) { clearInterval(timer); timer = null; }
    }
    play.addEventListener('click', () => (playing ? stop() : start()));
    if (reduced.matches) { play.disabled = true; play.title = 'Disabled while reduced motion is on'; }

    // Arrow keys nudge the whole window when the track has focus.
    host.querySelector('.tr-track').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      commit(from + d, to + d, 'keys');
    });

    tickMarks(); paint();

    return {
      get value() { return { from: Math.min(from, to), to: Math.max(from, to) }; },
      set(a, b) { commit(a, b, 'api'); },
      stop,
      /** Feed it the world profile for the current filters. */
      setSeries(s) { series = s; paintSpark(); },
    };
  };
})();

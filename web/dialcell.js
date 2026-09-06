/**
 * One dial cell: the spec, and the one painter that draws it.
 *
 * The breakdown page and the poster were each drawing this themselves, and they drifted:
 * the poster lost the year bars entirely when the dial was rebuilt, then got them back at
 * the wrong size and shape. So the cell is specified once, here, and painted once, here.
 * The study page, the grid and the poster all call paintDialCell; the only thing they are
 * allowed to vary is the palette and whether hover is attached. Nothing downstream decides
 * geometry, so nothing downstream can drift again.
 *
 * THE FUNNEL'S PROPORTIONS ARE MEASURED OFF THE REFERENCE and are not free parameters.
 * Taking the disc radius R as the unit:
 *
 *     line offset from centre  0.335 R      intake trend, width   0.62 R
 *     line height              0.60 R       intake trend, height  0.20 R
 *     trend baseline           0.06 R above the centre line
 *     name baseline            0.28 R below the trend
 *
 * The first two are the measured ones and carry the form. The line has to be SHORT next to the disc: that is what
 * makes each ribbon narrow where it leaves the line and wide where it meets the rim. A line
 * the full height of the disc gives every ribbon the same width at both ends and the funnel
 * disappears, which is the mistake this file exists to prevent.
 *
 * The intake series is one stroked line, not a bar chart. At this size a bar chart is five
 * or more separate shapes competing with the disc beside it for the reader's attention, and
 * the only question it has to answer is whether this buyer is taking more or less than it
 * used to. One line answers that in one shape, and takes a third of the room.
 */

(function () {
  const TREND_W   = 0.62;   // of R
  const TREND_H   = 0.20;
  const TREND_LIFT = 0.06;  // trend baseline above the disc's centre line
  const TREND_GAP = 0.18;   // clearance between the trend and the divided line
  const NAME_DROP = 0.28;   // first name baseline below the trend
  const LABEL_GAP = 0.05;   // clearance between the name/total and the line

  window.dialCell = function ({ imp, W, H, R, maxRibbons = 9, labelSize = 12, lineOffset }) {
    const padRight = Math.max(2, W * 0.015);
    const cx = W - R - padRight;
    const cy = H / 2;

    const dial = window.funnelDial({ sources: imp.sources, total: imp.qty, R, maxRibbons, lineOffset });
    const lineAbsX = cx + dial.line.x;          // everything to the left is laid out from here

    // The trend stops short of the divided line rather than running into it. Butted up, the
    // two read as one object and the eye tries to follow the trend into the funnel, which is
    // a different chart about a different thing.
    const trendRight = lineAbsX - R * TREND_GAP;
    const colW = trendRight - W * 0.03;
    const trendW = Math.max(16, Math.min(colW, R * TREND_W));
    const trendH = Math.max(6, R * TREND_H);
    const trendX = trendRight - trendW;
    const baseline = cy - R * TREND_LIFT;
    const trendTop = baseline - trendH;

    // The trend is scaled to this country's own range, not a shared one, so it reads as a
    // direction of travel rather than as a size. Size is already printed underneath, and a
    // shared scale would flatten every small buyer into an unreadable horizontal.
    const series = (imp.series || []).filter((s) => Number.isFinite(s.qty));
    let trend = null;
    const yearLabels = [];
    if (series.length > 1) {
      const max = Math.max(...series.map((s) => s.qty)) || 1;
      const min = Math.min(...series.map((s) => s.qty));
      // The floor sits a little under the smallest year rather than at zero, which keeps a
      // real movement visible: zero-based, a buyer whose intake shifted 5% draws a flat line.
      const lo = min - (max - min) * 0.35;
      const span = max - lo || 1;
      const step = series.length > 1 ? trendW / (series.length - 1) : 0;
      const pts = series.map((s, i) => [
        trendX + i * step,
        baseline - ((s.qty - lo) / span) * trendH,
      ]);
      trend = {
        d: pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
        end: { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], r: Math.max(0.9, R * 0.035) },
        width: Math.max(0.7, R * 0.028),
      };

      // One compact range, not a year at each end. Two labels needed more width than the
      // trend now has and ran into each other. The range still has to be printed per cell
      // rather than left to the title: it is not always the window that was asked for, and
      // a country whose reporting stops early has to show the shorter one.
      const first = series[0].year, last = series[series.length - 1].year;
      const sameCentury = Math.floor(first / 100) === Math.floor(last / 100);
      yearLabels.push({
        x: trendRight,
        y: trendTop - Math.max(5.5, labelSize * 0.62) * 0.5,
        text: first === last ? String(first)
          : `${first}–${sameCentury ? String(last).slice(-2) : last}`,
        anchor: 'end',
        size: Math.max(5.5, labelSize * 0.62),
      });
    }

    // The labels stop short of the line rather than butting against it. They sit at the
    // same height as the line's lower half, which is exactly where the largest ribbon
    // leaves it, so touching the line means touching that ribbon.
    const labelX = lineAbsX - R * LABEL_GAP;

    // Name wraps to a second line rather than ellipsing: a truncated country name tells the
    // reader nothing they did not already know. 0.62em per character is the monospace
    // advance the poster uses; assuming the narrower proportional figure overran the cell.
    const room = Math.max(6, Math.floor((labelX - W * 0.02) / (labelSize * 0.62)));
    const full = window.shortCountryName(imp.name, 0);
    const nameLines = [];
    if (full.length <= room) nameLines.push(full);
    else {
      let cur = '';
      for (const word of full.split(' ')) {
        if ((cur + ' ' + word).trim().length > room && cur) { nameLines.push(cur); cur = word; }
        else cur = (cur + ' ' + word).trim();
        if (nameLines.length === 2) break;
      }
      if (nameLines.length < 2 && cur) nameLines.push(cur);
      if (nameLines.length === 2 && nameLines[1].length > room) nameLines[1] = nameLines[1].slice(0, room - 1) + '…';
    }

    const nameY = baseline + Math.max(labelSize * 1.1, R * NAME_DROP);
    const name = nameLines.map((text, i) => ({
      x: labelX, y: nameY + i * labelSize * 1.12, text, size: labelSize, anchor: 'end',
    }));

    return {
      centre: { x: cx, y: cy },
      ribbons: dial.bands,                       // { d, source, share }, dial-local coords
      line: { x: dial.line.x, yTop: dial.line.yTop, height: dial.line.height },
      trend, yearLabels, name,
      total: {
        x: labelX,
        y: nameY + nameLines.length * labelSize * 1.12,
        size: labelSize * 0.9,
        anchor: 'end',
      },
    };
  };

  // ------------------------------------------------------------------- the painter

  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]);
    return e;
  };
  const txt = (s, a) => { const e = el('text', a); e.textContent = s; return e; };

  /**
   * Paint a spec into `host` (any SVG element). Returns the ribbon nodes paired with their
   * bands, so a caller that wants hover can attach it without knowing the layout.
   *
   * opts.fill(band) is the only thing a caller is normally expected to supply.
   */
  window.paintDialCell = function (host, cell, opts) {
    const o = Object.assign({
      ink: '#000', dim: '#888', trend: '#999', trendOpacity: 1,
      stroke: '#fff', strokeWidth: 0.5, lineOpacity: 0.35,
      totalText: '', fill: () => '#ccc',
    }, opts);

    // Order matters. The disc goes down first and the labels last: a long country name
    // reaches to within a hair of the line, and if the ribbons were painted over it the
    // name would be the part that disappeared.
    if (cell.trend) {
      host.appendChild(el('path', {
        d: cell.trend.d, fill: 'none', stroke: o.trend, 'stroke-opacity': o.trendOpacity,
        'stroke-width': cell.trend.width.toFixed(2),
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      // One dot on the last year, so the direction of travel is not ambiguous at this size.
      host.appendChild(el('circle', {
        cx: cell.trend.end.x.toFixed(1), cy: cell.trend.end.y.toFixed(1),
        r: cell.trend.end.r.toFixed(2), fill: o.trend, 'fill-opacity': o.trendOpacity,
      }));
    }

    const g = el('g', { transform: `translate(${cell.centre.x.toFixed(1)},${cell.centre.y.toFixed(1)})` });
    const ribbons = cell.ribbons.map((b) => {
      const p = el('path', { d: b.d, fill: o.fill(b), stroke: o.stroke, 'stroke-width': o.strokeWidth });
      g.appendChild(p);
      return { node: p, band: b };
    });
    g.appendChild(el('line', {
      x1: cell.line.x.toFixed(1), x2: cell.line.x.toFixed(1),
      y1: cell.line.yTop.toFixed(1), y2: (cell.line.yTop + cell.line.height).toFixed(1),
      stroke: o.ink, 'stroke-width': 0.8, opacity: o.lineOpacity,
    }));
    host.appendChild(g);

    for (const l of cell.yearLabels) {
      host.appendChild(txt(l.text, { x: l.x.toFixed(1), y: l.y.toFixed(1),
        'text-anchor': l.anchor, fill: o.dim, 'font-size': l.size.toFixed(1) }));
    }
    for (const l of cell.name) {
      host.appendChild(txt(l.text, { x: l.x.toFixed(1), y: l.y.toFixed(1),
        'text-anchor': l.anchor, fill: o.ink, 'font-size': l.size.toFixed(1), 'font-weight': 700 }));
    }
    host.appendChild(txt(o.totalText, { x: cell.total.x.toFixed(1), y: cell.total.y.toFixed(1),
      'text-anchor': cell.total.anchor, fill: o.dim, 'font-size': cell.total.size.toFixed(1) }));

    return ribbons;
  };
})();

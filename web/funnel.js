/**
 * The funnel dial, pure geometry, no DOM.
 *
 * One buying country. A short vertical line on the left is divided by share, and each
 * origin leaves its slot on that line and flares out to a matching sector of the disc's
 * edge. Narrow at the line, wide at the arc: that widening is the whole form, and it
 * only happens because the line is short. A line the full height of the disc gives every
 * ribbon the same width at both ends and the funnel disappears, which is the mistake
 * this module exists to stop anyone repeating.
 *
 * Proportions measured off the reference SVG: the line sits 0.335R left of centre, is 0.30 of the diameter tall, and the
 * disc shows about 228° of arc, the rest being cut away by the line's chord.
 *
 * Returns path strings only. The page renders them with d3, the poster builds raw SVG
 * nodes, and the study page drives them from sliders, one geometry, three callers, so
 * they cannot drift apart.
 */

(function () {
  const LINE_OFFSET = 0.335;      // how far left of centre the divided line sits
  const DEFAULT_LINE_H = 0.30;    // line height as a fraction of the disc diameter

  /**
   * @param sources  [{ value, ... }] largest first
   * @param total    the buyer's whole intake (shares are taken against this)
   * @param R        disc radius
   * @param lineH    line height as a fraction of 2R
   * @param lineOffset  how far left of centre the line sits, as a fraction of R. This, and
   *   only this, sets how far the arc opens: the chord through the line cuts the rest away,
   *   so pushing the line out closes the arc and pulling it toward the centre opens it
   *   toward a full circle. It is deliberately a fraction of R rather than an absolute
   *   distance, which makes the angle scale-invariant. Radius is a size channel and must not
   *   move the angle: in the grid it carries the buyer's volume, and if it changed the shape
   *   as well, no two dials would be comparable.
   * @param maxRibbons  beyond this the tail is pooled, so the form never turns to fluff
   */
  window.funnelDial = function ({ sources, total, R, lineH = DEFAULT_LINE_H,
                                 lineOffset = LINE_OFFSET, maxRibbons = 9 }) {
    const live = (sources || []).filter((s) => s.value > 0);

    // Pool the tail into one ribbon rather than drawing hairlines nobody can hit.
    let rows = live;
    if (live.length > maxRibbons) {
      const keep = live.slice(0, maxRibbons - 1);
      const rest = live.slice(maxRibbons - 1).reduce((a, b) => a + b.value, 0);
      rows = [...keep, { name: `Other origins (${live.length - keep.length})`, value: rest, slot: -1, pooled: true }];
    }

    const D = lineOffset * R;
    const x = -D;
    const height = R * 2 * lineH;
    const yTop = -height / 2;

    const halfA = Math.acos(Math.min(1, D / R));
    const a0 = Math.PI - halfA;
    const sweep = 2 * (Math.PI - halfA);
    const P = (a) => [Math.cos(a) * R, -Math.sin(a) * R];
    const k = R * 0.55;                       // flare control-point reach

    // Smallest at the top of the line, dominant below: the fine ribbons gather
    // together and the big supplier reads as the broad region.
    let cum = 0;
    const bands = [...rows].reverse().map((s) => {
      const share = total > 0 ? s.value / total : 0;
      const c0 = cum, c1 = cum + share;
      cum = c1;

      const yA = yTop + height * c0, yB = yTop + height * c1;
      const angA = a0 - c0 * sweep, angB = a0 - c1 * sweep;
      const [xA, yAo] = P(angA), [xB, yBo] = P(angB);
      const large = Math.abs(angA - angB) > Math.PI ? 1 : 0;

      // Leave the line horizontally, arrive at the arc radially, so the ribbon opens
      // smoothly instead of arriving as a straight taper.
      const d = `M ${x} ${yA}`
        + ` C ${x + k} ${yA}, ${xA - k * Math.cos(angA)} ${yAo + k * Math.sin(angA)}, ${xA} ${yAo}`
        + ` A ${R} ${R} 0 ${large} 1 ${xB} ${yBo}`
        + ` C ${xB - k * Math.cos(angB)} ${yBo + k * Math.sin(angB)}, ${x + k} ${yB}, ${x} ${yB} Z`;

      return { d, source: s, share };
    });

    return { bands, line: { x, yTop, height }, radius: R };
  };
})();

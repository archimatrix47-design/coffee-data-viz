/**
 * Colour for the trade views.
 *
 * Hue says WHICH SIDE a country is on, the origin family for sellers, the market
 * family for buyers. Lightness says HOW MUCH it moved: the more a country trades, the
 * more intense its colour, on both sides independently.
 *
 * Two notes on the lightness rule.
 *
 * Trade is brutally skewed, Brazil alone is a third of green coffee, so a linear
 * ramp would put every country except two or three at the faint end. The scale runs on
 * sqrt(share), which spreads the middle of the field out where it can be seen.
 *
 * "Higher is darker" is literal on a light surface. On a dark one it inverts to
 * "higher is brighter", because the intent is that the biggest traders read strongest,
 * and a dark navy on a near-black ground would make exactly the flows this page is
 * about disappear. In both themes the rule is the same one: intensity increases with
 * volume, moving away from whatever the background is.
 */

/** True when the chart surface is dark, read from the live token. */
function surfaceIsDark() {
  const s = getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim()
    || getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  const c = d3.color(s);
  if (!c) return false;
  const { r, g, b } = c.rgb();
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/**
 * @param base  the family colour (origin or market)
 * @param t     this country's share of the largest on its own side, 0..1
 */
window.valueTint = function (base, t) {
  const c = d3.hcl(base);
  if (!Number.isFinite(c.l) || !Number.isFinite(c.h)) return base;

  const k = Math.sqrt(Math.max(0, Math.min(1, t || 0)));
  const dark = surfaceIsDark();

  // Faint end and intense end, both held inside a legible band so the smallest
  // country never dissolves into the background and the largest never goes to ink.
  const faint = dark ? 44 : 78;
  const intense = dark ? 88 : 32;

  c.l = faint + (intense - faint) * k;
  c.c = c.c * (0.68 + 0.55 * k);      // big traders are also more saturated
  const out = c.formatHex ? c.formatHex() : String(c);
  return out && out !== 'none' ? out : base;
};

/**
 * Kept for anything that needs to separate countries without a magnitude to encode.
 * Keys on the country's own code, never its rank, so a filter change cannot repaint
 * whichever countries survive it.
 */
const PHI = 0.6180339887498949;
window.countryTint = function (base, code) {
  if (code == null || code < 0) return base;
  const c = d3.hcl(base);
  if (!Number.isFinite(c.l) || !Number.isFinite(c.h)) return base;
  const spread = ((Math.abs(code) * PHI) % 1) - 0.5;
  c.l = Math.max(38, Math.min(80, c.l + spread * 26));
  c.c = Math.max(10, c.c + spread * 16);
  c.h = c.h + spread * 18;
  const out = c.formatHex ? c.formatHex() : String(c);
  return out && out !== 'none' ? out : base;
};

/**
 * One gradient per flow, not per strand: the strands in a bundle run near enough to
 * parallel that a single vector across the bundle is indistinguishable from doing it
 * properly, and doing it properly would mean thousands of gradient nodes.
 */
window.flowGradient = function (defs, id, x1, y1, x2, y2, from, to) {
  const g = defs.append('linearGradient')
    .attr('id', id)
    .attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
  g.append('stop').attr('offset', '0%').attr('stop-color', from);
  g.append('stop').attr('offset', '100%').attr('stop-color', to);
  return `url(#${id})`;
};

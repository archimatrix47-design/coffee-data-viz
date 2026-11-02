/**
 * The origin palette: eight hues that can actually be told apart, plus a neutral for the tail.
 *
 * WHAT WAS WRONG. The breakdown used `d3.interpolateYlOrBr` across however many origins were
 * named, up to 24. That is a sequential ramp, and it did its sequential job well: lightness ran
 * 85 to 31 L*, strictly monotonic, bigger origins darker. But the view also asks the reader to
 * match a ribbon against a named legend, and a ramp cannot do that. Twelve steps of one hue sit
 * 5 L* apart, which measured ΔE 3.8 between neighbours against a floor of 15 — indistinguishable
 * to a reader with full colour vision, before colour blindness enters it. The legend rendered as
 * five orange squares.
 *
 * It also used the same values on both surfaces, so each mode lost the opposite end of the ramp:
 * the darkest three steps fell to 1.87-2.82:1 against the dark surface, the palest six below 3:1
 * against the light one.
 *
 * WHAT THIS IS. Eight hues per mode, each mode stepped for its own surface rather than flipped.
 * Validated against this site's actual surfaces (#FFFFFF and #18181A) with the dataviz skill's
 * checker, which computes CVD separation rather than guessing at it:
 *
 *   light  CVD ΔE 9.1 (protan) · normal-vision ΔE 19.6 · 3 slots under 3:1 contrast
 *   dark   CVD ΔE 8.4 (protan) · normal-vision ΔE 19.3 · all 8 at or above 3:1
 *
 * The three light-mode slots under 3:1 are a documented conditional relax, not a failure: it
 * obligates visible labels or a table view, and every chart here has a table view.
 *
 * WHY EIGHT. Because eight is what passes. A ninth hue cannot be generated without dropping a
 * pair below the floor, so everything past the eighth folds into one neutral "Other origins"
 * ribbon rather than being given a colour that lies about being distinguishable. The named-origin
 * control is capped to match.
 *
 * COLOUR MEANS A DIFFERENT THING HERE than on the other two views, and that is not an oversight.
 * Flows and the map colour a country by its ROLE, on one ramp from origin to market, because
 * there the question is which side of the trade it sits on. The breakdown colours a ribbon by
 * WHICH ORIGIN it is, because every ribbon on that page is already an origin and role would say
 * nothing. Two different questions need two different encodings; what they must not do is go
 * unmentioned, so the page's "how to read this" says so.
 */

(function () {
  // Slot order is fixed and must not be reordered: it is the order the pairs were validated in,
  // and colour follows the entity's rank, so a filter that drops origins must not repaint the
  // survivors.
  const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

  /** Beyond the eighth origin. Grey on purpose: it is a bucket, not an identity. */
  const OTHER = { light: '#8a8a86', dark: '#86857f' };

  window.ORIGIN_SLOTS = LIGHT.length;

  /**
   * @param mode 'light' | 'dark'. The poster passes its own theme; the pages pass the resolved
   *   one, because a theme toggle has to repaint and an OS flip has to be followed.
   */
  window.originPalette = function (mode) {
    return mode === 'dark' ? DARK : LIGHT;
  };

  /**
   * One origin's colour. `slot` is its global volume rank, assigned once across the whole
   * selection, so an origin keeps its colour in every dial on the page.
   */
  window.originColour = function (slot, mode) {
    if (slot == null || slot < 0) return OTHER[mode === 'dark' ? 'dark' : 'light'];
    const p = window.originPalette(mode);
    // Past the validated eight there is no honest colour, so the caller should have pooled it.
    // Falling back to the neutral is safer than cycling, which would claim two origins are one.
    return p[slot] ?? OTHER[mode === 'dark' ? 'dark' : 'light'];
  };
})();

# Coffee Trade Viz — improvements audit

Audited 1 November 2026 against the **deployed artifact**: `dist/` served the way the CDN
serves it, with `/api/*` routed through the real Netlify function handler and the production
gate on (`ALLOW_DEV_ROUTES=0`). Dev routes returned 404, so what was examined is what the
public gets.

Every number here was measured. Where a claim could not be verified, it says so.

---

> **Status: all seven addressed, 1 November 2026.** Six were fixed; the seventh was
> re-examined during the work and the recommendation withdrawn, for the reason given under it.
> One further bug was found while verifying the fixes and is recorded as finding 8.

## Summary

Seven findings. Two are encoding faults that defeat the thing the site exists to do, two are
access faults, one is an exposure left over from debugging, and two are judgement calls worth
revisiting rather than defects.

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | The origin palette cannot identify origins | High | Medium |
| 2 | Dark mode was flipped, not designed | High | Small |
| 3 | Three views, two incompatible colour languages | Medium | Medium |
| 4 | Charts are mouse-only: 0 of 497 marks reachable | Medium | Medium |
| 5 | 21 of 26 map labels overlap another | Medium | Small |
| 6 | Debug endpoints are publicly readable | Medium | Small |
| 7 | Equal-size dials flatten a 12,000-fold range | Judgement | — |
| 8 | Cards could stay invisible if the reveal observer was outrun | High | Small |

All marked **fixed** below except 7, which is **withdrawn**.

---

## 1. The origin palette cannot identify origins

The Breakdown view colours ribbons by origin and prints a legend of twelve named origins with
swatches. To read a dial you match a ribbon's colour against that legend. **You cannot**, and
this is arithmetic rather than opinion — the palette validator against the twelve slots the
page actually generates:

```
[FAIL] CVD separation       worst adjacent #febc4c ↔ #fecc63  ΔE 3.3 (deutan) · 3.4 (tritan)
[FAIL] Normal-vision floor  worst adjacent #febc4c ↔ #fecc63  ΔE 3.8 — floor is 15
[FAIL] Lightness band       4 of 12 outside the band
[WARN] Contrast vs surface  6 of 12 below 3:1
```

A ΔE of 3.8 between neighbours means two adjacent origins are indistinguishable **to a reader
with full colour vision**, before colour-blindness enters it. In the rendered legend, Uganda,
Ethiopia, Tanzania, Kenya and Côte d'Ivoire are five orange squares.

The cause is a real tension, not carelessness. `d3.interpolateYlOrBr` is being asked to do two
jobs: show rank (bigger origins darker) and identify a country. It does the first well —
lightness runs 85 → 31 L\*, strictly monotonic, a textbook sequential ramp. It cannot do the
second, because twelve steps of one ramp are 5 L\* apart and identity needs separation in hue.

**FIXED.** Eight validated hues in `web/palette.js`, one per named origin, slot order fixed so
colour follows the entity and a filter cannot repaint the survivors. The named-origin control is
capped at 8 (was 12, max 24) because eight is what passes; the tail pools into one grey ribbon
rather than taking a ninth colour that would look like one of the eight. Measured after: CVD
ΔE 9.1 light / 8.4 dark, normal-vision ΔE 19.6 / 19.3.

**What would have fixed it.** Pick one job per channel. Either keep the ramp for rank and carry
identity some other way — direct labels on the larger ribbons, which the dials have room for —
or drop to a validated categorical set of 8 with everything beyond folded into "Other", which
is what the legend's `Other origins (33)` slot already does for the tail. The second is the
smaller change and matches what the grid can actually resolve.

## 2. Dark mode was flipped, not designed

The same ramp is used on both surfaces. Against the dark surface the dark end of it disappears:

```
[WARN] Contrast vs surface  #ab3d03 → 2.82:1   #953404 → 2.30:1   #7e2c05 → 1.87:1
```

Those are the three largest origins by rank, the ones the eye should find first, sitting below
the 3:1 floor for a graphical object. In light mode the *pale* end fails instead — six slots
under 3:1. Each mode loses the opposite end of the ramp.

**FIXED.** Two sets of eight, each stepped for its own surface, selected rather than flipped.
Dark now passes contrast on all eight slots; light has three slots in the 2.17–2.82 band, which
is a documented conditional relax requiring visible labels or a table view — every chart here
has a table view. The pages read the resolved theme and repaint on `themechange`; the poster
picks the set matching its own print theme.

## 3. Three views, two incompatible colour languages

Measured live, the colour each view gives the same country:

| | Brazil | Germany |
|---|---|---|
| Map | `#8ae1ff` pale blue | `#ffa19e` salmon |
| Flows | blue end of the origin↔market ramp | red end |
| Breakdown | `#fecc63` pale yellow | not coloured — it is a dial, not a ribbon |

Map and Flows agree: blue means *grows and ships*, red means *buys*. Breakdown uses an
unrelated yellow-to-brown ramp where position means volume rank. A reader moving between tabs
has to notice the rule changed and relearn it, and nothing on the page says it did.

**FIXED, by disclosure rather than unification.** Forcing one ramp across all three would be
wrong: Flows and the map encode a country's *role* on one origin-to-market scale, because there
the question is which side of the trade it sits on; the breakdown encodes *which origin*, because
every ribbon on that page is already an origin and role would say nothing. Two questions need two
encodings. What they must not do is change silently, so the breakdown's "How to read this" now
states the rule and says plainly that it differs from the other two views.

## 4. Charts are mouse-only

On the Map: **97 country circles, 400 flow paths, 0 with `tabindex`, 0 with a key handler.**
Selecting a country — the primary interaction, and the one the proportion rings were built for —
cannot be done from a keyboard at all. The same is true of click-to-focus on the chord.

The table view is a genuine mitigation and it exists on every view, which is more than most
sites manage. But it is a different reading: it lists totals, not the per-partner proportion
the rings show, so a keyboard user cannot reach the view's main insight.

There is also no skip link, and 44 focusable controls sit before the content on every page.

**FIXED.** The 97 country nodes are a roving-tabindex list ordered by volume, so one Tab reaches
the map and it lands on Brazil rather than whichever country is first in the data; arrows move
within it, Enter selects, each node carries `role="button"`, an `aria-label` with its figures, and
`aria-pressed`. Focus is drawn with a ring, since an SVG mark cannot take the usual outline
reliably. A skip link is on all four pages.

Verified by driving it: Brazil → arrow → United States → Enter selects (22 rings drawn, panel
updated), and focus stays on the country through both select and deselect. That last part needed a
second pass — `render()` throws the circles away and builds new ones, so the first version dropped
focus to the top of the document and the node has to be found again by its country index, not by
position in a list that gets re-sorted.

## 5. Map labels collide

26 country labels drawn, **21 of them overlap at least one other.** Germany alone collides with
Belgium, Netherlands, Switzerland, United Kingdom and Poland. Western Europe is a dozen buyers
inside a few hundred kilometres and the labels are placed without any check.

The percentage labels on the selection rings already de-collide against each other *and* against
these country labels. That routine exists and works; the country labels simply do not use it.

**FIXED.** Placed largest-first, four candidate positions each (right, left, above, below), and
any label that will not fit is dropped rather than drawn over one already there. **Overlapping
pairs: 21 → 1.** The one left is Japan/South Korea, a borderline case of the approximate
character-width estimate rather than a placement failure.

## 6. Debug endpoints are publicly readable

`/health` and the `/api` 500 handler were added to diagnose the deploy failure. They did their
job and found it. They now answer anyone:

- `/health` returns `cwd`, the values of four environment variables, and a directory listing of
  the task root and `data/processed`.
- The 500 handler returns a stack trace and the same listings.

Nothing secret is in there — server paths, whether some flags are set, top-level filenames. It
is reconnaissance detail rather than credentials. But it is more than a public endpoint should
volunteer.

**FIXED.** `/health` returns `{ok, node}` in production and the full listing only when
`ALLOW_DEV_ROUTES` is on — the same switch that closes the study harness, so the diagnostic comes
back by flipping one variable. The 500 handler still always returns the error *message*, because
whoever is looking at a broken page deserves to know why and the message names no internals; the
stack and the directory listings are now gated with it.

## 7. Equal-size dials flatten a 12,000-fold range

"Size by volume" is off by default, so Germany at 1.02M t and Moldova at 83 t are drawn as
identical discs. The how-to-read explains this and the tonnage is printed beside every name, so
it is disclosed rather than hidden, and it genuinely does make the *shapes* comparable, which is
the view's stated purpose.

Still: the strongest signal on the page is size, and it currently carries nothing. A reader
skimming the grid takes away that these 36 countries are peers. They are not.

**WITHDRAWN — I was wrong.** I wrote that I would still turn size-by-volume on. Measuring it
before making the change showed why the current default is right: with it on, **16 of 36 buyers
fall below R=20** and the median is R=20.6 against Germany's 40. At R=16 a dial is a 32-pixel disc
carrying eight ribbons, and the funnel shape — the whole reason the view exists — stops being
readable for nearly half the grid. Trading the view's actual job for a size cue that order and the
printed tonnage already supply is a bad deal.

Left as it is, deliberately. The checkbox is there for anyone who wants the other reading.

## 8. Cards could stay invisible if the reveal observer was outrun

Found while verifying the palette fix, not in the original pass. Scrolling the 36-card grid end to
end in one gesture left **nine cards permanently at opacity 0** — never reported as intersecting,
and the page had already moved past them, so they were never going to appear.

Content must not depend on an animation firing. A sweep now shows anything still hidden outright,
repeating while there is anything left and again on `pageshow`. Re-tested with the same fast
scroll: 36 of 36 revealed, 0 invisible.

---

## What is already right

Worth recording, so a future pass does not "fix" it:

- **The data layer.** Mirror-flow reconciliation, direction validated against real-world
  rankings, re-export attribution capped at `min(exports, imports)`. The 502 chase never once
  turned up a data fault.
- **One cell spec, one painter.** `dialcell.js` means the grid and the poster cannot drift;
  they draw from the same display list.
- **Table view on every chart**, which is the single most valuable accessibility feature here.
- **Contrast and target sizes pass** across all four pages in both themes — verified with a
  compositing-aware probe, after an earlier one produced two false positives.
- **URL state and active-filter chips**, so a filtered view is shareable and legible.
- **Reduced motion respected**, including disabling the year-range Play control.

## Not verified

**The live site itself.** Still no URL, so this was run against `dist/` plus the real
function handler — which is the same code and the same artifact, but not the same CDN, cold
starts, or network. Three things can only be checked against the deployed origin:

1. Whether `Netlify-CDN-Cache-Control` is actually being honoured, which matters because the
   free tier's 125,000 invocations is a hard cap that takes the site offline rather than
   throttling it.
2. Real cold-start latency on a first visit.
3. Whether the monthly GitHub Actions refresh has run.

Send the URL and these take one pass.

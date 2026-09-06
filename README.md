# Global Coffee Trade

Interactive visualisation of world coffee trade, built on FAOSTAT's bilateral trade
matrix. Three views over the same data: a chord diagram of who sells to whom, a flow
map of the same trade drawn on the world, and a poster exporter for social media.

```bash
npm install
npm start          # http://localhost:3200
```

| Page | What it shows |
|---|---|
| `/` **Flows** | Bipartite chord: sellers on the right half, buyers on the left, every strand crossing the middle |
| `/network` **Map** | The same routes on a world map, with estimated re-export chains, auto-framing, and toggles to hide re-export legs or simplify to one line per route |
| `/breakdown` **Breakdown** | One dial per buying country, split by origin, small multiples with per-country trend strips |
| `/poster` **Poster** | Any of the three, as an Instagram-dimension PNG/SVG at up to 4× |

All three take the same filters: coffee product, quantity or value, year and span,
strand scale, reporting rule, and a **zone pair**, sellers from one region, buyers in
another.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system map: data pipeline, request
lifecycle, and which UI control drives which query parameter.

## The data

**Source:** [FAOSTAT Detailed Trade Matrix](https://www.fao.org/faostat/en/#data/TM)
(CC BY-4.0), bulk release of 23 December 2025.

- **1986–2024**, 39 years
- **214 countries**, 5 coffee products (green, roasted/decaffeinated, extracts,
  substitutes, husks)
- **409,785 reconciled flows** from 1,146,158 raw records

The pipeline downloads a 420MB archive, streams the 8.49GB CSV inside it without ever
writing it to disk, keeps only the coffee rows (168MB), and deletes the archive.

```bash
npm run refresh          # fetch only if FAOSTAT published a new release
npm run refresh -- --force
npm run aggregate        # re-derive the JSON from the existing extract
```

`refresh` compares the published file's Last-Modified/ETag against
`data/raw/source-manifest.json` and does nothing if it is unchanged. FAOSTAT publishes
coffee trade annually with a 1–2 year lag, so "up to date" means catching each new
annual release, there is no live tick of coffee trade to stream.

## Three things about this data that shape the result

**1. Every trade is reported twice, and the two sides disagree.**
When Brazil ships to Germany, Brazil files an export and Germany files an import, two
records, different numbers. Summing them roughly doubles world trade. Flows are
collapsed onto a canonical `(exporter, importer, item, year)` key with both sides kept;
the reconciliation rule is applied at serve time and exposed in the UI. The default
prefers the importer's figure, since customs assess duty on imports.

How far apart are they? It depends almost entirely on size:

| Shipment size | Median agreement |
|---|---|
| < 10 t | 36.9% |
| 100–1k t | 62.0% |
| 1k–10k t | 76.2% |
| > 10k t | 86.5% |

In aggregate the two sides agree to within **1.1%** (231.3M t vs 233.9M t). The
disagreement lives in the long tail of tiny shipments, which is why the minimum-flow
filter doubles as a data-quality filter. Run `node pipeline/check-mirror.mjs` to
reproduce this.

Import values are CIF (freight and insurance included) and export values FOB, so value
comparisons carry a freight gap. Quantities do not.

**2. Historical states are preserved.** The window opens in 1986, so the USSR,
Czechoslovakia, Yugoslavia, Belgium-Luxembourg, Ethiopia PDR and pre-partition Sudan
all appear and then vanish as you scrub the year slider. That is correct, not a bug -
dropping them would silently erase pre-1993 trade.

**3. Re-export chains are estimated, never observed.** Coffee is fungible and no
customs record follows a bean through a warehouse, so nothing can say which of
Germany's re-exports were originally Brazilian. `/api/chains` uses proportional
attribution, if Brazil supplied 42% of Germany's imports, 42% of Germany's onward
exports are attributed to Brazil, capped at what the hub actually imported, because a
country cannot re-export more than it brought in. That cap is what stops Viet Nam,
which buys a little coffee and exports its own harvest by the million tonnes, from
appearing to re-export hundreds of thousands of tonnes of Brazilian beans. Its
re-export capacity comes out at 7%; Germany's at 100%. Responses are flagged
`estimated: true`.

## Design decisions worth knowing

**Strands, not ribbon widths.** A flow is drawn as N discrete strands of a fixed
quantity (1 strand = 10k tonnes by default, adjustable). Counting strands is exact in a
way that comparing ribbon thicknesses is not, and the same convention is used on both
the chord page and the map.

**Colour is diverging, not categorical.** Countries are coloured by their share of
imports in total trade handled: pure origins at one end, pure markets at the other,
entrepôt hubs in between. Six categorical continent hues were tested against the
all-pairs contrast floors and none passed, so continent is carried by grouping and
labels rather than hue. `node scripts/validate_palette.js` in the dataviz skill
reproduces those results.

**Strands are gradients, and lightness encodes volume.** A strand belongs to both ends,
so it fades from the seller's colour to the buyer's along its length. Hue says which
side of the trade a country is on; lightness says how much it moved, the more it
trades, the stronger the colour, with sellers and buyers scaled against their own
largest, so the biggest of each reads at full strength rather than the smaller side
being washed out by the larger.

Trade is brutally skewed, so the scale runs on sqrt(share) to spread the middle of the
field where it can be seen. "Higher is darker" is literal on a light surface and
inverts to "higher is brighter" on a dark one, in both cases intensity increases with
volume, moving away from whatever the background is.

**The Breakdown page's colour is ordinal, not categorical.** Forty-odd origins can
supply one region and no palette carries forty distinguishable hues. Origins are ranked
by total volume across the whole selection and drawn from a warm ramp in that order,
with rank assigned globally so an origin keeps its colour in every dial; past the named
cut the tail collapses into one neutral wedge. Its two trend panels are deliberately two
panels, tonnes and dollars on one pair of axes would be a dual-axis chart, where the
crossing point is an artefact of the scales rather than anything in the data.

**Hubs appear twice.** On the chord page Germany and Belgium show up on both halves of
the circle, they are large buyers and large re-sellers, and collapsing that into one
arc would hide the behaviour most worth seeing.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/meta` | Countries, items, years, zones, provenance, quality stats |
| `GET /api/chord` | Square matrix; `bipartite=1` splits each country into selling and buying sides |
| `GET /api/network` | Node/edge list for the map |
| `GET /api/chains?origin=<FAO code>` | Two-leg re-export chains (estimated) |
| `POST /api/save?name=<file>` | Writes a rendered poster into `exports/` |

Shared query parameters: `items` (FAO codes), `metric` (`qty`\|`value`), `yearFrom`,
`yearTo`, `rule` (`importer`\|`exporter`\|`max`\|`mean`), `expZone`, `impZone`.

Zones cover continents, economic blocs (EU-27, EFTA, ASEAN, Mercosur, USMCA, GCC) and
sub-regions, and apply to each side independently, so "African origins into the EU" is
a single query. Blocs use current membership across all years; the UK is therefore
absent from the EU even in 2015.

## Poster export

**Make poster →** on the Flows and Map pages hands the current view straight to the
exporter, product, measure, year and span, zones, reporting rule, countries per side
and strand scale all travel in the URL, so nothing has to be reproduced by hand. The
poster honours the reporting rule it is given rather than assuming importer-reported,
and incoming parameters are validated, so a hand-edited URL degrades to the defaults
instead of rendering nonsense.

All three visualisations export. Pick the design (flows, map, breakdown), the format -
Instagram-native 4:5 portrait, 1:1 square, 9:16 story, landscape, and a ground:
**espresso**, **latte**, or *Follow app*, which tracks the site's own light/dark toggle
so a poster made in dark mode does not come out on cream paper. Exports at 1×–4×
(up to 4320 × 5400) as PNG, or as vector SVG.

Controls that do not apply to the chosen design are hidden rather than left inert, and
each design brings its own legend: the strand key for flows and map, the origin list for
breakdown.

The poster is built as a self-contained SVG with every fill, font and stroke written as
an attribute. Rasterising goes through an `<img>`, which loads the SVG in an isolated
context where the page's CSS, and therefore every CSS variable, does not exist;
anything left to a stylesheet would render black. Preview and export call the same
builder at the same dimensions, so what is on screen is what lands in the file.

Every export also POSTs a copy to `exports/`, because a browser download is at the
mercy of download prompts and sandboxes. Filenames record the filter
(`coffee-coffee-green-africa-to-eu27-2020-2024-1080x1350@2x.png`) so a zoned poster
cannot silently overwrite a global one.

Titles follow the selection until you type your own, narrowing the zones rewrites the
title to name them, and the footer carries the filter, so a shared poster stays
self-describing.

## Layout

```
pipeline/    refresh.mjs, aggregate.mjs, continents.mjs, zones.mjs, check-mirror.mjs
server/      index.mjs, holds ~410k flows in memory, serves filtered slices
web/         index.html + chord.js · network.html + map.js · poster.html + poster.js
             names.js, shared country display names, used by all three
data/raw/    coffee_raw.csv (168MB) + lookup tables
data/processed/  meta.json, flows.json (12.3MB)
exports/     rendered posters
```

The whole flow table sits in memory as typed arrays, so a request is one linear scan of
409,785 rows, a few milliseconds. That is what lets the year slider feel instant
without shipping 12MB to the browser or pre-baking every filter combination.

## Rebuilding vendor bundles

```bash
npx esbuild web/src/map-libs.js   --bundle --format=iife --minify --outfile=web/vendor/map-libs.js
```

Everything is bundled locally rather than pulled from a CDN, so the site works offline
and pins its own versions.

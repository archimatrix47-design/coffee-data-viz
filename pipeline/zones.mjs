/**
 * Geographic and economic groupings, by FAO country code.
 *
 * Zones can be applied to the selling side and the buying side independently,
 * which is what makes questions like "African origins into the EU" askable.
 *
 * Two deliberate choices:
 *  - Blocs list their CURRENT membership, applied across all years. The United
 *    Kingdom is therefore absent from the EU even in 2015. Modelling accession and
 *    exit dates per country is a much larger job; until then the label says "EU-27
 *    (current membership)" so the figure is never mistaken for a historical EU.
 *  - Dissolved states are included in the region they occupied (USSR in Europe,
 *    Belgium-Luxembourg in the EU), so early years are not silently emptied.
 */

import { COUNTRY_CONTINENT } from './continents.mjs';

const EU27 = [
  11, 255, 27, 98, 50, 167, 54, 63, 67, 68, 79, 84, 97, 104, 106,
  119, 126, 256, 134, 150, 173, 174, 183, 199, 198, 203, 210,
  15,   // Belgium-Luxembourg, so pre-1999 European trade is not lost
];

const ZONE_CODES = {
  eu27:      EU27,
  efta:      [99, 162, 211],
  eurozone_plus_uk: null,                     // reserved; not defined yet
  asean:     [26, 115, 101, 120, 131, 28, 171, 200, 216, 237],
  mercosur:  [9, 21, 169, 234, 236, 19],
  usmca:     [33, 138, 231],
  gcc:       [13, 118, 221, 179, 194, 225],

  east_africa:    [29, 238, 62, 114, 184, 215, 226, 201, 178, 72, 276, 277, 206, 130, 251, 181, 129, 144, 137, 196, 45],
  west_africa:    [53, 233, 35, 107, 75, 81, 90, 175, 123, 133, 136, 158, 159, 195, 197, 217],
  central_africa: [32, 37, 39, 46, 250, 61, 74, 193],
  north_africa:   [4, 59, 124, 143, 222],
  southern_africa:[20, 122, 147, 202, 209],

  central_america: [23, 48, 60, 89, 95, 138, 157, 166],
  south_america:   [9, 19, 21, 40, 44, 58, 91, 169, 170, 207, 234, 236, 69],
  caribbean:       [8, 12, 14, 49, 55, 56, 86, 87, 93, 109, 135, 177, 188, 189, 191, 220],
  north_america:   [33, 231],

  southeast_asia: [26, 115, 101, 120, 131, 28, 171, 200, 216, 237, 176],
  east_asia:      [41, 96, 128, 214, 110, 116, 117, 141],
  south_asia:     [2, 16, 18, 100, 132, 149, 165, 38],
  middle_east:    [13, 103, 105, 112, 118, 121, 221, 179, 194, 212, 223, 225, 249, 299],
};
delete ZONE_CODES.eurozone_plus_uk;

/** Continent zones are derived, so they never drift from the continent map. */
const continentZone = (name) =>
  Object.entries(COUNTRY_CONTINENT).filter(([, c]) => c === name).map(([code]) => +code);

export const ZONES = [
  { id: 'all', label: 'Everywhere', group: '', codes: null },

  { id: 'africa',   label: 'Africa',   group: 'Continent', codes: continentZone('Africa') },
  { id: 'americas', label: 'Americas', group: 'Continent', codes: continentZone('Americas') },
  { id: 'asia',     label: 'Asia',     group: 'Continent', codes: continentZone('Asia') },
  { id: 'europe',   label: 'Europe',   group: 'Continent', codes: continentZone('Europe') },
  { id: 'oceania',  label: 'Oceania',  group: 'Continent', codes: continentZone('Oceania') },

  { id: 'eu27',     label: 'European Union (27, current)', group: 'Economic bloc', codes: ZONE_CODES.eu27 },
  { id: 'efta',     label: 'EFTA',      group: 'Economic bloc', codes: ZONE_CODES.efta },
  { id: 'asean',    label: 'ASEAN',     group: 'Economic bloc', codes: ZONE_CODES.asean },
  { id: 'mercosur', label: 'Mercosur',  group: 'Economic bloc', codes: ZONE_CODES.mercosur },
  { id: 'usmca',    label: 'USMCA',     group: 'Economic bloc', codes: ZONE_CODES.usmca },
  { id: 'gcc',      label: 'Gulf (GCC)', group: 'Economic bloc', codes: ZONE_CODES.gcc },

  { id: 'east_africa',     label: 'East Africa',     group: 'Region', codes: ZONE_CODES.east_africa },
  { id: 'west_africa',     label: 'West Africa',     group: 'Region', codes: ZONE_CODES.west_africa },
  { id: 'central_africa',  label: 'Central Africa',  group: 'Region', codes: ZONE_CODES.central_africa },
  { id: 'north_africa',    label: 'North Africa',    group: 'Region', codes: ZONE_CODES.north_africa },
  { id: 'southern_africa', label: 'Southern Africa', group: 'Region', codes: ZONE_CODES.southern_africa },
  { id: 'central_america', label: 'Central America', group: 'Region', codes: ZONE_CODES.central_america },
  { id: 'south_america',   label: 'South America',   group: 'Region', codes: ZONE_CODES.south_america },
  { id: 'caribbean',       label: 'Caribbean',       group: 'Region', codes: ZONE_CODES.caribbean },
  { id: 'north_america',   label: 'North America',   group: 'Region', codes: ZONE_CODES.north_america },
  { id: 'southeast_asia',  label: 'Southeast Asia',  group: 'Region', codes: ZONE_CODES.southeast_asia },
  { id: 'east_asia',       label: 'East Asia',       group: 'Region', codes: ZONE_CODES.east_asia },
  { id: 'south_asia',      label: 'South Asia',      group: 'Region', codes: ZONE_CODES.south_asia },
  { id: 'middle_east',     label: 'Middle East',     group: 'Region', codes: ZONE_CODES.middle_east },
];

// Prose forms for poster titles: "...to the European Union" reads, while
// "...to European Union (27, current)" does not.
const TITLE_LABELS = {
  eu27: 'the European Union', efta: 'the EFTA countries', asean: 'ASEAN',
  mercosur: 'Mercosur', usmca: 'the USMCA countries', gcc: 'the Gulf states',
  americas: 'the Americas', middle_east: 'the Middle East',
  caribbean: 'the Caribbean', north_america: 'North America',
};

const BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export const zoneTitleLabel = (id) => TITLE_LABELS[id] ?? BY_ID.get(id)?.label ?? 'the world';

/** Returns a Set of FAO codes, or null for "no restriction". */
export function zoneCodes(id) {
  const z = BY_ID.get(id);
  if (!z || !z.codes) return null;
  return new Set(z.codes);
}

export const zoneLabel = (id) => BY_ID.get(id)?.label ?? 'Everywhere';

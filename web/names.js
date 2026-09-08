/**
 * Display names for countries.
 *
 * FAOSTAT uses formal UN names -- "United Kingdom of Great Britain and Northern
 * Ireland" -- which are correct and unusable in a chart label. Shared by the
 * network graph and the poster so both read the same way.
 */
window.SHORT_NAMES = {
  'United States of America': 'United States',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Netherlands (Kingdom of the)': 'Netherlands',
  'China, mainland': 'China',
  'China, Hong Kong SAR': 'Hong Kong',
  'China, Macao SAR': 'Macao',
  'China, Taiwan Province of': 'Taiwan',
  'Republic of Korea': 'South Korea',
  "Democratic People's Republic of Korea": 'North Korea',
  'Democratic People’s Republic of Korea': 'North Korea',
  'United Republic of Tanzania': 'Tanzania',
  'Democratic Republic of the Congo': 'DR Congo',
  'Central African Republic': 'Central African Rep.',
  "Lao People's Democratic Republic": 'Laos',
  'Lao People’s Democratic Republic': 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Russian Federation': 'Russia',
  'Iran (Islamic Republic of)': 'Iran',
  'Venezuela (Bolivarian Republic of)': 'Venezuela',
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Micronesia (Federated States of)': 'Micronesia',
  'Republic of Moldova': 'Moldova',
  'Belgium-Luxembourg': 'Belgium-Lux.',
  'Sudan (former)': 'Sudan (pre-2011)',
  'Ethiopia PDR': 'Ethiopia (PDR)',
  'Serbia and Montenegro': 'Serbia & Mont.',
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Saint Vincent and the Grenadines': 'St Vincent',
  'Antigua and Barbuda': 'Antigua',
  'Saint Kitts and Nevis': 'St Kitts',
  'Trinidad and Tobago': 'Trinidad',
  'Sao Tome and Principe': 'Sao Tome',
  'Papua New Guinea': 'Papua N. Guinea',
  'United Arab Emirates': 'UAE',
  'Brunei Darussalam': 'Brunei',
  // FAOSTAT follows the UN's official two-word name. It is not wrong, but every other
  // official name here is already mapped to the common English one, so leaving this
  // reads as an oversight rather than a decision.
  'Viet Nam': 'Vietnam',
};

/** `max` of 0 means no truncation. */
window.shortCountryName = function (name, max = 0) {
  if (!name) return '';
  const other = /^Other (exporters|importers)/.exec(name);
  if (other) return `Other ${other[1]}`;
  const mapped = window.SHORT_NAMES[name] ?? name.replace(/\s*\(.*?\)\s*$/, '');
  if (!max || mapped.length <= max) return mapped;
  return mapped.slice(0, max - 1) + '…';
};

/**
 * A product code's name, as it reads inside a sentence.
 *
 * FAOSTAT names these inconsistently: "Coffee, green" inverts, "Coffee husks and skins"
 * does not. The page used to strip a leading "Coffee, " and append " coffee", which is
 * right for exactly one of the five products and produced "Coffee husks and skins coffee"
 * for the rest. Only the default reads correctly, which is why it survived so long.
 */
window.prettyItem = function (name) {
  const m = /^Coffee,\s*(.+)$/i.exec(String(name || 'Coffee'));
  if (!m) return String(name || 'coffee').toLowerCase();
  const tail = m[1].toLowerCase();
  if (tail.includes('decaffeinated') || tail.includes('roasted')) return 'roasted coffee';
  return `${tail} coffee`;
};

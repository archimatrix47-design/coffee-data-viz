// FAO country code -> continent.
//
// Covers every country code present in the FAOSTAT coffee trade extract (213 of them).
// Regions follow UN M49 groupings, with two deliberate choices worth knowing:
//   - Cyprus (50) and Timor-Leste (176) sit in Asia, per M49, not Europe/Oceania.
//   - Historical entities (USSR, Czechoslovakia, Yugoslav SFR, Belgium-Luxembourg,
//     Ethiopia PDR, Sudan former, Serbia and Montenegro) are kept and mapped, because
//     the dataset starts in 1986 and those states really did trade coffee back then.
//     Dropping them would silently erase pre-1993 trade.

export const CONTINENTS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Other'];

export const COUNTRY_CONTINENT = {
  // --- Africa ---
  4: 'Africa', 7: 'Africa', 20: 'Africa', 29: 'Africa', 32: 'Africa', 35: 'Africa',
  37: 'Africa', 39: 'Africa', 45: 'Africa', 46: 'Africa', 53: 'Africa', 59: 'Africa',
  61: 'Africa', 62: 'Africa', 72: 'Africa', 74: 'Africa', 75: 'Africa', 81: 'Africa',
  90: 'Africa', 107: 'Africa', 114: 'Africa', 122: 'Africa', 123: 'Africa', 124: 'Africa',
  129: 'Africa', 130: 'Africa', 133: 'Africa', 136: 'Africa', 137: 'Africa', 143: 'Africa',
  144: 'Africa', 147: 'Africa', 158: 'Africa', 159: 'Africa', 175: 'Africa', 178: 'Africa',
  181: 'Africa', 182: 'Africa', 184: 'Africa', 193: 'Africa', 195: 'Africa', 196: 'Africa',
  197: 'Africa', 201: 'Africa', 202: 'Africa', 206: 'Africa', 209: 'Africa', 215: 'Africa',
  217: 'Africa', 222: 'Africa', 226: 'Africa', 233: 'Africa', 238: 'Africa', 250: 'Africa',
  251: 'Africa', 276: 'Africa', 277: 'Africa',

  // --- Americas ---
  8: 'Americas', 9: 'Americas', 12: 'Americas', 14: 'Americas', 19: 'Americas',
  21: 'Americas', 23: 'Americas', 33: 'Americas', 40: 'Americas', 44: 'Americas',
  48: 'Americas', 49: 'Americas', 55: 'Americas', 56: 'Americas', 58: 'Americas',
  60: 'Americas', 69: 'Americas', 86: 'Americas', 87: 'Americas', 89: 'Americas',
  91: 'Americas', 93: 'Americas', 95: 'Americas', 109: 'Americas', 135: 'Americas',
  138: 'Americas', 157: 'Americas', 166: 'Americas', 169: 'Americas', 170: 'Americas',
  177: 'Americas', 188: 'Americas', 189: 'Americas', 191: 'Americas', 207: 'Americas',
  220: 'Americas', 231: 'Americas', 234: 'Americas', 236: 'Americas',

  // --- Asia ---
  1: 'Asia', 2: 'Asia', 13: 'Asia', 16: 'Asia', 18: 'Asia', 26: 'Asia', 28: 'Asia',
  38: 'Asia', 41: 'Asia', 50: 'Asia', 52: 'Asia', 73: 'Asia', 96: 'Asia', 100: 'Asia',
  101: 'Asia', 102: 'Asia', 103: 'Asia', 105: 'Asia', 108: 'Asia', 110: 'Asia',
  112: 'Asia', 113: 'Asia', 115: 'Asia', 116: 'Asia', 117: 'Asia', 118: 'Asia',
  120: 'Asia', 121: 'Asia', 128: 'Asia', 131: 'Asia', 132: 'Asia', 141: 'Asia',
  149: 'Asia', 165: 'Asia', 171: 'Asia', 176: 'Asia', 179: 'Asia', 194: 'Asia',
  200: 'Asia', 208: 'Asia', 212: 'Asia', 213: 'Asia', 214: 'Asia', 216: 'Asia',
  221: 'Asia', 223: 'Asia', 225: 'Asia', 235: 'Asia', 237: 'Asia', 249: 'Asia',
  299: 'Asia',

  // --- Europe ---
  3: 'Europe', 11: 'Europe', 15: 'Europe', 27: 'Europe', 51: 'Europe', 54: 'Europe',
  57: 'Europe', 63: 'Europe', 64: 'Europe', 67: 'Europe', 68: 'Europe', 79: 'Europe',
  80: 'Europe', 84: 'Europe', 97: 'Europe', 98: 'Europe', 99: 'Europe', 104: 'Europe',
  106: 'Europe', 119: 'Europe', 126: 'Europe', 134: 'Europe', 140: 'Europe',
  146: 'Europe', 150: 'Europe', 154: 'Europe', 162: 'Europe', 167: 'Europe',
  173: 'Europe', 174: 'Europe', 183: 'Europe', 185: 'Europe', 186: 'Europe',
  198: 'Europe', 199: 'Europe', 203: 'Europe', 210: 'Europe', 211: 'Europe',
  228: 'Europe', 229: 'Europe', 230: 'Europe', 248: 'Europe', 255: 'Europe',
  256: 'Europe', 272: 'Europe', 273: 'Europe',

  // --- Oceania ---
  10: 'Oceania', 25: 'Oceania', 47: 'Oceania', 66: 'Oceania', 70: 'Oceania',
  83: 'Oceania', 127: 'Oceania', 145: 'Oceania', 148: 'Oceania', 153: 'Oceania',
  155: 'Oceania', 156: 'Oceania', 160: 'Oceania', 168: 'Oceania', 180: 'Oceania',
  218: 'Oceania', 219: 'Oceania', 227: 'Oceania', 232: 'Oceania', 244: 'Oceania',

  // --- Other ---
  // Bouvet Island: uninhabited Norwegian Antarctic dependency. It appears in the
  // data as a trade partner, which is a reporting artifact rather than real commerce.
  31: 'Other',
};

/**
 * Historical states that dissolved during the 1986-2024 window, mapped to the
 * successor countries that replaced them. Not applied by default -- the raw
 * entities are kept so early years stay accurate -- but exposed so the UI can
 * offer a "merge historical predecessors" view without re-deriving this by hand.
 */
export const HISTORICAL_SUCCESSORS = {
  228: { name: 'USSR', dissolvedAfter: 1991, successors: [185, 230, 57, 119, 126, 63, 73, 1, 52, 108, 113, 146, 208, 213, 235] },
  51: { name: 'Czechoslovakia', dissolvedAfter: 1992, successors: [167, 199] },
  248: { name: 'Yugoslav SFR', dissolvedAfter: 1991, successors: [98, 198, 154, 80, 272, 273] },
  186: { name: 'Serbia and Montenegro', dissolvedAfter: 2005, successors: [272, 273] },
  15: { name: 'Belgium-Luxembourg', dissolvedAfter: 1999, successors: [255, 256] },
  62: { name: 'Ethiopia PDR', dissolvedAfter: 1992, successors: [238, 178] },
  206: { name: 'Sudan (former)', dissolvedAfter: 2011, successors: [276, 277] },
};

export function continentOf(code) {
  return COUNTRY_CONTINENT[code] ?? 'Other';
}

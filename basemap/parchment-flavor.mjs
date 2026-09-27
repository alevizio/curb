// Parchment Flavor for the self-hosted CURB basemap — a 1:1 port of MAP_STYLE (index.html ~775-791),
// the "Parchment Draft" look. Generates a MapLibre GL style JSON (Protomaps v4 schema) that the
// offline raster bake renders to PNG tiles.
//
//   Run:  node basemap/parchment-flavor.mjs > basemap/parchment-style.json
//
// THE LOAD-BEARING CONSTRAINT (do not regress): the road FILL must stay a cool, near-paper LIGHT
// grey (#eceff1). Streets separate from the warm #fbf7ef land by HUE, not darkness, so the amber
// "soon" curb line (--amber #E08A1E) drawn ON TOP keeps ~3:1 contrast. Never darken roads. POIs OFF.
//
// NOTE: the Flavor field names below are the @protomaps/basemaps v5 keys (checked against 5.7.2 via
// Object.keys(namedFlavor('light'))). If a later version renames any, the
// render will fall back to that field's default — diff parchment-style.json and adjust. This is the
// one place to iterate; everything downstream (bake, R2, the index.html flag) is independent of it.
import { layers, namedFlavor } from '@protomaps/basemaps';

// CURB parchment palette (exact, from MAP_STYLE). Start from the built-in "light" flavor and
// override every surface so the bake is a 1:1 reproduction of today's Google-styled look.
const PAPER = '#fbf7ef', INK = '#5a4b3c', SAGE = '#c6ddbe', TAN = '#d7c4a5';
const ROAD = '#eceff1', CASING = '#aeb6bd';

export const PARCHMENT = {
  ...namedFlavor('light'),

  // Land / "paper": every non-park surface flattens into the paper, like MAP_STYLE's geometry rule
  background: PAPER, earth: PAPER,
  hospital: PAPER, industrial: PAPER, school: PAPER, pedestrian: PAPER, pier: PAPER,
  aerodrome: PAPER, runway: PAPER, glacier: PAPER, sand: PAPER, beach: PAPER, zoo: PAPER, military: PAPER,
  landcover: { grassland: PAPER, barren: PAPER, urban_area: PAPER, farmland: PAPER, glacier: PAPER, scrub: PAPER, forest: PAPER },

  // Parks read GREEN (soft sage), like the re-enabled poi.park geometry in MAP_STYLE
  park_a: SAGE, park_b: SAGE, wood_a: SAGE, wood_b: SAGE, scrub_a: SAGE, scrub_b: SAGE,

  // Water = warm tan/sand
  water: '#ded1b7',

  // Buildings vanish into the paper (MAP_STYLE shows none); the layer is also dropped below
  buildings: PAPER,

  // Roads: COOL light-grey fill + logo-grey casing. KEEP LIGHT (amber-contrast constraint above).
  other: ROAD, minor_service: ROAD, minor_a: ROAD, minor_b: ROAD, link: ROAD, major: ROAD, highway: ROAD,
  bridges_other: ROAD, bridges_minor: ROAD, bridges_link: ROAD, bridges_major: ROAD, bridges_highway: ROAD,
  tunnel_other: ROAD, tunnel_minor: ROAD, tunnel_link: ROAD, tunnel_major: ROAD, tunnel_highway: ROAD,
  minor_service_casing: CASING, minor_casing: CASING, link_casing: CASING,
  major_casing_early: CASING, major_casing_late: CASING, highway_casing_early: CASING, highway_casing_late: CASING,
  bridges_other_casing: CASING, bridges_minor_casing: CASING, bridges_link_casing: CASING,
  bridges_major_casing: CASING, bridges_highway_casing: CASING,
  tunnel_other_casing: CASING, tunnel_minor_casing: CASING, tunnel_link_casing: CASING,
  tunnel_major_casing: CASING, tunnel_highway_casing: CASING,
  railway: TAN,

  // Labels: warm brown ink, paper halo (text pops off paper/parks/water/roads)
  roads_label_minor: INK, roads_label_minor_halo: PAPER, roads_label_major: INK, roads_label_major_halo: PAPER,
  ocean_label: INK, address_label: INK, address_label_halo: PAPER,
  subplace_label: INK, subplace_label_halo: PAPER, city_label: INK, city_label_halo: PAPER,
  state_label: INK, state_label_halo: PAPER, country_label: INK,

  // Admin/boundary = tan; POIs off (parks render via geometry only, like MAP_STYLE)
  boundaries: TAN,
  pois: undefined,
};

const style = {
  version: 8,
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
  sources: {
    protomaps: {
      type: 'vector',
      url: 'pmtiles://./sf.pmtiles',          // local extract produced by scripts/build-basemap.sh
      attribution: '© OpenStreetMap contributors, © Protomaps',
    },
  },
  layers: layers('protomaps', PARCHMENT, { lang: 'en' }),
};

// Defense-in-depth: drop POI + building layers entirely (MAP_STYLE shows neither).
style.layers = style.layers.filter((l) => !/pois?|buildings/.test(l.id));

process.stdout.write(JSON.stringify(style, null, 2));

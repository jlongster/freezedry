"use strict";

// Deterministic seeded PRNG (Mulberry32) and request corpus generator for react-bench.
// Zero Math.random(), zero Date.now(), zero Intl — 100% reproducible across platforms.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const raw = mulberry32(seed);
  return {
    float() {
      return raw();
    },
    int(min, max) {
      return min + Math.floor(raw() * (max - min + 1));
    },
    bool(prob = 0.5) {
      return raw() < prob;
    },
    pick(arr) {
      return arr[Math.floor(raw() * arr.length)];
    },
  };
}

const THEMES = ["light", "dark", "contrast"];

const LOCALES = [
  { code: "en-US", currency: "USD", symbol: "$", decimals: 2, groupSep: ",", decSep: "." },
  { code: "en-GB", currency: "GBP", symbol: "£", decimals: 2, groupSep: ",", decSep: "." },
  { code: "de-DE", currency: "EUR", symbol: "€", decimals: 2, groupSep: ".", decSep: "," },
  { code: "fr-FR", currency: "EUR", symbol: "€", decimals: 2, groupSep: " ", decSep: "," },
  { code: "ja-JP", currency: "JPY", symbol: "¥", decimals: 0, groupSep: ",", decSep: "." },
];

const SORT_OPTIONS = ["featured", "price-asc", "price-desc", "rating"];
const USER_TIERS = ["member", "pro", "vip"];
const AVATAR_COLORS = ["#0284c7", "#0f766e", "#7c3aed", "#b45309", "#be123c"];

const BRANDS = [
  "Mitutoyo",
  "Knipex",
  "Wera",
  "Starrett & Co.",
  "Fluke",
  "Hakko",
  "PB Swiss",
  'Bessey "K-Body"',
  "Tormek",
  "Fein <Industrial>",
];

const PRODUCT_NOUNS = [
  "Digital Caliper 150mm",
  "Brushless Impact Driver 18V",
  "Insulated Torque Screwdriver",
  ' Carbide End Mill 1/4" & 3/8" Set',
  "Precision Dial Indicator 0.01mm",
  "ESD Soldering Station 70W",
  "Heavy-Duty Parallel Clamp",
  "Laser Cross-Line Level",
  "Bi-Metal Band Saw Blade",
  "Cryogenic Drill Bit Kit (29-pc)",
  "Micrometer Stand — Cast Iron",
  " Crimping Pliers <AWG 22-10>",
  "Digital Bench Multimeter 'True-RMS'",
  " Japanese Pull Saw 両刃のこぎり 240mm",
  "Optical Tachometer ±0.05%",
];

const CATEGORY_POOL = [
  { id: "cat-1", slug: "metrology", label: "Metrology & Gauges" },
  { id: "cat-2", slug: "hand-tools", label: "Hand Tools" },
  { id: "cat-3", slug: "power", label: "Cordless & Power" },
  { id: "cat-4", slug: "soldering", label: "Soldering & ESD" },
  { id: "cat-5", slug: "cutting", label: 'Blades, Bits & "Abrasives"' },
  { id: "cat-6", slug: "workholding", label: "Clamps <Workholding>" },
  { id: "cat-7", slug: "safety", label: "PPE & Safety 🛡️" },
  { id: "cat-8", slug: "electrical", label: "Test & Measurement" },
];

const USER_NAMES = [
  "Maya Lin",
  "Jean-Luc Picard",
  `O'Malley & Sons <Machining>`,
  `Sato 健太 (東京工場)`,
  `A. "Rusty" Kowalski`,
  "Åsa Lindström",
  "Carlos Núñez-Rivera",
  `D'Arcy & "Co." <QA>`,
  " فاطمة المنصور ",
  "Priya Subramanian",
];

const NASTY_QUERIES = [
  "",
  "caliper",
  '1/4" hex & torx',
  "<script>alert('xss')</script>",
  "Mitutoyo 0-150mm",
  `torque >= 5 N·m & < 25 N·m`,
  `両刃 "ryoba"`,
  "O'Ring #010",
];

const REVIEW_AUTHORS = [
  "ShopForeman_42",
  `K. O'Brien <CNC Lead>`,
  "高橋 誠",
  `M. "Sparky" Vance & Team`,
  "Ing. Lukas Müller",
];

const REVIEW_BODIES = [
  "Repeatable to 0.005mm across 100+ cycles; zero backlash.",
  `Replaced our old <Brand X> units & cut setup time by ~30% — worth every $!`,
  `Solid build, though the 1/4" collet runs tight on 'metric' shanks.`,
  "工場での毎日使用に耐える精度です。おすすめ！",
  `Grip stays tack-free around coolant & cutting oil; "A+" ergonomics.`,
  "Arrived calibrated with NIST cert #8841-B & foam case.",
];

const PROMO_HTML_SNIPPETS = [
  "<strong>TRADE FLASH:</strong> Extra <em>12% off</em> calibrated metrology kits",
  "<strong>FREIGHT DEAL:</strong> Free pallet dock delivery on <em>pro</em> orders",
  "<strong>NEW STOCK:</strong> Fresh batch of <em>PB Swiss &amp; Knipex</em> hand tools",
  "<strong>CLEARANCE:</strong> Up to <em>40% off</em> open-box bench instruments",
];

const SPEC_LABELS = ["Tolerance", "Drive", "Voltage", "Material", "Cert", "Range"];
const SPEC_VALUES = [
  "±0.02 mm",
  '1/4" Hex & 3/8" Sq',
  "18V Li-Ion",
  "Cr-V Steel <HRC 60>",
  "ISO 9001 / 'NIST'",
  "0–150 mm (0–6 in)",
];

const BASE_EPOCH_SEC = 1762348800; // Nov 05, 2025 13:20 UTC

function cleanNum(n) {
  if (!Number.isFinite(n) || n === 0) return 0;
  return Math.round(n * 100) / 100;
}

function generateProduct(rng, idx, locale) {
  const scale = locale.decimals === 0 ? 110 : 1;
  const brand = rng.pick(BRANDS);
  const noun = rng.pick(PRODUCT_NOUNS);
  const cat = rng.pick(CATEGORY_POOL);
  const sku = "NS-" + String(1000 + idx) + "-" + cat.slug.slice(0, 2).toUpperCase();

  const isFreeSample = rng.bool(0.03);
  const basePrice = isFreeSample ? 0 : cleanNum(rng.int(6, 480) * scale + (locale.decimals === 0 ? 0 : rng.pick([0, 0.25, 0.5, 0.95, 0.99])));
  const onSale = !isFreeSample && rng.bool(0.35);
  const originalPrice = onSale ? cleanNum(basePrice * (1 + rng.int(12, 45) / 100)) : undefined;
  const hasRebate = rng.bool(0.15);
  const rebateAmount = hasRebate ? cleanNum(-rng.int(5, 25) * scale) : undefined;

  const stockRoll = rng.float();
  const stock = stockRoll < 0.18 ? 0 : stockRoll < 0.38 ? rng.int(1, 5) : rng.int(6, 240);

  const specCount = rng.bool(0.25) ? 0 : rng.int(1, 2);
  let specs;
  if (specCount > 0) {
    specs = [];
    for (let s = 0; s < specCount; s++) {
      specs.push({
        label: SPEC_LABELS[(idx + s) % SPEC_LABELS.length],
        value: rng.pick(SPEC_VALUES),
      });
    }
  }

  const hasReview = rng.bool(0.35);
  const topReview = hasReview
    ? {
        author: rng.pick(REVIEW_AUTHORS),
        body: rng.pick(REVIEW_BODIES),
        verified: rng.bool(0.8),
        createdAtSec: BASE_EPOCH_SEC - rng.int(1, 180) * 86400,
      }
    : rng.bool(0.5)
    ? null
    : undefined;

  const product = {
    sku,
    title: brand + " " + noun.trim(),
    brand,
    category: cat.slug,
    price: basePrice,
    stock,
    rating: cleanNum(rng.int(28, 50) / 10),
    reviewCount: rng.bool(0.1) ? 0 : rng.int(1, 1450),
  };

  if (originalPrice !== undefined) product.originalPrice = originalPrice;
  if (rebateAmount !== undefined) product.rebateAmount = rebateAmount;
  if (rng.bool(0.2)) product.featured = true;
  if (rng.bool(0.12)) product.clearance = true;
  if (stock > 0 && rng.bool(0.6)) {
    product.shipsAtSec = BASE_EPOCH_SEC + rng.int(1, 10) * 86400;
  }
  if (specs !== undefined) product.specs = specs;
  if (topReview !== undefined) product.topReview = topReview;

  return product;
}

function generateRequest(seed, variant = "small") {
  const rng = makeRng(seed);
  const isLarge = variant === "large";
  const locale = rng.pick(LOCALES);
  const scale = locale.decimals === 0 ? 110 : 1;
  const theme = rng.pick(THEMES);

  const catCount = isLarge ? rng.int(6, 8) : rng.int(0, 2);
  const categories = [];
  for (let i = 0; i < catCount; i++) {
    const base = CATEGORY_POOL[i % CATEGORY_POOL.length];
    categories.push({
      id: base.id,
      slug: base.slug,
      label: base.label,
      count: rng.bool(0.12) ? 0 : rng.int(1, 2400),
      hot: rng.bool(0.25) ? true : undefined,
    });
  }

  const activeSlug = categories.length > 0 && rng.bool(0.7) ? rng.pick(categories).slug : "all";

  const crumbCount = isLarge ? rng.int(2, 4) : rng.int(0, 2);
  const breadcrumbs = [];
  if (crumbCount >= 1) breadcrumbs.push({ href: "/", label: "Home" });
  if (crumbCount >= 2) breadcrumbs.push({ href: "/catalog", label: "Catalog & Supply" });
  if (crumbCount >= 3) breadcrumbs.push({ href: "/c/" + activeSlug, label: "Category: " + activeSlug });
  if (crumbCount >= 4) breadcrumbs.push({ href: "/c/" + activeSlug + "/featured", label: ' Precision <"A+"> ' });

  const filterGroupCount = isLarge ? rng.int(3, 4) : rng.bool(0.55) ? 1 : 0;
  const filters = [];
  for (let g = 0; g < filterGroupCount; g++) {
    const optCount = isLarge ? rng.int(3, 5) : rng.int(1, 2);
    const options = [];
    for (let o = 0; o < optCount; o++) {
      options.push({
        value: "opt-" + g + "-" + o,
        label: g === 0 ? BRANDS[(seed + o) % BRANDS.length] : SPEC_VALUES[(seed + o) % SPEC_VALUES.length],
        count: rng.bool(0.15) ? 0 : rng.int(1, 180),
        selected: rng.bool(0.3),
      });
    }
    filters.push({
      id: "fg-" + g,
      title: g === 0 ? "Brand" : g === 1 ? "Specification" : g === 2 ? "Certification" : "Availability",
      disabled: rng.bool(0.1) ? true : undefined,
      options,
    });
  }

  const productCount = isLarge
    ? rng.int(170, 210)
    : rng.bool(0.18)
    ? 0
    : rng.int(1, 2);

  const products = [];
  for (let i = 0; i < productCount; i++) {
    products.push(generateProduct(rng, i, locale));
  }

  const user = rng.bool(0.6)
    ? {
        id: "usr-" + rng.int(100, 99999),
        name: rng.pick(USER_NAMES),
        tier: rng.pick(USER_TIERS),
        points: rng.bool(0.08) ? 0 : rng.bool(0.05) ? -rng.int(10, 250) : rng.int(50, 48000),
        savedCount: rng.bool(0.3) ? 0 : rng.int(1, 19),
        avatarColor: rng.bool(0.75) ? rng.pick(AVATAR_COLORS) : undefined,
      }
    : null;

  const promo = rng.bool(0.7)
    ? {
        active: rng.bool(0.82),
        urgent: rng.bool(0.35),
        code: "PRO" + rng.int(10, 99),
        html: rng.pick(PROMO_HTML_SNIPPETS),
        minOrder: rng.bool(0.5) ? cleanNum(rng.int(50, 250) * scale) : undefined,
      }
    : null;

  const spotlight = (isLarge ? rng.bool(0.8) : rng.bool(0.25))
    ? {
        sku: "SPOT-" + rng.int(100, 999),
        headline: rng.pick(BRANDS) + " — Master Calibration Bundle",
        blurb: rng.bool(0.65) ? 'Includes traceable cert & <foam> case ("Rev B").' : undefined,
        price: cleanNum(rng.int(99, 399) * scale),
        originalPrice: rng.bool(0.8) ? cleanNum(rng.int(420, 599) * scale) : undefined,
        stock: rng.bool(0.15) ? 0 : rng.int(2, 40),
        endsAtSec: BASE_EPOCH_SEC + rng.int(3600, 172800),
      }
    : null;

  const cartItemCount = isLarge ? rng.int(1, 4) : rng.bool(0.45) ? 0 : 1;
  const cartItems = [];
  for (let c = 0; c < cartItemCount; c++) {
    cartItems.push({
      sku: "CRT-" + (10 + c) + "-" + rng.int(10, 99),
      title: BRANDS[(seed + c) % BRANDS.length] + " " + PRODUCT_NOUNS[(seed + c) % PRODUCT_NOUNS.length].trim(),
      qty: rng.int(1, 6),
      unitPrice: cleanNum(rng.int(12, 190) * scale),
      backordered: rng.bool(0.2) ? true : undefined,
    });
  }

  const totalPages = productCount === 0 ? 0 : isLarge ? rng.int(3, 8) : rng.bool(0.35) ? rng.int(2, 4) : 1;
  const currentPage = totalPages <= 1 ? 1 : rng.int(1, totalPages);

  return {
    requestId: "req-" + seed + "-" + variant,
    timestampSec: BASE_EPOCH_SEC + rng.int(-86400 * 30, 86400 * 365),
    theme,
    compactMode: rng.bool(0.3),
    locale,
    user,
    promo,
    search: {
      query: rng.pick(NASTY_QUERIES),
      categorySlug: activeSlug,
      sortBy: rng.pick(SORT_OPTIONS),
      inStockOnly: rng.bool(0.35),
      disabled: rng.bool(0.08) ? true : undefined,
      readOnly: rng.bool(0.08) ? true : undefined,
      required: rng.bool(0.12) ? true : undefined,
    },
    categories,
    breadcrumbs,
    filters,
    spotlight,
    products,
    cart: {
      taxRate: rng.bool(0.15) ? 0 : 0.0825,
      freeShippingThreshold: cleanNum(150 * scale),
      creditAdjustment: rng.bool(0.2) ? cleanNum(-rng.int(5, 30) * scale) : 0,
      notesOpen: rng.bool(0.25) ? true : undefined,
      items: cartItems,
    },
    pagination: {
      currentPage,
      totalPages,
      totalMatching: productCount === 0 ? 0 : productCount * Math.max(1, totalPages),
    },
  };
}

function buildEdgeCaseInputs() {
  const cases = [];

  // 0. Completely empty collections & nullable objects
  cases.push({
    requestId: "edge-00-all-empty",
    timestampSec: BASE_EPOCH_SEC,
    theme: "light",
    compactMode: false,
    locale: LOCALES[0],
    user: null,
    promo: null,
    search: {
      query: "",
      categorySlug: "all",
      sortBy: "featured",
      inStockOnly: false,
    },
    categories: [],
    breadcrumbs: [],
    filters: [],
    spotlight: null,
    products: [],
    cart: {
      taxRate: 0,
      freeShippingThreshold: 100,
      creditAdjustment: 0,
      items: [],
    },
    pagination: { currentPage: 1, totalPages: 0, totalMatching: 0 },
  });

  // 1. Nasty HTML/attribute escaping in empty-search state + boolean input flags
  cases.push({
    requestId: 'edge-01-xss-"attr"&<tag>',
    timestampSec: 0, // Unix epoch exact 0 (Jan 01, 1970 00:00 UTC)
    theme: "dark",
    compactMode: true,
    locale: LOCALES[1],
    user: {
      id: `u-<1>&"2"`,
      name: `<script>alert("O'Connor & Sons")</script>`,
      tier: "vip",
      points: 0,
      savedCount: 0,
    },
    promo: {
      active: false, // hidden=""
      urgent: true,
      code: `X&Y"Z`,
      html: "<strong>HIDDEN PROMO:</strong> <em>0%</em>",
      minOrder: 0,
    },
    search: {
      query: `"><img src=x onerror='1'>&`,
      categorySlug: "metrology",
      sortBy: "price-asc",
      inStockOnly: true,
      disabled: true,
      readOnly: true,
      required: true,
    },
    categories: [
      { id: "c1", slug: "metrology", label: `Gauges <0.001"> & 'Calipers'`, count: 0, hot: true },
    ],
    breadcrumbs: [
      { href: "/", label: "Home & <Root>" },
      { href: "/search?a=1&b=2", label: `Query: "xss" & 'quotes'` },
    ],
    filters: [
      { id: "empty-fg", title: "Empty <Group>", disabled: true, options: [] },
    ],
    spotlight: null,
    products: [],
    cart: {
      taxRate: 0.1,
      freeShippingThreshold: 50,
      creditAdjustment: -25,
      notesOpen: true,
      items: [],
    },
    pagination: { currentPage: 1, totalPages: 1, totalMatching: 0 },
  });

  // 2. Zero prices, negative rebates/adjustments, pre-1970 negative epoch, unicode/RTL/emoji
  cases.push({
    requestId: "edge-02-zeros-negatives-unicode",
    timestampSec: -86400, // Dec 31, 1969 00:00 UTC
    theme: "contrast",
    compactMode: false,
    locale: LOCALES[2], // de-DE (1.234,56)
    user: {
      id: "u-intl",
      name: "  佐藤 健太 & فاطمة 🚀  ",
      tier: "pro",
      points: -150,
      savedCount: 3,
      avatarColor: "#be123c",
    },
    promo: {
      active: true,
      urgent: false,
      code: "EURO-2026",
      html: "<strong>GRATIS:</strong> Kalibrierschein <em>inklusive</em>",
      minOrder: 1250.5,
    },
    search: {
      query: "両刃のこぎり ±0.01",
      categorySlug: "cutting",
      sortBy: "rating",
      inStockOnly: false,
    },
    categories: [
      { id: "c-cut", slug: "cutting", label: "Sägen & Schneiden", count: 1024 },
    ],
    breadcrumbs: [{ href: "/", label: "Startseite" }],
    filters: [
      {
        id: "mat",
        title: "Werkstoff",
        options: [
          { value: "hss", label: "HSS-Co5 <M35>", count: 0, selected: false },
          { value: "vhm", label: 'Vollhartmetall "TiAlN"', count: 12, selected: true },
        ],
      },
    ],
    spotlight: {
      sku: "FREE-CAL-0",
      headline: "Free Calibration Coupon — 0,00 €",
      price: 0,
      originalPrice: 49.9,
      stock: 0,
      endsAtSec: 0,
    },
    products: [
      {
        sku: "ZERO-001",
        title: "Sample Shim Pack (0.00mm–1.00mm) — Free w/ Order",
        brand: "Starrett & Co.",
        category: "metrology",
        price: 0,
        stock: 0,
        rating: 0,
        reviewCount: 0,
      },
      {
        sku: "NEG-REB-002",
        title: `Precision Level 200mm "Master" <0.02mm/m> 🛠️`,
        brand: "Mitutoyo",
        category: "metrology",
        price: 1234.5,
        originalPrice: 1599.0,
        rebateAmount: -75.25,
        stock: 3,
        rating: 5,
        reviewCount: 12840,
        featured: true,
        clearance: true,
        shipsAtSec: BASE_EPOCH_SEC + 86400,
        specs: [
          { label: "Length", value: "200 mm" },
          { label: "Sensitivity", value: `0.02 mm/m ("4 arcsec")` },
        ],
        topReview: {
          author: `Dr.-Ing. H. "Hans" Weiß & Partner`,
          body: `Dead-flat sole; zero drift between 18°C & 24°C <verified>.`,
          verified: true,
          createdAtSec: BASE_EPOCH_SEC - 864000,
        },
      },
    ],
    cart: {
      taxRate: 0.19,
      freeShippingThreshold: 2000,
      creditAdjustment: -100.5,
      notesOpen: false,
      items: [
        {
          sku: "NEG-REB-002",
          title: `Precision Level 200mm "Master"`,
          qty: 1,
          unitPrice: 1234.5,
          backordered: true,
        },
      ],
    },
    pagination: { currentPage: 3, totalPages: 6, totalMatching: 120 },
  });

  // 3. JPY 0-decimal formatting + single-word user initials + whitespace-only user name
  cases.push({
    requestId: "edge-03-jpy-zero-decimals",
    timestampSec: BASE_EPOCH_SEC + 99999,
    theme: "light",
    compactMode: true,
    locale: LOCALES[4], // ja-JP (decimals: 0)
    user: {
      id: "u-single",
      name: "   ",
      tier: "member",
      points: 1234567,
      savedCount: 1,
    },
    promo: null,
    search: {
      query: "",
      categorySlug: "all",
      sortBy: "price-desc",
      inStockOnly: false,
    },
    categories: [],
    breadcrumbs: [],
    filters: [],
    spotlight: null,
    products: [
      {
        sku: "JP-900",
        title: "ミツトヨ デジタルノギス 150mm",
        brand: "Mitutoyo",
        category: "metrology",
        price: 18500,
        originalPrice: 22000,
        stock: 42,
        rating: 4.9,
        reviewCount: 308,
        shipsAtSec: BASE_EPOCH_SEC + 172800,
        specs: [],
        topReview: {
          author: "田中",
          body: "最高の精度 & 使いやすさ 'A+'",
          verified: false,
          createdAtSec: BASE_EPOCH_SEC,
        },
      },
    ],
    cart: {
      taxRate: 0.1,
      freeShippingThreshold: 10000,
      creditAdjustment: 0,
      items: [{ sku: "JP-900", title: "デジタルノギス", qty: 2, unitPrice: 18500 }],
    },
    pagination: { currentPage: 1, totalPages: 2, totalMatching: 25 },
  });

  return cases;
}

const CORPUS_SIZE = 500;
const SMALL_SEED_BASE = 0x52454143; // "REAC"
const LARGE_SEED_BASE = 0x4c415247; // "LARG"

let _smallCorpus = null;
let _largeCorpus = null;
let _checkCorpus = null;

function getSmallCorpus() {
  if (_smallCorpus) return _smallCorpus;
  const edge = buildEdgeCaseInputs();
  const out = edge.slice();
  let idx = 0;
  while (out.length < CORPUS_SIZE) {
    out.push(generateRequest(SMALL_SEED_BASE + idx * 7919, "small"));
    idx++;
  }
  _smallCorpus = out;
  return out;
}

function getLargeCorpus(count = 100) {
  if (_largeCorpus && _largeCorpus.length >= count) {
    return _largeCorpus.slice(0, count);
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(generateRequest(LARGE_SEED_BASE + i * 104729, "large"));
  }
  if (count >= 100) _largeCorpus = out;
  return out;
}

// Fixed 500-input corpus for correctness checking (`check.js`):
// - 4 edge-case inputs + 471 seeded small-page inputs (~50 elements each)
// - 25 seeded large-page inputs (~200 products, ~3,300 elements each)
function getCheckCorpus() {
  if (_checkCorpus) return _checkCorpus;
  const small = getSmallCorpus();
  const large = getLargeCorpus(25);
  _checkCorpus = small.slice(0, 475).concat(large);
  return _checkCorpus;
}

// Inputs for implementations that want to "train" (trace, profile, collect shapes) before
// being checked. Seeds are disjoint from the check/perf corpora.
const TRAIN_SEED_BASE = 0x54524e00; // "TRN\0"
function getTrainingCorpus(count = 50, variant = "small") {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(generateRequest(TRAIN_SEED_BASE + i * 31337 + (variant === "large" ? 1 : 0), variant));
  }
  return out;
}

// Stable fingerprint of a corpus (JSON with undefined made explicit), printed by check.js so
// that agents on different branches can confirm they test against the same inputs.
function corpusFingerprint(corpus) {
  const json = JSON.stringify(corpus, (_k, v) => (v === undefined ? "__undefined__" : v));
  return require("crypto").createHash("sha256").update(json).digest("hex").slice(0, 16);
}

if (require.main === module) {
  // node bench/react/data.js [--dump out.json]   (JSON drops undefined-valued keys)
  const corpus = getCheckCorpus();
  const i = process.argv.indexOf("--dump");
  if (i !== -1) {
    require("fs").writeFileSync(process.argv[i + 1], JSON.stringify(corpus, null, 1) + "\n");
  }
  console.log(`check corpus: ${corpus.length} inputs, fingerprint ${corpusFingerprint(corpus)}`);
}

module.exports = {
  CORPUS_SIZE,
  getTrainingCorpus,
  corpusFingerprint,
  mulberry32,
  generateRequest,
  buildEdgeCaseInputs,
  getSmallCorpus,
  getLargeCorpus,
  getCheckCorpus,
};

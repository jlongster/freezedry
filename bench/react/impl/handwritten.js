"use strict";

// Hand-specialized renderer for react-bench/app/app.jsx: the whole component tree folded by
// hand into straight-line string concatenation. No React at runtime, no element objects, no
// hooks dispatcher; useId values are constants (or computed with a copy of React's tree-id
// arithmetic for the one list that contains useId). Upper bound on what an automatic
// specializer can reach on this app. It is only valid for this exact app source.
//
// Mirrors React 18.3 Fizz renderToString semantics used by the app:
//  - adjacent text children are separated by "<!-- -->" (empty strings / null emit nothing)
//  - a lone string child of a host element is written without separators
//  - boolean attrs (hidden, disabled, readOnly, required, open, itemScope, checked, selected) -> name=""
//  - data-* / aria-* booleans -> "true"/"false"; null/undefined attrs omitted
//  - <input>: checked then value appended after the other attributes
//  - <select defaultValue>: selected="" on the matching <option>

const fs = require("fs");
const path = require("path");

const ESC_TEST = /["'&<>]/;
const ESC_ALL = /["'&<>]/g;
function escChar(c) {
  switch (c) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    default:
      return "&#x27;";
  }
}
function esc(s) {
  s = "" + s;
  return ESC_TEST.test(s) ? s.replace(ESC_ALL, escChar) : s;
}
// A text child that follows another text child in the same parent.
function textAfterText(v) {
  if (v == null || typeof v === "boolean" || v === "") return "";
  return "<!-- -->" + esc(v);
}
function attr(name, v) {
  return v == null ? "" : " " + name + '="' + esc(v) + '"';
}

// ---- app helpers (copied from the app: they are app logic, not React) ----
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}
function formatDateUTC(epochSec, includeTime) {
  var sec = Math.floor(epochSec);
  var days = Math.floor(sec / 86400);
  var remSec = sec - days * 86400;
  if (remSec < 0) {
    days -= 1;
    remSec += 86400;
  }
  var z = days + 719468;
  var era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  var doe = z - era * 146097;
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  var m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  var base = MONTH_NAMES[m - 1] + " " + pad2(d) + ", " + y;
  if (!includeTime) return base;
  var hh = Math.floor(remSec / 3600);
  var mm = Math.floor((remSec - hh * 3600) / 60);
  return base + " " + pad2(hh) + ":" + pad2(mm) + " UTC";
}
function groupDigits(intStr, sep) {
  if (!sep || intStr.length <= 3) return intStr;
  var out = "";
  var count = 0;
  for (var i = intStr.length - 1; i >= 0; i--) {
    if (count > 0 && count % 3 === 0) out = sep + out;
    out = intStr.charAt(i) + out;
    count++;
  }
  return out;
}
function formatInt(n, groupSep) {
  var neg = n < 0;
  var abs = Math.floor(Math.abs(n) + 0.5);
  var grouped = groupDigits("" + abs, groupSep === undefined ? "," : groupSep);
  return neg ? "-" + grouped : grouped;
}
function formatMoney(amount, locale) {
  var decimals = locale && typeof locale.decimals === "number" ? locale.decimals : 2;
  var symbol = locale && locale.symbol ? locale.symbol : "$";
  var groupSep = locale && locale.groupSep !== undefined ? locale.groupSep : ",";
  var decSep = locale && locale.decSep !== undefined ? locale.decSep : ".";
  var neg = amount < 0;
  var abs = Math.abs(amount);
  var parts = abs.toFixed(decimals).split(".");
  var whole = groupDigits(parts[0], groupSep);
  var formatted = decimals > 0 ? symbol + whole + decSep + parts[1] : symbol + whole;
  return neg && abs > 0 ? "-" + formatted : formatted;
}
const PALETTES = {
  dark: { bg: "#0f172a", fg: "#f8fafc", accent: "#38bdf8" },
  contrast: { bg: "#000000", fg: "#ffffff", accent: "#facc15" },
  light: { bg: "#f8fafc", fg: "#0f172a", accent: "#0284c7" },
};
function palette(theme) {
  return theme === "dark" ? PALETTES.dark : theme === "contrast" ? PALETTES.contrast : PALETTES.light;
}
function computeInitials(name) {
  if (!name) return "?";
  var trimmed = name.trim();
  if (!trimmed) return "?";
  var parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

// ---- React useId tree-context arithmetic (copy of Fizz pushTreeContext/getTreeId) ----
function bitLength(n) {
  return 32 - Math.clz32(n);
}
function pushTreeContext(base, totalChildren, index) {
  var baseIdWithLeadingBit = base.id;
  var baseOverflow = base.overflow;
  var baseLength = bitLength(baseIdWithLeadingBit) - 1;
  var baseId = baseIdWithLeadingBit & ~(1 << baseLength);
  var slot = index + 1;
  var length = bitLength(totalChildren) + baseLength;
  if (length > 30) {
    var numberOfOverflowBits = baseLength - (baseLength % 5);
    var newOverflowBits = (1 << numberOfOverflowBits) - 1;
    var newOverflow = (baseId & newOverflowBits).toString(32);
    var restOfBaseId = baseId >> numberOfOverflowBits;
    var restOfBaseLength = baseLength - numberOfOverflowBits;
    var restOfLength = bitLength(totalChildren) + restOfBaseLength;
    var restOfNewBits = slot << restOfBaseLength;
    return { id: (1 << restOfLength) | restOfNewBits | restOfBaseId, overflow: newOverflow + baseOverflow };
  }
  return { id: (1 << length) | (slot << baseLength) | baseId, overflow: baseOverflow };
}
function treeId(ctx) {
  var id = ctx.id & ~(1 << (bitLength(ctx.id) - 1));
  return id.toString(32) + ctx.overflow;
}
// Root -> PageShell div child #3 of 5 -> .ns-layout child #0 of 3 = FilterSidebar (":Rc:"),
// which materializes an id (push 1,0), then <aside> child #2 of 3 = the filters.map array.
const SIDEBAR_CTX = pushTreeContext(pushTreeContext({ id: 1, overflow: "" }, 5, 3), 3, 0);
const FILTER_LIST_CTX = pushTreeContext(pushTreeContext(SIDEBAR_CTX, 1, 0), 3, 2);
const SIDEBAR_ID = ":R" + treeId(SIDEBAR_CTX) + ":"; // ":Rc:"
const SIDEBAR_ID2 = ":R" + treeId(SIDEBAR_CTX) + "H1:"; // ":RcH1:"
const SEARCH_ID = ":R2a:"; // PageShell #1/5 -> header #0/2 -> .ns-header-top #1/3
const SORT_ID = ":R2k:"; // PageShell #3/5 -> .ns-layout #1/3 -> main #1/4

// ---- page ----
function render(data) {
  const theme = data.theme;
  const locale = data.locale;
  const user = data.user;
  const pal = palette(theme);
  const gs = locale.groupSep;
  const products = data.products;
  const search = data.search;

  let inStockCount = 0;
  let onSaleCount = 0;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (p.stock > 0) inStockCount++;
    if (typeof p.originalPrice === "number" && p.originalPrice > p.price) onSaleCount++;
  }

  let h =
    '<div id="northstar-app" class="ns-shell ns-theme-' +
    esc(theme) +
    (data.compactMode ? " ns-compact" : "") +
    '"' +
    attr("data-theme", theme) +
    attr("data-locale", locale.code) +
    attr("data-request-id", data.requestId) +
    ' style="background-color:' +
    pal.bg +
    ";color:" +
    pal.fg +
    ';min-height:100vh">';

  // AnnouncementBanner
  const promo = data.promo;
  if (promo) {
    h +=
      '<section class="ns-promo' +
      (promo.urgent ? " ns-promo-urgent" : "") +
      '"' +
      (promo.active ? "" : ' hidden=""') +
      attr("data-campaign", promo.code) +
      '><span class="ns-promo-html">' +
      promo.html +
      "</span>";
    if (promo.minOrder !== undefined && promo.minOrder > 0) {
      h += '<span class="ns-promo-min"> <!-- -->(Min. order <!-- -->' + esc(formatMoney(promo.minOrder, locale)) + "<!-- -->)</span>";
    }
    h += '<code class="ns-promo-code">' + esc(promo.code) + "</code></section>";
  }

  // SiteHeader > SearchBox, UserMenu
  const q = search.query;
  h +=
    '<header class="ns-header"><div class="ns-header-top"><a href="/" class="ns-brand" data-brand="northstar">Northstar Supply</a>' +
    '<form class="ns-search" role="search" action="/catalog" method="get"><label class="ns-sr-only" for="' +
    SEARCH_ID +
    '">Search hardware</label><input type="search" id="' +
    SEARCH_ID +
    '" name="q" placeholder="Search SKU, tool, or spec..."' +
    (search.disabled ? ' disabled=""' : "") +
    (search.readOnly ? ' readonly=""' : "") +
    (search.required ? ' required=""' : "") +
    ' autoComplete="off" data-has-query="' +
    Boolean(q && q.length > 0) +
    '"' +
    attr("value", q) +
    '/><button data-action="catalog-search" aria-label="Run catalog search" type="submit" class="ns-btn ns-btn-secondary ns-btn-sm"' +
    (search.disabled ? ' disabled=""' : "") +
    ' data-variant="secondary">Search</button></form>';
  if (!user) {
    h +=
      '<div class="ns-user ns-user-anon" data-authenticated="false"><a href="/signin" class="ns-link">Sign in</a><a href="/register" class="ns-link ns-link-cta">Trade Account</a></div>';
  } else {
    const tier = user.tier || "member";
    h +=
      '<div class="ns-user ns-user-auth" data-authenticated="true"' +
      attr("data-user-id", user.id) +
      '><span class="ns-avatar" aria-hidden="true" style="background-color:' +
      esc(("" + (user.avatarColor || "#0369a1")).trim()) +
      ';color:#ffffff;width:28px;height:28px;line-height:28px;font-weight:700">' +
      esc(computeInitials(user.name)) +
      '</span><span class="ns-greeting">Hi, ' +
      textAfterText(user.name) +
      '</span><span class="ns-tier ns-tier-' +
      esc(tier) +
      '" data-tier="' +
      esc(tier) +
      '"' +
      attr("data-points", user.points) +
      ">" +
      esc(tier.toUpperCase()) +
      "<!-- --> (<!-- -->" +
      formatInt(user.points, gs) +
      "<!-- --> pts)</span>" +
      (user.savedCount > 0 ? '<a href="/saved" class="ns-saved-link">Saved (<!-- -->' + user.savedCount + "<!-- -->)</a>" : "") +
      "</div>";
  }
  h += "</div>";

  // PrimaryNav
  const cats = data.categories;
  if (cats && cats.length > 0) {
    const activeSlug = search.categorySlug;
    h += '<nav class="ns-nav" aria-label="Categories"><ul class="ns-nav-list">';
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      const active = c.slug === activeSlug;
      h +=
        '<li class="ns-nav-item' +
        (active ? " is-active" : "") +
        '"><a href="/c/' +
        esc(c.slug) +
        '"' +
        (active ? ' aria-current="page"' : "") +
        attr("data-category", c.slug) +
        '><span class="ns-nav-label">' +
        esc(c.label) +
        "</span>" +
        countPill(c.count, c.hot, gs) +
        "</a></li>";
    }
    h += "</ul></nav>";
  }
  h += "</header>";

  // Breadcrumbs
  const crumbs = data.breadcrumbs;
  if (crumbs && crumbs.length > 0) {
    h += '<nav class="ns-crumbs" aria-label="Breadcrumb"><ol class="ns-crumb-list">';
    const last = crumbs.length - 1;
    for (let i = 0; i < crumbs.length; i++) {
      const cr = crumbs[i];
      if (i > 0) h += '<li class="ns-crumb-sep" aria-hidden="true">/</li>';
      h +=
        i === last
          ? '<li class="ns-crumb-item is-current"><span aria-current="page">' + esc(cr.label) + "</span></li>"
          : '<li class="ns-crumb-item"><a' + attr("href", cr.href) + ">" + esc(cr.label) + "</a></li>";
    }
    h += "</ol></nav>";
  }

  // FilterSidebar
  const filters = data.filters;
  h +=
    '<div class="ns-layout"><aside class="ns-sidebar" aria-labelledby="' +
    SIDEBAR_ID +
    '"><h2 id="' +
    SIDEBAR_ID +
    '" class="ns-sidebar-title">Filters</h2><div class="ns-stock-toggle"><input type="checkbox" id="' +
    SIDEBAR_ID2 +
    '" name="in_stock"' +
    (search.inStockOnly ? ' checked=""' : "") +
    '/><label for="' +
    SIDEBAR_ID2 +
    '">In-stock items only</label></div>';
  for (let g = 0; g < filters.length; g++) {
    const group = filters[g];
    const opts = group.options;
    h +=
      '<fieldset class="ns-filter-group"' +
      (group.disabled ? ' disabled=""' : "") +
      attr("data-filter-key", group.id) +
      '><legend class="ns-filter-legend">' +
      esc(group.title) +
      "</legend>";
    if (opts.length === 0) {
      h += '<p class="ns-filter-empty">No options</p>';
    } else {
      h += '<ul class="ns-filter-list">';
      const listCtx = pushTreeContext(pushTreeContext(FILTER_LIST_CTX, filters.length, g), 2, 1);
      for (let o = 0; o < opts.length; o++) {
        const opt = opts[o];
        const id = ":R" + treeId(pushTreeContext(listCtx, opts.length, o)) + ":";
        h +=
          '<li class="ns-filter-opt' +
          (opt.selected ? " is-selected" : "") +
          '"><input type="checkbox" id="' +
          id +
          '" name="f_' +
          esc(group.id) +
          '"' +
          (group.disabled || opt.count === 0 ? ' disabled=""' : "") +
          (opt.selected ? ' checked=""' : "") +
          attr("value", opt.value) +
          '/><label for="' +
          id +
          '">' +
          esc(opt.label) +
          "</label>" +
          countPill(opt.count, false, gs) +
          "</li>";
      }
      h += "</ul>";
    }
    h += "</fieldset>";
  }
  h += '</aside><main class="ns-main">';

  // HeroSpotlight
  const spot = data.spotlight;
  if (spot) {
    h +=
      '<section class="ns-spotlight"' +
      attr("data-sku", spot.sku) +
      '><div class="ns-spotlight-body"><span class="ns-spotlight-kicker">Deal of the Day</span><h2 class="ns-spotlight-title">' +
      esc(spot.headline) +
      "</h2>" +
      (spot.blurb ? '<p class="ns-spotlight-blurb">' + esc(spot.blurb) + "</p>" : "") +
      '<p class="ns-spotlight-ends">Ends <!-- -->' +
      formatDateUTC(spot.endsAtSec, true) +
      '</p></div><div class="ns-spotlight-aside">' +
      priceBlock(spot.price, spot.originalPrice, undefined, locale) +
      stockBadge(spot.stock, undefined) +
      '<button data-spotlight-sku="' +
      esc(spot.sku) +
      '" type="button" class="ns-btn ns-btn-primary"' +
      (spot.stock <= 0 ? ' disabled=""' : "") +
      ' data-variant="primary">View Deal</button></div></section>';
  }

  // CatalogToolbar
  const sortBy = search.sortBy;
  h +=
    '<div class="ns-toolbar"><p class="ns-toolbar-summary">Showing <strong>' +
    formatInt(products.length, gs) +
    "</strong> <!-- -->of <strong>" +
    formatInt(data.pagination.totalMatching, gs) +
    "</strong> <!-- -->items (<!-- -->" +
    inStockCount +
    "<!-- --> ready, <!-- -->" +
    onSaleCount +
    '<!-- --> on sale)</p><div class="ns-toolbar-sort"><label for="' +
    SORT_ID +
    '">Sort:</label><select id="' +
    SORT_ID +
    '" name="sort"><option value="featured"' +
    (sortBy === "featured" ? ' selected=""' : "") +
    '>Featured</option><option value="price-asc"' +
    (sortBy === "price-asc" ? ' selected=""' : "") +
    '>Price: Low to High</option><option value="price-desc"' +
    (sortBy === "price-desc" ? ' selected=""' : "") +
    '>Price: High to Low</option><option value="rating"' +
    (sortBy === "rating" ? ' selected=""' : "") +
    ">Customer Rating</option></select></div></div>";

  // ProductGrid
  if (products.length === 0) {
    h +=
      '<div class="ns-empty" role="status"' +
      attr("data-query", q) +
      '><h3 class="ns-empty-title">No matching products found</h3><p class="ns-empty-desc">' +
      esc(q ? 'No hardware matched "' + q + '". Try clearing filters.' : "This category currently has 0 items available.") +
      '</p><button data-action="reset-filters" type="button" class="ns-btn ns-btn-secondary" data-variant="secondary">Reset Filters</button></div>';
  } else {
    h += '<div class="ns-grid" data-count="' + products.length + '">';
    for (let i = 0; i < products.length; i++) {
      h += productCard(products[i], i, locale, pal);
    }
    h += "</div>";
  }

  // PaginationBar
  const pag = data.pagination;
  if (pag && pag.totalPages > 1) {
    h += '<nav class="ns-pagination" aria-label="Pagination">';
    const start = Math.max(1, pag.currentPage - 2);
    const end = Math.min(pag.totalPages, start + 4);
    for (let n = start; n <= end; n++) {
      h +=
        n === pag.currentPage
          ? '<a href="?page=' + n + '" class="ns-page-link is-active" aria-current="page">' + n + "</a>"
          : '<a href="?page=' + n + '" class="ns-page-link">' + n + "</a>";
    }
    h += "</nav>";
  }
  h += "</main>";

  h += cartAside(data.cart, locale, user);

  h +=
    '</div><footer class="ns-footer"><p class="ns-footer-copy">© Northstar Industrial Supply · Generated<!-- --> <time>' +
    formatDateUTC(data.timestampSec, true) +
    '</time></p><p class="ns-footer-meta"><span>Locale: ' +
    textAfterText(locale.code) +
    "</span> · <span>Currency: " +
    textAfterText(locale.currency) +
    "</span> · <span>Theme: " +
    textAfterText(theme) +
    "</span></p></footer></div>";
  return h;
}

function countPill(count, hot, gs) {
  return (
    '<span class="ns-pill' +
    (hot ? " ns-pill-hot" : "") +
    '"' +
    (count <= 0 ? ' hidden=""' : "") +
    ' data-zero="' +
    (count === 0) +
    '">' +
    esc(formatInt(count, gs)) +
    "</span>"
  );
}

function priceBlock(price, orig, rebate, locale) {
  const hasDiscount = typeof orig === "number" && orig > price && orig > 0;
  let h =
    '<div class="ns-price-block" data-on-sale="' +
    hasDiscount +
    '"><span class="ns-price-current">' +
    esc(formatMoney(price, locale)) +
    "</span>";
  if (hasDiscount) {
    h +=
      '<del class="ns-price-orig">' +
      esc(formatMoney(orig, locale)) +
      '</del><span class="ns-price-save">Save <!-- -->' +
      Math.round(((orig - price) / orig) * 100) +
      "<!-- -->%</span>";
  }
  if (typeof rebate === "number" && rebate !== 0) {
    h += '<span class="ns-price-rebate">Rebate: <!-- -->' + esc(formatMoney(rebate, locale)) + "</span>";
  }
  return h + "</div>";
}

function stockBadge(stock, shipsAtSec) {
  if (stock <= 0) return '<span class="ns-stock ns-stock-out" data-stock-state="out">Out of stock</span>';
  if (stock <= 5) return '<span class="ns-stock ns-stock-low" data-stock-state="low">Only <!-- -->' + stock + "<!-- --> left</span>";
  return (
    '<span class="ns-stock ns-stock-in" data-stock-state="in">In stock' +
    (typeof shipsAtSec === "number" ? "<!-- --> · Ships " + formatDateUTC(shipsAtSec, false) : "") +
    "</span>"
  );
}

function productCard(p, index, locale, pal) {
  const inStock = p.stock > 0;
  const featured = Boolean(p.featured);
  const onSale = typeof p.originalPrice === "number" && p.originalPrice > p.price;
  const sku = esc(p.sku);
  const title = esc(p.title);
  const gs = locale.groupSep;
  let h =
    '<article data-sku="' +
    sku +
    '"' +
    attr("data-category", p.category) +
    ' data-in-stock="' +
    inStock +
    '" data-featured="' +
    featured +
    '" itemscope="" class="ns-card' +
    (featured ? " ns-card-featured" : "") +
    (inStock ? "" : " ns-card-out") +
    '" style="' +
    (featured ? "border-color:" + pal.accent + ";" : "") +
    "order:" +
    index +
    '">';
  if (featured || p.clearance || onSale) {
    h +=
      '<div class="ns-badges">' +
      (featured ? '<span class="ns-badge ns-badge-featured">Featured</span>' : "") +
      (onSale ? '<span class="ns-badge ns-badge-sale">Sale</span>' : "") +
      (p.clearance ? '<span class="ns-badge ns-badge-clearance">Clearance</span>' : "") +
      "</div>";
  }
  const rating = p.rating;
  const clamped = rating < 0 ? 0 : rating > 5 ? 5 : rating;
  const fixed = clamped.toFixed(1);
  h +=
    '<div class="ns-card-head"><span class="ns-card-brand">' +
    esc(p.brand) +
    '</span><span class="ns-card-sku">#' +
    textAfterText(p.sku) +
    '</span></div><h3 class="ns-card-title"><a href="/p/' +
    sku +
    '" title="' +
    title +
    '">' +
    title +
    '</a></h3><div class="ns-rating" aria-label="Rated ' +
    fixed +
    ' out of 5"><span class="ns-rating-track" aria-hidden="true"><span class="ns-rating-fill" style="width:' +
    Math.round((clamped / 5) * 100) +
    "%;opacity:" +
    (p.reviewCount > 0 ? "1" : "0.35") +
    '"></span></span><span class="ns-rating-num">' +
    fixed +
    '</span><span class="ns-rating-count">(<!-- -->' +
    esc(formatInt(p.reviewCount, gs)) +
    "<!-- -->)</span></div>";
  const specs = p.specs;
  if (specs && specs.length > 0) {
    h += '<dl class="ns-specs">';
    for (let i = 0; i < specs.length; i++) {
      h += '<dt class="ns-spec-label">' + esc(specs[i].label) + '</dt><dd class="ns-spec-val">' + esc(specs[i].value) + "</dd>";
    }
    h += "</dl>";
  }
  h +=
    priceBlock(p.price, p.originalPrice, p.rebateAmount, locale) +
    '<div class="ns-card-footer">' +
    stockBadge(p.stock, p.shipsAtSec) +
    '<button data-add-sku="' +
    sku +
    '" aria-label="' +
    (inStock ? "Add to cart: " : "Unavailable: ") +
    title +
    (inStock
      ? '" type="button" class="ns-btn ns-btn-primary ns-btn-sm" data-variant="primary">Add to Cart</button></div>'
      : '" type="button" class="ns-btn ns-btn-ghost ns-btn-sm" disabled="" data-variant="ghost">Notify Me</button></div>');
  const r = p.topReview;
  if (r) {
    h +=
      '<blockquote class="ns-review" data-verified="' +
      Boolean(r.verified) +
      '"><p class="ns-review-body">“' +
      textAfterText(r.body) +
      '<!-- -->”</p><footer class="ns-review-meta"><span class="ns-review-author">' +
      esc(r.author) +
      "</span>" +
      (r.verified ? '<span class="ns-review-badge">Verified Buyer</span>' : "") +
      '<time class="ns-review-date">' +
      formatDateUTC(r.createdAtSec, false) +
      "</time></footer></blockquote>";
  }
  return h + "</article>";
}

function cartAside(cart, locale, user) {
  const items = cart.items;
  let subtotal = 0;
  let unitCount = 0;
  for (let i = 0; i < items.length; i++) {
    subtotal += items[i].qty * items[i].unitPrice;
    unitCount += items[i].qty;
  }
  const rate = user && user.tier === "vip" ? 0.1 : user && user.tier === "pro" ? 0.05 : 0;
  const memberDiscount = subtotal > 0 ? -(subtotal * rate) : 0;
  const afterDiscount = subtotal + memberDiscount + cart.creditAdjustment;
  const taxable = afterDiscount > 0 ? afterDiscount : 0;
  const shipping = unitCount === 0 || taxable >= cart.freeShippingThreshold ? 0 : 14.95;
  const tax = taxable * cart.taxRate;
  const grandTotal = afterDiscount + shipping + tax;
  const isEmpty = items.length === 0;

  let h = '<aside class="ns-cart" data-empty="' + isEmpty + '"><h2 class="ns-cart-title">Order Quote (<!-- -->' + unitCount + "<!-- -->)</h2>";
  if (isEmpty) {
    h += '<p class="ns-cart-empty">Your quote list is empty.</p>';
  } else {
    h += '<ul class="ns-cart-list">';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      h +=
        '<li class="ns-cart-item"' +
        attr("data-sku", it.sku) +
        '><div class="ns-cart-item-main"><span class="ns-cart-item-title">' +
        esc(it.title) +
        "</span>" +
        (it.backordered ? '<span class="ns-cart-backorder">Backorder</span>' : "") +
        '</div><div class="ns-cart-item-math">' +
        it.qty +
        "<!-- --> × <!-- -->" +
        esc(formatMoney(it.unitPrice, locale)) +
        "<!-- --> =<!-- --> <strong>" +
        esc(formatMoney(it.qty * it.unitPrice, locale)) +
        "</strong></div></li>";
    }
    h += "</ul>";
  }
  if (!isEmpty || cart.creditAdjustment !== 0) {
    h +=
      '<dl class="ns-cart-totals"><dt>Subtotal</dt><dd>' +
      esc(formatMoney(subtotal, locale)) +
      "</dd>" +
      (memberDiscount !== 0 ? "<dt>Member Discount</dt><dd>" + esc(formatMoney(memberDiscount, locale)) + "</dd>" : "") +
      (cart.creditAdjustment !== 0 ? "<dt>Account Credit</dt><dd>" + esc(formatMoney(cart.creditAdjustment, locale)) + "</dd>" : "") +
      "<dt>Shipping</dt><dd>" +
      (shipping === 0 ? "FREE" : esc(formatMoney(shipping, locale))) +
      "</dd><dt>Est. Tax</dt><dd>" +
      esc(formatMoney(tax, locale)) +
      '</dd><dt class="ns-cart-grand-label">Total</dt><dd class="ns-cart-grand-val">' +
      esc(formatMoney(grandTotal, locale)) +
      "</dd></dl>";
  }
  return (
    h +
    '<details class="ns-cart-notes"' +
    (cart.notesOpen ? ' open=""' : "") +
    "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above <!-- -->" +
    esc(formatMoney(cart.freeShippingThreshold, locale)) +
    '<!-- --> ship free.</p></details><button type="button" class="ns-btn ns-btn-primary"' +
    (isEmpty ? ' disabled=""' : "") +
    ' data-variant="primary">Proceed to Checkout</button></aside>'
  );
}

module.exports = {
  name: "handwritten (hand-specialized string concatenation)",
  prepare(_appSource, _opts) {
    render.code = fs.readFileSync(__filename, "utf8");
    return render;
  },
  render,
};

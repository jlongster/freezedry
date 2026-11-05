"use strict";

var React = require("react");

var ThemeContext = React.createContext("light");
var LocaleContext = React.createContext({
  code: "en-US",
  currency: "USD",
  symbol: "$",
  decimals: 2,
  groupSep: ",",
  decSep: ".",
});
var UserContext = React.createContext(null);

var MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

// Pure integer UTC date formatter (Howard Hinnant civil-from-days).
// Deterministic across all timezones, OSes, and JS engines without Intl or Date allocation.
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
  var yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365
  );
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  var m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) {
    y += 1;
  }
  var base = MONTH_NAMES[m - 1] + " " + pad2(d) + ", " + y;
  if (!includeTime) {
    return base;
  }
  var hh = Math.floor(remSec / 3600);
  var mm = Math.floor((remSec - hh * 3600) / 60);
  return base + " " + pad2(hh) + ":" + pad2(mm) + " UTC";
}

function groupDigits(intStr, sep) {
  if (!sep || intStr.length <= 3) {
    return intStr;
  }
  var out = "";
  var count = 0;
  for (var i = intStr.length - 1; i >= 0; i--) {
    if (count > 0 && count % 3 === 0) {
      out = sep + out;
    }
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
  var fixed = abs.toFixed(decimals);
  var parts = fixed.split(".");
  var whole = groupDigits(parts[0], groupSep);
  var formatted =
    decimals > 0 ? symbol + whole + decSep + parts[1] : symbol + whole;
  return neg && abs > 0 ? "-" + formatted : formatted;
}

function cx() {
  var classes = "";
  for (var i = 0; i < arguments.length; i++) {
    var arg = arguments[i];
    if (!arg) continue;
    if (typeof arg === "string") {
      classes = classes ? classes + " " + arg : arg;
    } else if (typeof arg === "object") {
      var keys = Object.keys(arg);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (arg[key]) {
          classes = classes ? classes + " " + key : key;
        }
      }
    }
  }
  return classes;
}

function getThemePalette(theme) {
  if (theme === "dark") {
    return {
      bg: "#0f172a",
      fg: "#f8fafc",
      accent: "#38bdf8",
    };
  }
  if (theme === "contrast") {
    return {
      bg: "#000000",
      fg: "#ffffff",
      accent: "#facc15",
    };
  }
  return {
    bg: "#f8fafc",
    fg: "#0f172a",
    accent: "#0284c7",
  };
}

function computeInitials(name) {
  if (!name) return "?";
  var trimmed = name.trim();
  if (!trimmed) return "?";
  var parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

// 1. CountPill (depth 6)
function CountPill(props) {
  var locale = React.useContext(LocaleContext);
  var count = props.count;
  return (
    <span
      className={cx("ns-pill", { "ns-pill-hot": Boolean(props.hot) })}
      hidden={count <= 0}
      data-zero={count === 0}
    >
      {formatInt(count, locale.groupSep)}
    </span>
  );
}

// 2. ActionButton (depth 5 / 6) — exercises props spreading + override
function ActionButton(props) {
  var variant = props.variant || "primary";
  var className = cx(
    "ns-btn",
    "ns-btn-" + variant,
    props.size && "ns-btn-" + props.size,
    props.className
  );
  var btnProps = Object.assign({}, props.extraAttrs, {
    type: props.type || "button",
    className: className,
    disabled: Boolean(props.disabled),
    "data-variant": variant,
  });
  return <button {...btnProps}>{props.children}</button>;
}

// 3. AvatarBadge (depth 5)
function AvatarBadge(props) {
  var bg = props.color || "#0369a1";
  return (
    <span
      className="ns-avatar"
      aria-hidden="true"
      style={{
        backgroundColor: bg,
        color: "#ffffff",
        width: 28,
        height: 28,
        lineHeight: "28px",
        fontWeight: 700,
      }}
    >
      {computeInitials(props.name)}
    </span>
  );
}

// 4. LoyaltyBadge (depth 5)
function LoyaltyBadge(props) {
  var locale = React.useContext(LocaleContext);
  var tier = props.tier || "member";
  return (
    <span
      className={cx("ns-tier", "ns-tier-" + tier)}
      data-tier={tier}
      data-points={props.points}
    >
      {tier.toUpperCase()} ({formatInt(props.points, locale.groupSep)} pts)
    </span>
  );
}

// 5. UserMenu (depth 4) — conditional logged-in vs anonymous
function UserMenu() {
  var user = React.useContext(UserContext);
  if (!user) {
    return (
      <div className="ns-user ns-user-anon" data-authenticated={false}>
        <a href="/signin" className="ns-link">
          Sign in
        </a>
        <a href="/register" className="ns-link ns-link-cta">
          Trade Account
        </a>
      </div>
    );
  }
  return (
    <div
      className="ns-user ns-user-auth"
      data-authenticated={true}
      data-user-id={user.id}
    >
      <>
        <AvatarBadge name={user.name} color={user.avatarColor} />
        <span className="ns-greeting">Hi, {user.name}</span>
        <LoyaltyBadge tier={user.tier} points={user.points} />
        {user.savedCount > 0 ? (
          <a href="/saved" className="ns-saved-link">
            Saved ({user.savedCount})
          </a>
        ) : null}
      </>
    </div>
  );
}

// 6. SearchBox (depth 4) — uses React.useId() + boolean input attrs + props spreading
function SearchBox(props) {
  var search = props.search;
  var inputId = React.useId();
  var hasQuery = Boolean(search.query && search.query.length > 0);
  var submitExtra = {
    "data-action": "catalog-search",
    "aria-label": "Run catalog search",
  };
  return (
    <form className="ns-search" role="search" action="/catalog" method="get">
      <label className="ns-sr-only" htmlFor={inputId}>
        Search hardware
      </label>
      <input
        type="search"
        id={inputId}
        name="q"
        defaultValue={search.query}
        placeholder="Search SKU, tool, or spec..."
        disabled={Boolean(search.disabled)}
        readOnly={Boolean(search.readOnly)}
        required={Boolean(search.required)}
        autoComplete="off"
        data-has-query={hasQuery}
      />
      <ActionButton
        type="submit"
        variant="secondary"
        size="sm"
        disabled={Boolean(search.disabled)}
        extraAttrs={submitExtra}
      >
        Search
      </ActionButton>
    </form>
  );
}

// 7. NavItem (depth 5)
function NavItem(props) {
  var cat = props.category;
  var active = props.active;
  return (
    <li className={cx("ns-nav-item", { "is-active": active })}>
      <a
        href={"/c/" + cat.slug}
        aria-current={active ? "page" : undefined}
        data-category={cat.slug}
      >
        <span className="ns-nav-label">{cat.label}</span>
        <CountPill count={cat.count} hot={cat.hot} />
      </a>
    </li>
  );
}

// 8. PrimaryNav (depth 4)
function PrimaryNav(props) {
  var categories = props.categories;
  if (!categories || categories.length === 0) {
    return null;
  }
  return (
    <nav className="ns-nav" aria-label="Categories">
      <ul className="ns-nav-list">
        {categories.map(function (cat) {
          return (
            <NavItem
              key={cat.id}
              category={cat}
              active={cat.slug === props.activeSlug}
            />
          );
        })}
      </ul>
    </nav>
  );
}

// 9. SiteHeader (depth 3)
function SiteHeader(props) {
  return (
    <header className="ns-header">
      <div className="ns-header-top">
        <a href="/" className="ns-brand" data-brand="northstar">
          Northstar Supply
        </a>
        <SearchBox search={props.search} />
        <UserMenu />
      </div>
      <PrimaryNav
        categories={props.categories}
        activeSlug={props.search.categorySlug}
      />
    </header>
  );
}

// 10. AnnouncementBanner (depth 3) — includes the single dangerouslySetInnerHTML
function AnnouncementBanner(props) {
  var locale = React.useContext(LocaleContext);
  var promo = props.promo;
  if (!promo) {
    return null;
  }
  return (
    <section
      className={cx("ns-promo", { "ns-promo-urgent": Boolean(promo.urgent) })}
      hidden={!promo.active}
      data-campaign={promo.code}
    >
      <span
        className="ns-promo-html"
        dangerouslySetInnerHTML={{ __html: promo.html }}
      />
      {promo.minOrder !== undefined && promo.minOrder > 0 ? (
        <span className="ns-promo-min">
          {" "}
          (Min. order {formatMoney(promo.minOrder, locale)})
        </span>
      ) : null}
      <code className="ns-promo-code">{promo.code}</code>
    </section>
  );
}

// 11. Breadcrumbs (depth 3) — exercises keyed React.Fragment
function Breadcrumbs(props) {
  var crumbs = props.breadcrumbs;
  if (!crumbs || crumbs.length === 0) {
    return null;
  }
  return (
    <nav className="ns-crumbs" aria-label="Breadcrumb">
      <ol className="ns-crumb-list">
        {crumbs.map(function (crumb, idx) {
          var isLast = idx === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.href + ":" + idx}>
              {idx > 0 ? (
                <li className="ns-crumb-sep" aria-hidden="true">
                  /
                </li>
              ) : null}
              <li className={cx("ns-crumb-item", { "is-current": isLast })}>
                {isLast ? (
                  <span aria-current="page">{crumb.label}</span>
                ) : (
                  <a href={crumb.href}>{crumb.label}</a>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// 12. FilterOption (depth 5) — uses React.useId() inside list rendering
function FilterOption(props) {
  var opt = props.option;
  var optId = React.useId();
  var disabled = Boolean(props.groupDisabled || opt.count === 0);
  return (
    <li className={cx("ns-filter-opt", { "is-selected": opt.selected })}>
      <input
        type="checkbox"
        id={optId}
        name={"f_" + props.groupId}
        value={opt.value}
        defaultChecked={Boolean(opt.selected)}
        disabled={disabled}
      />
      <label htmlFor={optId}>{opt.label}</label>
      <CountPill count={opt.count} hot={false} />
    </li>
  );
}

// 13. FilterGroup (depth 4)
function FilterGroup(props) {
  var group = props.group;
  return (
    <fieldset
      className="ns-filter-group"
      disabled={Boolean(group.disabled)}
      data-filter-key={group.id}
    >
      <legend className="ns-filter-legend">{group.title}</legend>
      {group.options.length === 0 ? (
        <p className="ns-filter-empty">No options</p>
      ) : (
        <ul className="ns-filter-list">
          {group.options.map(function (opt) {
            return (
              <FilterOption
                key={opt.value}
                groupId={group.id}
                groupDisabled={group.disabled}
                option={opt}
              />
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

// 14. FilterSidebar (depth 3) — uses React.useId()
function FilterSidebar(props) {
  var headingId = React.useId();
  var stockToggleId = React.useId();
  var filters = props.filters;
  return (
    <aside className="ns-sidebar" aria-labelledby={headingId}>
      <h2 id={headingId} className="ns-sidebar-title">
        Filters
      </h2>
      <div className="ns-stock-toggle">
        <input
          type="checkbox"
          id={stockToggleId}
          name="in_stock"
          defaultChecked={Boolean(props.inStockOnly)}
        />
        <label htmlFor={stockToggleId}>In-stock items only</label>
      </div>
      {filters.map(function (group) {
        return <FilterGroup key={group.id} group={group} />;
      })}
    </aside>
  );
}

// 15. PriceBlock (depth 5 / 6) — context + deterministic number formatting + edge cases
function PriceBlock(props) {
  var locale = React.useContext(LocaleContext);
  var price = props.price;
  var orig = props.originalPrice;
  var hasDiscount = typeof orig === "number" && orig > price && orig > 0;
  var pctOff = hasDiscount
    ? Math.round(((orig - price) / orig) * 100)
    : 0;
  return (
    <div className="ns-price-block" data-on-sale={hasDiscount}>
      <span className="ns-price-current">{formatMoney(price, locale)}</span>
      {hasDiscount ? (
        <>
          <del className="ns-price-orig">{formatMoney(orig, locale)}</del>
          <span className="ns-price-save">Save {pctOff}%</span>
        </>
      ) : null}
      {typeof props.rebateAmount === "number" && props.rebateAmount !== 0 ? (
        <span className="ns-price-rebate">
          Rebate: {formatMoney(props.rebateAmount, locale)}
        </span>
      ) : null}
    </div>
  );
}

// 16. StockBadge (depth 5 / 6) — conditional stock + deterministic ship date
function StockBadge(props) {
  var stock = props.stock;
  if (stock <= 0) {
    return (
      <span className="ns-stock ns-stock-out" data-stock-state="out">
        Out of stock
      </span>
    );
  }
  if (stock <= 5) {
    return (
      <span className="ns-stock ns-stock-low" data-stock-state="low">
        Only {stock} left
      </span>
    );
  }
  return (
    <span className="ns-stock ns-stock-in" data-stock-state="in">
      In stock
      {typeof props.shipsAtSec === "number"
        ? " · Ships " + formatDateUTC(props.shipsAtSec, false)
        : ""}
    </span>
  );
}

// 17. StarRating (depth 6) — inline style object + numeric formatting
function StarRating(props) {
  var rating = props.rating;
  var count = props.reviewCount;
  var clamped = rating < 0 ? 0 : rating > 5 ? 5 : rating;
  var pct = Math.round((clamped / 5) * 100);
  var locale = React.useContext(LocaleContext);
  return (
    <div
      className="ns-rating"
      aria-label={"Rated " + clamped.toFixed(1) + " out of 5"}
    >
      <span className="ns-rating-track" aria-hidden="true">
        <span
          className="ns-rating-fill"
          style={{
            width: pct + "%",
            opacity: count > 0 ? 1 : 0.35,
          }}
        />
      </span>
      <span className="ns-rating-num">{clamped.toFixed(1)}</span>
      <span className="ns-rating-count">
        ({formatInt(count, locale.groupSep)})
      </span>
    </div>
  );
}

// 18. SpecList (depth 6) — optional list + keyed Fragment
function SpecList(props) {
  var specs = props.specs;
  if (!specs || specs.length === 0) {
    return null;
  }
  return (
    <dl className="ns-specs">
      {specs.map(function (spec, idx) {
        return (
          <React.Fragment key={spec.label + ":" + idx}>
            <dt className="ns-spec-label">{spec.label}</dt>
            <dd className="ns-spec-val">{spec.value}</dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

// 19. ReviewSnippet (depth 6) — user-generated text escaping + deterministic date
function ReviewSnippet(props) {
  var review = props.review;
  if (!review) {
    return null;
  }
  return (
    <blockquote
      className="ns-review"
      data-verified={Boolean(review.verified)}
    >
      <p className="ns-review-body">“{review.body}”</p>
      <footer className="ns-review-meta">
        <span className="ns-review-author">{review.author}</span>
        {review.verified ? (
          <span className="ns-review-badge">Verified Buyer</span>
        ) : null}
        <time className="ns-review-date">
          {formatDateUTC(review.createdAtSec, false)}
        </time>
      </footer>
    </blockquote>
  );
}

// 20. ProductBadges (depth 6)
function ProductBadges(props) {
  var p = props.product;
  var onSale =
    typeof p.originalPrice === "number" && p.originalPrice > p.price;
  if (!p.featured && !p.clearance && !onSale) {
    return null;
  }
  return (
    <div className="ns-badges">
      {p.featured ? (
        <span className="ns-badge ns-badge-featured">Featured</span>
      ) : null}
      {onSale ? <span className="ns-badge ns-badge-sale">Sale</span> : null}
      {p.clearance ? (
        <span className="ns-badge ns-badge-clearance">Clearance</span>
      ) : null}
    </div>
  );
}

// 21. ProductCard (depth 5) — rich item component with spread attrs, inline style, boolean itemScope
function ProductCard(props) {
  var p = props.product;
  var theme = React.useContext(ThemeContext);
  var palette = getThemePalette(theme);
  var inStock = p.stock > 0;
  var cardDataAttrs = {
    "data-sku": p.sku,
    "data-category": p.category,
    "data-in-stock": inStock,
    "data-featured": Boolean(p.featured),
  };
  var btnExtra = {
    "data-add-sku": p.sku,
    "aria-label": (inStock ? "Add to cart: " : "Unavailable: ") + p.title,
  };
  return (
    <article
      {...cardDataAttrs}
      itemScope={true}
      className={cx("ns-card", {
        "ns-card-featured": Boolean(p.featured),
        "ns-card-out": !inStock,
      })}
      style={{
        borderColor: p.featured ? palette.accent : undefined,
        order: props.index,
      }}
    >
      <ProductBadges product={p} />
      <div className="ns-card-head">
        <span className="ns-card-brand">{p.brand}</span>
        <span className="ns-card-sku">#{p.sku}</span>
      </div>
      <h3 className="ns-card-title">
        <a href={"/p/" + p.sku} title={p.title}>
          {p.title}
        </a>
      </h3>
      <StarRating rating={p.rating} reviewCount={p.reviewCount} />
      <SpecList specs={p.specs} />
      <PriceBlock
        price={p.price}
        originalPrice={p.originalPrice}
        rebateAmount={p.rebateAmount}
      />
      <div className="ns-card-footer">
        <StockBadge stock={p.stock} shipsAtSec={p.shipsAtSec} />
        <ActionButton
          variant={inStock ? "primary" : "ghost"}
          size="sm"
          disabled={!inStock}
          extraAttrs={btnExtra}
        >
          {inStock ? "Add to Cart" : "Notify Me"}
        </ActionButton>
      </div>
      <ReviewSnippet review={p.topReview} />
    </article>
  );
}

// 22. EmptyCatalogState (depth 5)
function EmptyCatalogState(props) {
  var resetExtra = { "data-action": "reset-filters" };
  return (
    <div className="ns-empty" role="status" data-query={props.query}>
      <h3 className="ns-empty-title">No matching products found</h3>
      <p className="ns-empty-desc">
        {props.query
          ? 'No hardware matched "' + props.query + '". Try clearing filters.'
          : "This category currently has 0 items available."}
      </p>
      <ActionButton variant="secondary" extraAttrs={resetExtra}>
        Reset Filters
      </ActionButton>
    </div>
  );
}

// 23. ProductGrid (depth 4)
function ProductGrid(props) {
  var products = props.products;
  if (products.length === 0) {
    return <EmptyCatalogState query={props.query} />;
  }
  return (
    <div className="ns-grid" data-count={products.length}>
      {products.map(function (product, index) {
        return (
          <ProductCard key={product.sku} product={product} index={index} />
        );
      })}
    </div>
  );
}

// 24. HeroSpotlight (depth 4)
function HeroSpotlight(props) {
  var spot = props.spotlight;
  if (!spot) {
    return null;
  }
  var ctaExtra = { "data-spotlight-sku": spot.sku };
  return (
    <section className="ns-spotlight" data-sku={spot.sku}>
      <div className="ns-spotlight-body">
        <span className="ns-spotlight-kicker">Deal of the Day</span>
        <h2 className="ns-spotlight-title">{spot.headline}</h2>
        {spot.blurb ? <p className="ns-spotlight-blurb">{spot.blurb}</p> : null}
        <p className="ns-spotlight-ends">
          Ends {formatDateUTC(spot.endsAtSec, true)}
        </p>
      </div>
      <div className="ns-spotlight-aside">
        <PriceBlock
          price={spot.price}
          originalPrice={spot.originalPrice}
        />
        <StockBadge stock={spot.stock} />
        <ActionButton
          variant="primary"
          disabled={spot.stock <= 0}
          extraAttrs={ctaExtra}
        >
          View Deal
        </ActionButton>
      </div>
    </section>
  );
}

// 25. CatalogToolbar (depth 4) — uses React.useId() + <select defaultValue> + useMemo summary
function CatalogToolbar(props) {
  var sortId = React.useId();
  var locale = React.useContext(LocaleContext);
  var stats = props.stats;
  return (
    <div className="ns-toolbar">
      <p className="ns-toolbar-summary">
        Showing <strong>{formatInt(stats.visibleCount, locale.groupSep)}</strong>{" "}
        of <strong>{formatInt(props.totalMatching, locale.groupSep)}</strong>{" "}
        items ({stats.inStockCount} ready, {stats.onSaleCount} on sale)
      </p>
      <div className="ns-toolbar-sort">
        <label htmlFor={sortId}>Sort:</label>
        <select id={sortId} name="sort" defaultValue={props.sortBy}>
          <option value="featured">Featured</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="rating">Customer Rating</option>
        </select>
      </div>
    </div>
  );
}

// 26. PaginationBar (depth 4)
function PaginationBar(props) {
  var pag = props.pagination;
  if (!pag || pag.totalPages <= 1) {
    return null;
  }
  var pages = [];
  var start = Math.max(1, pag.currentPage - 2);
  var end = Math.min(pag.totalPages, start + 4);
  for (var p = start; p <= end; p++) {
    pages.push(p);
  }
  return (
    <nav className="ns-pagination" aria-label="Pagination">
      {pages.map(function (pageNum) {
        var active = pageNum === pag.currentPage;
        return (
          <a
            key={"page-" + pageNum}
            href={"?page=" + pageNum}
            className={cx("ns-page-link", { "is-active": active })}
            aria-current={active ? "page" : undefined}
          >
            {pageNum}
          </a>
        );
      })}
    </nav>
  );
}

// 27. CartLineItem (depth 4)
function CartLineItem(props) {
  var item = props.item;
  var locale = React.useContext(LocaleContext);
  var lineTotal = item.qty * item.unitPrice;
  return (
    <li className="ns-cart-item" data-sku={item.sku}>
      <div className="ns-cart-item-main">
        <span className="ns-cart-item-title">{item.title}</span>
        {item.backordered ? (
          <span className="ns-cart-backorder">Backorder</span>
        ) : null}
      </div>
      <div className="ns-cart-item-math">
        {item.qty} × {formatMoney(item.unitPrice, locale)} ={" "}
        <strong>{formatMoney(lineTotal, locale)}</strong>
      </div>
    </li>
  );
}

// 28. CartSummaryAside (depth 3) — uses useContext + useMemo + <details open={...}>
function CartSummaryAside(props) {
  var cart = props.cart;
  var locale = React.useContext(LocaleContext);
  var user = React.useContext(UserContext);

  var totals = React.useMemo(
    function () {
      var subtotal = 0;
      var unitCount = 0;
      for (var i = 0; i < cart.items.length; i++) {
        var it = cart.items[i];
        subtotal += it.qty * it.unitPrice;
        unitCount += it.qty;
      }
      var discountRate =
        user && user.tier === "vip"
          ? 0.1
          : user && user.tier === "pro"
          ? 0.05
          : 0;
      var memberDiscount = subtotal > 0 ? -(subtotal * discountRate) : 0;
      var afterDiscount = subtotal + memberDiscount + cart.creditAdjustment;
      var taxable = afterDiscount > 0 ? afterDiscount : 0;
      var shipping =
        unitCount === 0 || taxable >= cart.freeShippingThreshold ? 0 : 14.95;
      var tax = taxable * cart.taxRate;
      var grandTotal = afterDiscount + shipping + tax;
      return {
        subtotal: subtotal,
        unitCount: unitCount,
        memberDiscount: memberDiscount,
        shipping: shipping,
        tax: tax,
        grandTotal: grandTotal,
      };
    },
    [cart, user]
  );

  var isEmpty = cart.items.length === 0;
  var showBreakdown = !isEmpty || cart.creditAdjustment !== 0;
  return (
    <aside className="ns-cart" data-empty={isEmpty}>
      <h2 className="ns-cart-title">Order Quote ({totals.unitCount})</h2>
      {isEmpty ? (
        <p className="ns-cart-empty">Your quote list is empty.</p>
      ) : (
        <ul className="ns-cart-list">
          {cart.items.map(function (it) {
            return <CartLineItem key={it.sku} item={it} />;
          })}
        </ul>
      )}
      {showBreakdown ? (
        <dl className="ns-cart-totals">
          <dt>Subtotal</dt>
          <dd>{formatMoney(totals.subtotal, locale)}</dd>
          {totals.memberDiscount !== 0 ? (
            <>
              <dt>Member Discount</dt>
              <dd>{formatMoney(totals.memberDiscount, locale)}</dd>
            </>
          ) : null}
          {cart.creditAdjustment !== 0 ? (
            <>
              <dt>Account Credit</dt>
              <dd>{formatMoney(cart.creditAdjustment, locale)}</dd>
            </>
          ) : null}
          <dt>Shipping</dt>
          <dd>
            {totals.shipping === 0
              ? "FREE"
              : formatMoney(totals.shipping, locale)}
          </dd>
          <dt>Est. Tax</dt>
          <dd>{formatMoney(totals.tax, locale)}</dd>
          <dt className="ns-cart-grand-label">Total</dt>
          <dd className="ns-cart-grand-val">
            {formatMoney(totals.grandTotal, locale)}
          </dd>
        </dl>
      ) : null}
      <details className="ns-cart-notes" open={Boolean(cart.notesOpen)}>
        <summary>Freight &amp; Net-30 Terms</summary>
        <p>Orders above {formatMoney(cart.freeShippingThreshold, locale)} ship free.</p>
      </details>
      <ActionButton variant="primary" disabled={isEmpty}>
        Proceed to Checkout
      </ActionButton>
    </aside>
  );
}

// 29. SiteFooter (depth 3)
function SiteFooter(props) {
  var theme = React.useContext(ThemeContext);
  var locale = React.useContext(LocaleContext);
  return (
    <footer className="ns-footer">
      <p className="ns-footer-copy">
        © Northstar Industrial Supply · Generated{" "}
        <time>{formatDateUTC(props.timestampSec, true)}</time>
      </p>
      <p className="ns-footer-meta">
        <>
          <span>Locale: {locale.code}</span>
          {" · "}
          <span>Currency: {locale.currency}</span>
          {" · "}
          <span>Theme: {theme}</span>
        </>
      </p>
    </footer>
  );
}

// 30. PageShell (depth 2)
function PageShell(props) {
  var data = props.data;
  var theme = React.useContext(ThemeContext);
  var locale = React.useContext(LocaleContext);
  var palette = getThemePalette(theme);
  return (
    <div
      id="northstar-app"
      className={cx("ns-shell", "ns-theme-" + theme, {
        "ns-compact": Boolean(data.compactMode),
      })}
      data-theme={theme}
      data-locale={locale.code}
      data-request-id={data.requestId}
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        minHeight: "100vh",
      }}
    >
      <AnnouncementBanner promo={data.promo} />
      <SiteHeader search={data.search} categories={data.categories} />
      <Breadcrumbs breadcrumbs={data.breadcrumbs} />
      <div className="ns-layout">
        <FilterSidebar
          filters={data.filters}
          inStockOnly={data.search.inStockOnly}
        />
        <main className="ns-main">
          <HeroSpotlight spotlight={data.spotlight} />
          <CatalogToolbar
            stats={props.stats}
            totalMatching={data.pagination.totalMatching}
            sortBy={data.search.sortBy}
          />
          <ProductGrid
            products={data.products}
            query={data.search.query}
          />
          <PaginationBar pagination={data.pagination} />
        </main>
        <CartSummaryAside cart={data.cart} />
      </div>
      <SiteFooter timestampSec={data.timestampSec} />
    </div>
  );
}

// Root App (depth 1)
function App(props) {
  var data = props.data;
  var stats = React.useMemo(
    function () {
      var inStockCount = 0;
      var onSaleCount = 0;
      for (var i = 0; i < data.products.length; i++) {
        var p = data.products[i];
        if (p.stock > 0) inStockCount++;
        if (typeof p.originalPrice === "number" && p.originalPrice > p.price) {
          onSaleCount++;
        }
      }
      return {
        visibleCount: data.products.length,
        inStockCount: inStockCount,
        onSaleCount: onSaleCount,
      };
    },
    [data.products]
  );

  return (
    <ThemeContext.Provider value={data.theme}>
      <LocaleContext.Provider value={data.locale}>
        <UserContext.Provider value={data.user}>
          <PageShell data={data} stats={stats} />
        </UserContext.Provider>
      </LocaleContext.Provider>
    </ThemeContext.Provider>
  );
}

module.exports = App;

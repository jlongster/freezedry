(function () {

const $FB = { hybridFallback: true };
let $fbSite = -1;
function $fb(site) { $fbSite = site === undefined ? -1 : site; throw $FB; }
let $o = "";
let $L = false;
const $ctx = [];
const $ctxDefault = [];
class $Th { constructor(f) { this.f = f; } }
const $ESC1 = /["'&<>]/;
const $ESCG = /["'&<>]/g;
const $ESCM = { '"': "&quot;", "&": "&amp;", "'": "&#x27;", "<": "&lt;", ">": "&gt;" };
function $escC(c) { return $ESCM[c]; }
function $e(s) { return $ESC1.test(s) ? s.replace($ESCG, $escC) : s; }
function $t(s) { if (s === "") return; if ($L) $o += "<!-- -->"; $o += $e(s); $L = true; }
function $te(s) { if (s === "") return; if ($L) $o += "<!-- -->"; $o += s; $L = true; }
function $es(v) {
  const t = typeof v;
  return t === "string" ? $e(v) : t === "number" ? "" + v : null;
}
function $tn(v) {
  const t = typeof v;
  if (t === "string") $t(v);
  else if (t === "number") $te("" + v);
  else if (!(v === null || v === undefined || t === "boolean")) $fb();
}
function $tcls(v) {
  const t = typeof v;
  if (t === "string" || t === "number") return "t";
  if (v === null || v === undefined || t === "boolean") return "n";
  if (v instanceof $Th) return "d";
  if (Array.isArray(v)) return "a";
  return "x";
}
// Attribute region slot for a value of unknown type (see learn.js attrRegions).
function $at(v, vpre, vpost, t, f, n, site) {
  const ty = typeof v;
  if (ty === "string" || ty === "number") return vpre === null ? $fb(site) : vpre + $e("" + v) + vpost;
  if (v === true) return t;
  if (v === false) return f;
  if (v === null) return n;
  if (v === undefined) return "";
  return $fb(site);
}
function $acls(v) { const t = typeof v; return t === "string" || t === "number" ? "v" : "x"; }
function $scls(v) {
  const t = typeof v;
  if (t === "string") return v !== "" ? "S" : "x";
  if (t === "number") return v !== 0 ? "M" : "x";
  return "x";
}
function $scls0(v) {
  const t = typeof v;
  if (t === "string") return v !== "" ? "S" : "x";
  return t === "number" ? "M" : "x";
}
function $hcls(v) { return typeof v === "string" ? "s" : "x"; }
function $okeys(v) {
  if (v === null || v === undefined) return "#nullish";
  if (typeof v !== "object") return "#" + typeof v;
  const k = Object.keys(v);
  if (Object.getOwnPropertySymbols(v).length) return "#symbols";
  return k;
}
function $keys(v) {
  if (v === null || v === undefined) return "#nullish";
  if (typeof v !== "object") return "#" + typeof v;
  if (Object.getOwnPropertySymbols(v).length) return "#symbols";
  return "o:" + Object.keys(v).join("\u0001");
}
// React 18 Fizz tree context (pushTreeContext / getTreeId / makeId), used for useId.
function $bits(n) { return 32 - Math.clz32(n); }
function $push(tc, total, index) {
  const baseIdWithLeadingBit = tc.id;
  const baseOverflow = tc.ov;
  const baseLength = $bits(baseIdWithLeadingBit) - 1;
  const baseId = baseIdWithLeadingBit & ~(1 << baseLength);
  const slot = index + 1;
  const length = $bits(total) + baseLength;
  if (length > 30) {
    const numberOfOverflowBits = baseLength - (baseLength % 5);
    const newOverflowBits = (1 << numberOfOverflowBits) - 1;
    const newOverflow = (baseId & newOverflowBits).toString(32);
    const restOfBaseId = baseId >> numberOfOverflowBits;
    const restOfBaseLength = baseLength - numberOfOverflowBits;
    const restOfLength = $bits(total) + restOfBaseLength;
    const restOfNewBits = slot << restOfBaseLength;
    return { id: (1 << restOfLength) | restOfNewBits | restOfBaseId, ov: newOverflow + baseOverflow };
  }
  return { id: (1 << length) | (slot << baseLength) | baseId, ov: baseOverflow };
}
function $id(tc, k) {
  const id = tc.id & ~(1 << ($bits(tc.id) - 1));
  return ":R" + id.toString(32) + tc.ov + (k > 0 ? "H" + k.toString(32) : "") + ":";
}
function $emitNode(v, tc) {
  const t = typeof v;
  if (t === "string") { $t(v); return; }
  if (t === "number") { $te("" + v); return; }
  if (v === null || v === undefined || t === "boolean") return;
  if (v instanceof $Th) { v.f(tc); return; }
  if (Array.isArray(v)) {
    const n = v.length;
    for (let i = 0; i < n; i++) $emitNode(v[i], tc && $push(tc, n, i));
    return;
  }
  $fb();
}

function $hy_mk44(cart, user) { return (function () {
    var subtotal = 0;
    var unitCount = 0;
    for (var i = 0; i < cart.items.length; i++) {
      var it = cart.items[i];
      subtotal += it.qty * it.unitPrice;
      unitCount += it.qty;
    }
    var discountRate = user && user.tier === "vip" ? 0.1 : user && user.tier === "pro" ? 0.05 : 0;
    var memberDiscount = subtotal > 0 ? -(subtotal * discountRate) : 0;
    var afterDiscount = subtotal + memberDiscount + cart.creditAdjustment;
    var taxable = afterDiscount > 0 ? afterDiscount : 0;
    var shipping = unitCount === 0 || taxable >= cart.freeShippingThreshold ? 0 : 14.95;
    var tax = taxable * cart.taxRate;
    var grandTotal = afterDiscount + shipping + tax;
    return {
      subtotal: subtotal,
      unitCount: unitCount,
      memberDiscount: memberDiscount,
      shipping: shipping,
      tax: tax,
      grandTotal: grandTotal
    };
  }); }
function $hy_mk49(data) { return (function () {
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
      onSaleCount: onSaleCount
    };
  }); }
const $tab0 = ["ns-crumb-item", "ns-crumb-item is-current"];
const $tab1 = ["ns-page-link", "ns-page-link is-active"];
const $tab2 = ["ns-promo", "ns-promo ns-promo-urgent"];
const $tab3 = ["ns-card", "ns-card ns-card-featured", "ns-card ns-card-out", "ns-card ns-card-featured ns-card-out"];
const $tab4 = ["ns-pill", "ns-pill ns-pill-hot"];
function $B17($rA0, $rA1, $rA2, $rE0, $tc) {
const $v0 = $rA0.id;
const $v1 = $rA0.slug;
const $v2 = $rE0.activeSlug;
$T15(($v1 === $v2), $rA0, null);
}
function $B21($rA0, $rA1, $rA2, $rE0, $tc) {
if (($rA1 > 0)) {
const $v0 = ($rA1 === ($rE0.length - 1));
if ($v0) {
const $v1 = $rE0.length;
const $v2 = $rA0.href;
const $v3 = $tab0[($v0 ? 1 : 0)];
const $v4 = $rA0.label;
$o += "<li class=\"ns-crumb-sep\" aria-hidden=\"true\">/</li><li class=\"" + $v3 + "\"><span aria-current=\"page\">";
$L = false;
$tn($v4);
$o += "</span></li>";
$L = false;
} else {
const $v5 = $rE0.length;
const $v6 = $rA0.href;
const $v7 = $tab0[($v0 ? 1 : 0)];
const $v8 = $rA0.label;
$o += "<li class=\"ns-crumb-sep\" aria-hidden=\"true\">/</li><li class=\"" + $v7 + "\"><a" + $at($v6, " href=\"", "\"", "", "", "", 2) + ">";
$L = false;
$tn($v8);
$o += "</a></li>";
$L = false;
}
} else {
const $v9 = ($rA1 === ($rE0.length - 1));
if ($v9) {
const $v10 = $rE0.length;
const $v11 = $rA0.href;
const $v12 = $tab0[($v9 ? 1 : 0)];
const $v13 = $rA0.label;
$o += "<li class=\"" + $v12 + "\"><span aria-current=\"page\">";
$L = false;
$tn($v13);
$o += "</span></li>";
$L = false;
} else {
const $v14 = $rE0.length;
const $v15 = $rA0.href;
const $v16 = $tab0[($v9 ? 1 : 0)];
const $v17 = $rA0.label;
$o += "<li class=\"" + $v16 + "\"><a" + $at($v15, " href=\"", "\"", "", "", "", 5) + ">";
$L = false;
$tn($v17);
$o += "</a></li>";
$L = false;
}
}
}
function $B24($rA0, $rA1, $rA2, $rE0, $tc) {
const $v0 = $rA0.value;
const $v1 = $rE0.id;
const $v2 = $rE0.disabled;
$T22($v2, $v1, $rA0, $tc);
}
function $B26($rA0, $rA1, $rA2, $tc) {
const $v0 = $rA0.id;
$T23($rA0, $tc);
}
function $B31($rA0, $rA1, $rA2, $tc) {
const $v0 = $rA0.label;
const $v1 = $rA0.value;
$o += "<dt class=\"ns-spec-label\">";
$L = false;
$tn($v0);
$o += "</dt><dd class=\"ns-spec-val\">";
$L = false;
$tn($v1);
$o += "</dd>";
$L = false;
}
function $B37($rA0, $rA1, $rA2, $tc) {
const $v0 = $rA0.sku;
$T34($rA1, $rA0, null);
}
function $B41($rA0, $rA1, $rA2, $rE0, $tc) {
const $v0 = $rE0.currentPage;
const $v1 = ($rA0 === $v0);
if ($v1) {
const $v2 = $tab1[($v1 ? 1 : 0)];
const $v3 = ("?page=" + $rA0);
$o += "<a href=\"" + $e($v3) + "\" class=\"" + $v2 + "\" aria-current=\"page\">";
$L = false;
$tn($rA0);
$o += "</a>";
$L = false;
} else {
const $v4 = $tab1[($v1 ? 1 : 0)];
const $v5 = ("?page=" + $rA0);
$o += "<a href=\"" + $e($v5) + "\" class=\"" + $v4 + "\">";
$L = false;
$tn($rA0);
$o += "</a>";
$L = false;
}
}
function $B45($rA0, $rA1, $rA2, $tc) {
const $v0 = $rA0.sku;
$T42($rA0, null);
}
function $T10($p0, $p1, $p2, $p3, $p4, $p5, $p6, $tc) {
if ($p6) {
if ($p4) {
if ($p5) {
const $k0 = $okeys($p3);
if (typeof $k0 !== "string" && $k0.length === 2 && $k0[0] === "data-action" && $k0[1] === "aria-label") {
const $v1 = ("ns-btn-" + $p6);
const $v2 = cx("ns-btn", $v1, ("ns-btn-" + $p4), $p1);
const $v3 = Boolean($p2);
const $v4 = $p3["data-action"];
const $v5 = $p3["aria-label"];
$o += "<button" + $at($v4, " data-action=\"", "\"", " data-action=\"true\"", " data-action=\"false\"", "", 10) + $at($v5, " aria-label=\"", "\"", " aria-label=\"true\"", " aria-label=\"false\"", "", 11) + $at($p5, " type=\"", "\"", "", "", "", 12) + $at($v2, " class=\"", "\"", "", "", "", 13) + ($v3 ? " disabled=\"\"" : "") + $at($p6, " data-variant=\"", "\"", " data-variant=\"true\"", " data-variant=\"false\"", "", 15) + ">";
$L = false;
$tn($p0);
$o += "</button>";
$L = false;
} else { $fb(16); }
} else {
const $k6 = $okeys($p3);
if (typeof $k6 !== "string" && $k6.length === 2 && $k6[0] === "data-add-sku" && $k6[1] === "aria-label") {
const $v7 = ("ns-btn-" + $p6);
const $v8 = cx("ns-btn", $v7, ("ns-btn-" + $p4), $p1);
const $v9 = Boolean($p2);
const $v10 = $p3["data-add-sku"];
const $v11 = $p3["aria-label"];
$o += "<button" + $at($v10, " data-add-sku=\"", "\"", " data-add-sku=\"true\"", " data-add-sku=\"false\"", "", 17) + $at($v11, " aria-label=\"", "\"", " aria-label=\"true\"", " aria-label=\"false\"", "", 18) + " type=\"button\"" + $at($v8, " class=\"", "\"", "", "", "", 19) + ($v9 ? " disabled=\"\"" : "") + $at($p6, " data-variant=\"", "\"", " data-variant=\"true\"", " data-variant=\"false\"", "", 21) + ">";
$L = false;
$tn($p0);
$o += "</button>";
$L = false;
} else { $fb(22); }
}
} else {
if ($p5) {
$fb(23);
} else {
const $k12 = $okeys($p3);
if ($k12 === "#nullish") {
const $v13 = ("ns-btn-" + $p6);
const $v14 = cx("ns-btn", $v13, $p4, $p1);
const $v15 = Boolean($p2);
$o += "<button type=\"button\"" + $at($v14, " class=\"", "\"", "", "", "", 24) + ($v15 ? " disabled=\"\"" : "") + $at($p6, " data-variant=\"", "\"", " data-variant=\"true\"", " data-variant=\"false\"", "", 26) + ">";
$L = false;
$tn($p0);
$o += "</button>";
$L = false;
} else if (typeof $k12 !== "string" && $k12.length === 1 && $k12[0] === "data-spotlight-sku") {
const $v16 = ("ns-btn-" + $p6);
const $v17 = cx("ns-btn", $v16, $p4, $p1);
const $v18 = Boolean($p2);
const $v19 = $p3["data-spotlight-sku"];
$o += "<button" + $at($v19, " data-spotlight-sku=\"", "\"", " data-spotlight-sku=\"true\"", " data-spotlight-sku=\"false\"", "", 27) + " type=\"button\"" + $at($v17, " class=\"", "\"", "", "", "", 28) + ($v18 ? " disabled=\"\"" : "") + $at($p6, " data-variant=\"", "\"", " data-variant=\"true\"", " data-variant=\"false\"", "", 30) + ">";
$L = false;
$tn($p0);
$o += "</button>";
$L = false;
} else if (typeof $k12 !== "string" && $k12.length === 1 && $k12[0] === "data-action") {
const $v20 = ("ns-btn-" + $p6);
const $v21 = cx("ns-btn", $v20, $p4, $p1);
const $v22 = Boolean($p2);
const $v23 = $p3["data-action"];
$o += "<button" + $at($v23, " data-action=\"", "\"", " data-action=\"true\"", " data-action=\"false\"", "", 31) + " type=\"button\"" + $at($v21, " class=\"", "\"", "", "", "", 32) + ($v22 ? " disabled=\"\"" : "") + $at($p6, " data-variant=\"", "\"", " data-variant=\"true\"", " data-variant=\"false\"", "", 34) + ">";
$L = false;
$tn($p0);
$o += "</button>";
$L = false;
} else { $fb(35); }
}
}
} else {
$fb(36);
}
}
function $T11($p0, $p1, $tc) {
if ($p0) {
switch ($scls($p0)) {
case "S": {
const $v0 = computeInitials($p1);
$o += "<span class=\"ns-avatar\" aria-hidden=\"true\" style=\"background-color:" + $e(("" + $p0).trim()) + ";color:#ffffff;width:28px;height:28px;line-height:28px;font-weight:700\">";
$L = false;
$tn($v0);
$o += "</span>";
$L = false;
break;
}
default: $fb(37);
}
} else {
const $v1 = computeInitials($p1);
$o += "<span class=\"ns-avatar\" aria-hidden=\"true\" style=\"background-color:#0369a1;color:#ffffff;width:28px;height:28px;line-height:28px;font-weight:700\">";
$L = false;
$tn($v1);
$o += "</span>";
$L = false;
}
}
function $T12($p0, $p1, $tc) {
const $rC1 = $ctx[1];
if ($p1) {
const $v0 = cx("ns-tier", ("ns-tier-" + $p1));
const $v1 = $p1.toUpperCase();
const $v2 = $rC1.groupSep;
const $v3 = formatInt($p0, $v2);
$o += "<span" + $at($v0, " class=\"", "\"", "", "", "", 38) + $at($p1, " data-tier=\"", "\"", " data-tier=\"true\"", " data-tier=\"false\"", "", 39) + $at($p0, " data-points=\"", "\"", " data-points=\"true\"", " data-points=\"false\"", "", 40) + ">";
$L = false;
$tn($v1);
$o += ($L ? "<!-- -->" : "") + " (";
$L = true;
$tn($v3);
$o += ($L ? "<!-- -->" : "") + " pts)</span>";
$L = false;
} else {
$fb(41);
}
}
function $T13($tc) {
const $rC2 = $ctx[2];
if ((!$rC2)) {
$o += "<div class=\"ns-user ns-user-anon\" data-authenticated=\"false\"><a href=\"/signin\" class=\"ns-link\">Sign in</a><a href=\"/register\" class=\"ns-link ns-link-cta\">Trade Account</a></div>";
$L = false;
} else {
const $v0 = $rC2.savedCount;
if (($v0 > 0)) {
const $v1 = $rC2.id;
const $v2 = $rC2.name;
const $v3 = $rC2.avatarColor;
const $v4 = $rC2.tier;
const $v5 = $rC2.points;
$o += "<div class=\"ns-user ns-user-auth\" data-authenticated=\"true\"" + $at($v1, " data-user-id=\"", "\"", " data-user-id=\"true\"", " data-user-id=\"false\"", "", 42) + ">";
$L = false;
$T11($v3, $v2, null);
$o += "<span class=\"ns-greeting\">Hi, ";
$L = true;
$tn($v2);
$o += "</span>";
$L = false;
$T12($v5, $v4, null);
$o += "<a href=\"/saved\" class=\"ns-saved-link\">Saved (";
$L = true;
$tn($v0);
$o += ($L ? "<!-- -->" : "") + ")</a></div>";
$L = false;
} else {
const $v6 = $rC2.id;
const $v7 = $rC2.name;
const $v8 = $rC2.avatarColor;
const $v9 = $rC2.tier;
const $v10 = $rC2.points;
$o += "<div class=\"ns-user ns-user-auth\" data-authenticated=\"true\"" + $at($v6, " data-user-id=\"", "\"", " data-user-id=\"true\"", " data-user-id=\"false\"", "", 43) + ">";
$L = false;
$T11($v8, $v7, null);
$o += "<span class=\"ns-greeting\">Hi, ";
$L = true;
$tn($v7);
$o += "</span>";
$L = false;
$T12($v10, $v9, null);
$o += "</div>";
$L = false;
}
}
}
function $T14($p0, $tc) {
const $rI0 = $id($tc, 0);
const $v0 = $p0.query;
if ($v0) {
const $v1 = $v0.length;
const $v2 = Boolean(($v1 > 0));
const $v3 = $p0.disabled;
const $v4 = Boolean($v3);
const $v5 = $p0.readOnly;
const $v6 = Boolean($v5);
const $v7 = $p0.required;
const $v8 = Boolean($v7);
$o += "<form class=\"ns-search\" role=\"search\" action=\"/catalog\" method=\"get\"><label class=\"ns-sr-only\" for=\"" + $rI0 + "\">Search hardware</label><input type=\"search\" id=\"" + $rI0 + "\" name=\"q\" placeholder=\"Search SKU, tool, or spec...\"" + ($v4 ? " disabled=\"\"" : "") + ($v6 ? " readonly=\"\"" : "") + ($v8 ? " required=\"\"" : "") + " autoComplete=\"off\"" + ($v2 ? " data-has-query=\"true\"" : " data-has-query=\"false\"") + $at($v0, " value=\"", "\"", " value=\"true\"", " value=\"false\"", "", 50) + "/>";
$L = false;
$T10_0($v4, null);
$o += "</form>";
$L = false;
} else {
const $v9 = Boolean($v0);
const $v10 = $p0.disabled;
const $v11 = Boolean($v10);
const $v12 = $p0.readOnly;
const $v13 = Boolean($v12);
const $v14 = $p0.required;
const $v15 = Boolean($v14);
$o += "<form class=\"ns-search\" role=\"search\" action=\"/catalog\" method=\"get\"><label class=\"ns-sr-only\" for=\"" + $rI0 + "\">Search hardware</label><input type=\"search\" id=\"" + $rI0 + "\" name=\"q\" placeholder=\"Search SKU, tool, or spec...\"" + ($v11 ? " disabled=\"\"" : "") + ($v13 ? " readonly=\"\"" : "") + ($v15 ? " required=\"\"" : "") + " autoComplete=\"off\"" + ($v9 ? " data-has-query=\"true\"" : " data-has-query=\"false\"") + $at($v0, " value=\"", "\"", " value=\"true\"", " value=\"false\"", "", 57) + "/>";
$L = false;
$T10_0($v11, null);
$o += "</form>";
$L = false;
}
}
function $T15($p0, $p1, $tc) {
if ($p0) {
const $v0 = cx("ns-nav-item", ({"is-active": $p0}));
const $v1 = $p1.slug;
const $v2 = $p1.label;
const $v3 = $p1.count;
const $v4 = $p1.hot;
const $v5 = ("/c/" + $v1);
$o += "<li" + $at($v0, " class=\"", "\"", "", "", "", 58) + "><a href=\"" + $e($v5) + "\" aria-current=\"page\"" + $at($v1, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 60) + "><span class=\"ns-nav-label\">";
$L = false;
$tn($v2);
$o += "</span>";
$L = false;
$T9($v3, $v4, null);
$o += "</a></li>";
$L = false;
} else {
const $v6 = cx("ns-nav-item", ({"is-active": $p0}));
const $v7 = $p1.slug;
const $v8 = $p1.label;
const $v9 = $p1.count;
const $v10 = $p1.hot;
const $v11 = ("/c/" + $v7);
$o += "<li" + $at($v6, " class=\"", "\"", "", "", "", 61) + "><a href=\"" + $e($v11) + "\"" + $at($v7, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 63) + "><span class=\"ns-nav-label\">";
$L = false;
$tn($v8);
$o += "</span>";
$L = false;
$T9($v9, $v10, null);
$o += "</a></li>";
$L = false;
}
}
function $T16($rP, $tc) {
const $v0 = $rP.categories;
if ((!$v0)) {
$fb(64);
} else {
const $v1 = $v0.length;
if (($v1 === 0)) {

} else {
$o += "<nav class=\"ns-nav\" aria-label=\"Categories\"><ul class=\"ns-nav-list\">";
$L = false;
const $a2 = $v0;
if (!Array.isArray($a2)) $fb(65);
const $n2 = $a2.length;
const $b2_0 = $rP;
for (let $i2 = 0; $i2 < $n2; $i2++) $B17($a2[$i2], $i2, $a2, $b2_0, null);
$o += "</ul></nav>";
$L = false;
}
}
}
function $T18($p0, $p1, $tc) {
const $v0 = $p1.categorySlug;
const $tc1 = $push($tc, 2, 0);
const $tc2 = $push($tc1, 3, 1);
$o += "<header class=\"ns-header\"><div class=\"ns-header-top\"><a href=\"/\" class=\"ns-brand\" data-brand=\"northstar\">Northstar Supply</a>";
$L = false;
$T14($p1, $tc2);
$T13(null);
$o += "</div>";
$L = false;
$T16({ "categories": $p0, "activeSlug": $v0 }, null);
$o += "</header>";
$L = false;
}
function $T19($p0, $tc) {
const $rC1 = $ctx[1];
if ((!$p0)) {

} else {
const $v0 = $p0.minOrder;
if (($v0 !== void 0)) {
if (($v0 > 0)) {
const $v1 = $p0.html;
switch ($hcls($v1)) {
case "s": {
const $v2 = $p0.urgent;
const $v3 = Boolean($v2);
const $v4 = $tab2[($v3 ? 1 : 0)];
const $v5 = $p0.active;
const $v6 = $p0.code;
const $v7 = formatMoney($v0, $rC1);
const $v8 = (!$v5);
const $x9 = $es($v6);
$o += "<section class=\"" + $v4 + "\"" + ($v8 ? " hidden=\"\"" : "") + ($x9 !== null ? " data-campaign=\"" + $x9 + "\"" : $at($v6, " data-campaign=\"", "\"", " data-campaign=\"true\"", " data-campaign=\"false\"", "", 68)) + "><span class=\"ns-promo-html\">" + ("" + $v1) + "</span><span class=\"ns-promo-min\"> <!-- -->(Min. order ";
$L = true;
$tn($v7);
$o += ($L ? "<!-- -->" : "") + ")</span><code class=\"ns-promo-code\">";
$L = false;
if ($x9 !== null) $te($x9); else $tn($v6);
$o += "</code></section>";
$L = false;
break;
}
default: $fb(69);
}
} else {
$fb(70);
}
} else {
const $v10 = $p0.html;
switch ($hcls($v10)) {
case "s": {
const $v11 = $p0.urgent;
const $v12 = Boolean($v11);
const $v13 = $tab2[($v12 ? 1 : 0)];
const $v14 = $p0.active;
const $v15 = $p0.code;
const $v16 = (!$v14);
const $x17 = $es($v15);
$o += "<section class=\"" + $v13 + "\"" + ($v16 ? " hidden=\"\"" : "") + ($x17 !== null ? " data-campaign=\"" + $x17 + "\"" : $at($v15, " data-campaign=\"", "\"", " data-campaign=\"true\"", " data-campaign=\"false\"", "", 73)) + "><span class=\"ns-promo-html\">" + ("" + $v10) + "</span><code class=\"ns-promo-code\">";
$L = false;
if ($x17 !== null) $te($x17); else $tn($v15);
$o += "</code></section>";
$L = false;
break;
}
default: $fb(74);
}
}
}
}
function $T20($p0, $tc) {
if ((!$p0)) {
$fb(75);
} else {
const $v0 = $p0.length;
if (($v0 === 0)) {

} else {
$o += "<nav class=\"ns-crumbs\" aria-label=\"Breadcrumb\"><ol class=\"ns-crumb-list\">";
$L = false;
const $a1 = $p0;
if (!Array.isArray($a1)) $fb(76);
const $n1 = $a1.length;
const $b1_0 = $p0;
for (let $i1 = 0; $i1 < $n1; $i1++) $B21($a1[$i1], $i1, $a1, $b1_0, null);
$o += "</ol></nav>";
$L = false;
}
}
}
function $T22($p0, $p1, $p2, $tc) {
const $rI0 = $id($tc, 0);
if ($p0) {
const $v0 = Boolean($p0);
const $v1 = $p2.selected;
const $v2 = cx("ns-filter-opt", ({"is-selected": $v1}));
const $v3 = $p2.value;
const $v4 = Boolean($v1);
const $v5 = $p2.label;
const $v6 = $p2.count;
const $v7 = ("f_" + $p1);
$o += "<li" + $at($v2, " class=\"", "\"", "", "", "", 77) + "><input type=\"checkbox\" id=\"" + $rI0 + "\" name=\"" + $e($v7) + "\"" + ($v0 ? " disabled=\"\"" : "") + ($v4 ? " checked=\"\"" : "") + $at($v3, " value=\"", "\"", " value=\"true\"", " value=\"false\"", "", 82) + "/><label for=\"" + $rI0 + "\">";
$L = false;
$tn($v5);
$o += "</label>";
$L = false;
$T9_0($v6, null);
$o += "</li>";
$L = false;
} else {
const $v8 = $p2.count;
const $v9 = Boolean(($v8 === 0));
const $v10 = $p2.selected;
const $v11 = cx("ns-filter-opt", ({"is-selected": $v10}));
const $v12 = $p2.value;
const $v13 = Boolean($v10);
const $v14 = $p2.label;
const $v15 = ("f_" + $p1);
$o += "<li" + $at($v11, " class=\"", "\"", "", "", "", 84) + "><input type=\"checkbox\" id=\"" + $rI0 + "\" name=\"" + $e($v15) + "\"" + ($v9 ? " disabled=\"\"" : "") + ($v13 ? " checked=\"\"" : "") + $at($v12, " value=\"", "\"", " value=\"true\"", " value=\"false\"", "", 89) + "/><label for=\"" + $rI0 + "\">";
$L = false;
$tn($v14);
$o += "</label>";
$L = false;
$T9_0($v8, null);
$o += "</li>";
$L = false;
}
}
function $T23($p0, $tc) {
const $v0 = $p0.options;
const $v1 = $v0.length;
if (($v1 === 0)) {
$fb(91);
} else {
const $v2 = $p0.disabled;
const $v3 = Boolean($v2);
const $v4 = $p0.id;
const $v5 = $p0.title;
$o += "<fieldset class=\"ns-filter-group\"" + ($v3 ? " disabled=\"\"" : "") + $at($v4, " data-filter-key=\"", "\"", " data-filter-key=\"true\"", " data-filter-key=\"false\"", "", 93) + "><legend class=\"ns-filter-legend\">";
$L = false;
$tn($v5);
const $tc6 = $push($tc, 2, 1);
$o += "</legend><ul class=\"ns-filter-list\">";
$L = false;
const $a7 = $v0;
if (!Array.isArray($a7)) $fb(94);
const $n7 = $a7.length;
const $b7_0 = $p0;
for (let $i7 = 0; $i7 < $n7; $i7++) $B24($a7[$i7], $i7, $a7, $b7_0, $push($tc6, $n7, $i7));
$o += "</ul></fieldset>";
$L = false;
}
}
function $T25($p0, $p1, $tc) {
const $rI0 = $id($tc, 0);
const $rI1 = $id($tc, 1);
const $v0 = Boolean($p1);
const $tcR = $push($tc, 1, 0);
const $tc1 = $push($tcR, 3, 2);
$o += "<aside class=\"ns-sidebar\" aria-labelledby=\"" + $rI0 + "\"><h2 id=\"" + $rI0 + "\" class=\"ns-sidebar-title\">Filters</h2><div class=\"ns-stock-toggle\"><input type=\"checkbox\" id=\"" + $rI1 + "\" name=\"in_stock\"" + ($v0 ? " checked=\"\"" : "") + "/><label for=\"" + $rI1 + "\">In-stock items only</label></div>";
$L = false;
const $a2 = $p0;
if (!Array.isArray($a2)) $fb(100);
const $n2 = $a2.length;
for (let $i2 = 0; $i2 < $n2; $i2++) $B26($a2[$i2], $i2, $a2, $push($tc1, $n2, $i2));
$o += "</aside>";
$L = false;
}
function $T27($p0, $p1, $p2, $tc) {
const $rC1 = $ctx[1];
const $v0 = ((typeof $p0) === "number");
if ($v0) {
if (($p0 > $p1)) {
const $v1 = ($p0 > 0);
if ($v1) {
const $v2 = ((typeof $p2) === "number");
if ($v2) {
const $v3 = ($p2 !== 0);
if ($v3) {
const $v4 = Math.round(((($p0 - $p1) / $p0) * 100));
const $v5 = formatMoney($p1, $rC1);
const $v6 = formatMoney($p0, $rC1);
const $v7 = formatMoney($p2, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v1 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v5);
$o += "</span><del class=\"ns-price-orig\">";
$L = false;
$tn($v6);
$o += "</del><span class=\"ns-price-save\">Save ";
$L = true;
$te(("" + $v4));
$o += ($L ? "<!-- -->" : "") + "%</span><span class=\"ns-price-rebate\">Rebate: ";
$L = true;
$tn($v7);
$o += "</span></div>";
$L = false;
} else {
$fb(102);
}
} else {
const $v8 = Math.round(((($p0 - $p1) / $p0) * 100));
const $v9 = formatMoney($p1, $rC1);
const $v10 = formatMoney($p0, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v1 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v9);
$o += "</span><del class=\"ns-price-orig\">";
$L = false;
$tn($v10);
$o += "</del><span class=\"ns-price-save\">Save ";
$L = true;
$te(("" + $v8));
$o += ($L ? "<!-- -->" : "") + "%</span></div>";
$L = false;
}
} else {
$fb(104);
}
} else {
$fb(105);
}
} else {
const $v11 = ((typeof $p2) === "number");
if ($v11) {
const $v12 = ($p2 !== 0);
if ($v12) {
const $v13 = formatMoney($p1, $rC1);
const $v14 = formatMoney($p2, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v0 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v13);
$o += "</span><span class=\"ns-price-rebate\">Rebate: ";
$L = true;
$tn($v14);
$o += "</span></div>";
$L = false;
} else {
$fb(107);
}
} else {
const $v15 = formatMoney($p1, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v0 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v15);
$o += "</span></div>";
$L = false;
}
}
}
function $T28($p0, $p1, $tc) {
if (($p1 <= 0)) {
$o += "<span class=\"ns-stock ns-stock-out\" data-stock-state=\"out\">Out of stock</span>";
$L = false;
} else {
if (($p1 <= 5)) {
$o += "<span class=\"ns-stock ns-stock-low\" data-stock-state=\"low\">Only ";
$L = true;
$tn($p1);
$o += ($L ? "<!-- -->" : "") + " left</span>";
$L = false;
} else {
if (((typeof $p0) === "number")) {
const $v0 = formatDateUTC($p0, false);
$o += "<span class=\"ns-stock ns-stock-in\" data-stock-state=\"in\">In stock";
$L = true;
$te($e((" · Ships " + $v0)));
$o += "</span>";
$L = false;
} else {
$o += "<span class=\"ns-stock ns-stock-in\" data-stock-state=\"in\">In stock</span>";
$L = false;
}
}
}
}
function $T29($p0, $p1, $tc) {
const $rC1 = $ctx[1];
if (($p0 < 0)) {
$fb(109);
} else {
if (($p0 > 5)) {
$fb(110);
} else {
if (($p1 > 0)) {
const $v0 = Math.round((($p0 / 5) * 100));
const $v1 = ($v0 + "%");
switch ($scls($v1)) {
case "S": {
const $v2 = $p0.toFixed(1);
const $v3 = $rC1.groupSep;
const $v4 = formatInt($p1, $v3);
const $v5 = (("Rated " + $v2) + " out of 5");
$o += "<div class=\"ns-rating\" aria-label=\"" + $e(("Rated " + $v2)) + " out of 5\"><span class=\"ns-rating-track\" aria-hidden=\"true\"><span class=\"ns-rating-fill\" style=\"width:" + $e(("" + $v1).trim()) + ";opacity:1\"></span></span><span class=\"ns-rating-num\">";
$L = false;
$tn($v2);
$o += "</span><span class=\"ns-rating-count\">(";
$L = true;
$tn($v4);
$o += ($L ? "<!-- -->" : "") + ")</span></div>";
$L = false;
break;
}
default: $fb(112);
}
} else {
const $v6 = Math.round((($p0 / 5) * 100));
const $v7 = ($v6 + "%");
switch ($scls($v7)) {
case "S": {
const $v8 = $p0.toFixed(1);
const $v9 = $rC1.groupSep;
const $v10 = formatInt($p1, $v9);
const $v11 = (("Rated " + $v8) + " out of 5");
$o += "<div class=\"ns-rating\" aria-label=\"" + $e(("Rated " + $v8)) + " out of 5\"><span class=\"ns-rating-track\" aria-hidden=\"true\"><span class=\"ns-rating-fill\" style=\"width:" + $e(("" + $v7).trim()) + ";opacity:0.35\"></span></span><span class=\"ns-rating-num\">";
$L = false;
$tn($v8);
$o += "</span><span class=\"ns-rating-count\">(";
$L = true;
$tn($v10);
$o += ($L ? "<!-- -->" : "") + ")</span></div>";
$L = false;
break;
}
default: $fb(114);
}
}
}
}
}
function $T30($p0, $tc) {
if ((!$p0)) {

} else {
const $v0 = $p0.length;
if (($v0 === 0)) {
$fb(115);
} else {
$o += "<dl class=\"ns-specs\">";
$L = false;
const $a1 = $p0;
if (!Array.isArray($a1)) $fb(116);
const $n1 = $a1.length;
for (let $i1 = 0; $i1 < $n1; $i1++) $B31($a1[$i1], $i1, $a1, null);
$o += "</dl>";
$L = false;
}
}
}
function $T32($p0, $tc) {
if ((!$p0)) {

} else {
const $v0 = $p0.verified;
if ($v0) {
const $v1 = Boolean($v0);
const $v2 = $p0.body;
const $v3 = $p0.author;
const $v4 = $p0.createdAtSec;
const $v5 = formatDateUTC($v4, false);
$o += "<blockquote class=\"ns-review\"" + ($v1 ? " data-verified=\"true\"" : " data-verified=\"false\"") + "><p class=\"ns-review-body\">“";
$L = true;
$tn($v2);
$o += ($L ? "<!-- -->" : "") + "”</p><footer class=\"ns-review-meta\"><span class=\"ns-review-author\">";
$L = false;
$tn($v3);
$o += "</span><span class=\"ns-review-badge\">Verified Buyer</span><time class=\"ns-review-date\">";
$L = false;
$tn($v5);
$o += "</time></footer></blockquote>";
$L = false;
} else {
const $v6 = Boolean($v0);
const $v7 = $p0.body;
const $v8 = $p0.author;
const $v9 = $p0.createdAtSec;
const $v10 = formatDateUTC($v9, false);
$o += "<blockquote class=\"ns-review\"" + ($v6 ? " data-verified=\"true\"" : " data-verified=\"false\"") + "><p class=\"ns-review-body\">“";
$L = true;
$tn($v7);
$o += ($L ? "<!-- -->" : "") + "”</p><footer class=\"ns-review-meta\"><span class=\"ns-review-author\">";
$L = false;
$tn($v8);
$o += "</span><time class=\"ns-review-date\">";
$L = false;
$tn($v10);
$o += "</time></footer></blockquote>";
$L = false;
}
}
}
function $T33($p0, $tc) {
const $v0 = ((typeof $p0.originalPrice) === "number");
if ($v0) {
const $v1 = $p0.featured;
const $v2 = (!$v1);
if ($v2) {
const $v3 = $p0.clearance;
const $v4 = (!$v3);
if ($v4) {
const $v5 = $p0.originalPrice;
const $v6 = $p0.price;
const $v7 = ($v5 > $v6);
if ((!$v7)) {
$fb(119);
} else {
if ($v1) {
$fb(120);
} else {
if ($v7) {
if ($v3) {
$fb(121);
} else {
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-sale\">Sale</span></div>";
$L = false;
}
} else {
$fb(122);
}
}
}
} else {
if ($v1) {
$fb(123);
} else {
const $v8 = $p0.originalPrice;
const $v9 = $p0.price;
const $v10 = ($v8 > $v9);
if ($v10) {
if ($v3) {
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-sale\">Sale</span><span class=\"ns-badge ns-badge-clearance\">Clearance</span></div>";
$L = false;
} else {
$fb(124);
}
} else {
$fb(125);
}
}
}
} else {
if ($v1) {
const $v11 = $p0.originalPrice;
const $v12 = $p0.price;
const $v13 = ($v11 > $v12);
if ($v13) {
const $v14 = $p0.clearance;
if ($v14) {
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-featured\">Featured</span><span class=\"ns-badge ns-badge-sale\">Sale</span><span class=\"ns-badge ns-badge-clearance\">Clearance</span></div>";
$L = false;
} else {
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-featured\">Featured</span><span class=\"ns-badge ns-badge-sale\">Sale</span></div>";
$L = false;
}
} else {
$fb(126);
}
} else {
$fb(127);
}
}
} else {
const $v15 = $p0.featured;
const $v16 = (!$v15);
if ($v16) {
const $v17 = $p0.clearance;
const $v18 = (!$v17);
if ($v18) {
if ((!$v0)) {
const $v19 = $p0.originalPrice;
} else {
$fb(128);
}
} else {
if ($v15) {
$fb(129);
} else {
if ($v17) {
const $v20 = $p0.originalPrice;
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-clearance\">Clearance</span></div>";
$L = false;
} else {
$fb(130);
}
}
}
} else {
if ($v15) {
const $v21 = $p0.clearance;
if ($v21) {
const $v22 = $p0.originalPrice;
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-featured\">Featured</span><span class=\"ns-badge ns-badge-clearance\">Clearance</span></div>";
$L = false;
} else {
const $v23 = $p0.originalPrice;
$o += "<div class=\"ns-badges\"><span class=\"ns-badge ns-badge-featured\">Featured</span></div>";
$L = false;
}
} else {
$fb(131);
}
}
}
}
function $T34($p0, $p1, $tc) {
const $rC0 = $ctx[0];
const $v0 = $p1.stock;
const $v1 = ($v0 > 0);
if ($v1) {
const $v2 = $p1.featured;
if ($v2) {
const $v3 = getThemePalette($rC0);
const $v4 = $v3.accent;
switch ($scls($v4)) {
case "S": {
switch ($scls0($p0)) {
case "M": {
const $v5 = $p1.sku;
const $v6 = $p1.category;
const $v7 = Boolean($v2);
const $v8 = $p1.title;
const $v9 = (!$v1);
const $v10 = $tab3[($v7 ? 1 : 0) | ($v9 ? 2 : 0)];
const $v11 = $p1.brand;
const $v12 = $p1.rating;
const $v13 = $p1.reviewCount;
const $v14 = $p1.specs;
const $v15 = $p1.price;
const $v16 = $p1.originalPrice;
const $v17 = $p1.rebateAmount;
const $v18 = $p1.shipsAtSec;
const $v19 = $p1.topReview;
const $x20 = $es($v5);
$o += "<article" + ($x20 !== null ? " data-sku=\"" + $x20 + "\"" : $at($v5, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 132)) + $at($v6, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 133) + ($v1 ? " data-in-stock=\"true\"" : " data-in-stock=\"false\"") + ($v7 ? " data-featured=\"true\"" : " data-featured=\"false\"") + " itemscope=\"\" class=\"" + $v10 + "\" style=\"border-color:" + $e(("" + $v4).trim()) + ";order:" + ("" + $p0) + "\">";
$L = false;
$T33($p1, null);
$o += "<div class=\"ns-card-head\"><span class=\"ns-card-brand\">";
$L = false;
$tn($v11);
$o += "</span><span class=\"ns-card-sku\">#";
$L = true;
if ($x20 !== null) $te($x20); else $tn($v5);
const $v21 = ("/p/" + $v5);
const $x22 = $es($v8);
$o += "</span></div><h3 class=\"ns-card-title\"><a href=\"" + $e($v21) + "\"" + ($x22 !== null ? " title=\"" + $x22 + "\"" : $at($v8, " title=\"", "\"", "", "", "", 138)) + ">";
$L = false;
if ($x22 !== null) $te($x22); else $tn($v8);
$o += "</a></h3>";
$L = false;
$T29($v12, $v13, null);
$T30($v14, null);
$T27($v16, $v15, $v17, null);
$o += "<div class=\"ns-card-footer\">";
$L = false;
$T28($v18, $v0, null);
const $v23 = ({"data-add-sku": $v5, "aria-label": ("Add to cart: " + $v8)});
$T10_1($v9, $v23, null);
$o += "</div>";
$L = false;
$T32($v19, null);
$o += "</article>";
$L = false;
break;
}
default: $fb(139);
}
break;
}
default: $fb(140);
}
} else {
switch ($scls0($p0)) {
case "M": {
const $v24 = getThemePalette($rC0);
const $v25 = $p1.sku;
const $v26 = $p1.category;
const $v27 = Boolean($v2);
const $v28 = $p1.title;
const $v29 = (!$v1);
const $v30 = $tab3[($v27 ? 1 : 0) | ($v29 ? 2 : 0)];
const $v31 = $p1.brand;
const $v32 = $p1.rating;
const $v33 = $p1.reviewCount;
const $v34 = $p1.specs;
const $v35 = $p1.price;
const $v36 = $p1.originalPrice;
const $v37 = $p1.rebateAmount;
const $v38 = $p1.shipsAtSec;
const $v39 = $p1.topReview;
const $x40 = $es($v25);
$o += "<article" + ($x40 !== null ? " data-sku=\"" + $x40 + "\"" : $at($v25, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 141)) + $at($v26, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 142) + ($v1 ? " data-in-stock=\"true\"" : " data-in-stock=\"false\"") + ($v27 ? " data-featured=\"true\"" : " data-featured=\"false\"") + " itemscope=\"\" class=\"" + $v30 + "\" style=\"order:" + ("" + $p0) + "\">";
$L = false;
$T33($p1, null);
$o += "<div class=\"ns-card-head\"><span class=\"ns-card-brand\">";
$L = false;
$tn($v31);
$o += "</span><span class=\"ns-card-sku\">#";
$L = true;
if ($x40 !== null) $te($x40); else $tn($v25);
const $v41 = ("/p/" + $v25);
const $x42 = $es($v28);
$o += "</span></div><h3 class=\"ns-card-title\"><a href=\"" + $e($v41) + "\"" + ($x42 !== null ? " title=\"" + $x42 + "\"" : $at($v28, " title=\"", "\"", "", "", "", 147)) + ">";
$L = false;
if ($x42 !== null) $te($x42); else $tn($v28);
$o += "</a></h3>";
$L = false;
$T29($v32, $v33, null);
$T30($v34, null);
$T27($v36, $v35, $v37, null);
$o += "<div class=\"ns-card-footer\">";
$L = false;
$T28($v38, $v0, null);
const $v43 = ({"data-add-sku": $v25, "aria-label": ("Add to cart: " + $v28)});
$T10_1($v29, $v43, null);
$o += "</div>";
$L = false;
$T32($v39, null);
$o += "</article>";
$L = false;
break;
}
default: $fb(148);
}
}
} else {
const $v44 = $p1.featured;
if ($v44) {
const $v45 = getThemePalette($rC0);
const $v46 = $v45.accent;
switch ($scls($v46)) {
case "S": {
switch ($scls0($p0)) {
case "M": {
const $v47 = $p1.sku;
const $v48 = $p1.category;
const $v49 = Boolean($v44);
const $v50 = $p1.title;
const $v51 = (!$v1);
const $v52 = $tab3[($v49 ? 1 : 0) | ($v51 ? 2 : 0)];
const $v53 = $p1.brand;
const $v54 = $p1.rating;
const $v55 = $p1.reviewCount;
const $v56 = $p1.specs;
const $v57 = $p1.price;
const $v58 = $p1.originalPrice;
const $v59 = $p1.rebateAmount;
const $v60 = $p1.shipsAtSec;
const $v61 = $p1.topReview;
const $x62 = $es($v47);
$o += "<article" + ($x62 !== null ? " data-sku=\"" + $x62 + "\"" : $at($v47, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 149)) + $at($v48, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 150) + ($v1 ? " data-in-stock=\"true\"" : " data-in-stock=\"false\"") + ($v49 ? " data-featured=\"true\"" : " data-featured=\"false\"") + " itemscope=\"\" class=\"" + $v52 + "\" style=\"border-color:" + $e(("" + $v46).trim()) + ";order:" + ("" + $p0) + "\">";
$L = false;
$T33($p1, null);
$o += "<div class=\"ns-card-head\"><span class=\"ns-card-brand\">";
$L = false;
$tn($v53);
$o += "</span><span class=\"ns-card-sku\">#";
$L = true;
if ($x62 !== null) $te($x62); else $tn($v47);
const $v63 = ("/p/" + $v47);
const $x64 = $es($v50);
$o += "</span></div><h3 class=\"ns-card-title\"><a href=\"" + $e($v63) + "\"" + ($x64 !== null ? " title=\"" + $x64 + "\"" : $at($v50, " title=\"", "\"", "", "", "", 155)) + ">";
$L = false;
if ($x64 !== null) $te($x64); else $tn($v50);
$o += "</a></h3>";
$L = false;
$T29($v54, $v55, null);
$T30($v56, null);
$T27($v58, $v57, $v59, null);
$o += "<div class=\"ns-card-footer\">";
$L = false;
$T28($v60, $v0, null);
const $v65 = ({"data-add-sku": $v47, "aria-label": ("Unavailable: " + $v50)});
$T10_2($v51, $v65, null);
$o += "</div>";
$L = false;
$T32($v61, null);
$o += "</article>";
$L = false;
break;
}
default: $fb(156);
}
break;
}
default: $fb(157);
}
} else {
switch ($scls0($p0)) {
case "M": {
const $v66 = getThemePalette($rC0);
const $v67 = $p1.sku;
const $v68 = $p1.category;
const $v69 = Boolean($v44);
const $v70 = $p1.title;
const $v71 = (!$v1);
const $v72 = $tab3[($v69 ? 1 : 0) | ($v71 ? 2 : 0)];
const $v73 = $p1.brand;
const $v74 = $p1.rating;
const $v75 = $p1.reviewCount;
const $v76 = $p1.specs;
const $v77 = $p1.price;
const $v78 = $p1.originalPrice;
const $v79 = $p1.rebateAmount;
const $v80 = $p1.shipsAtSec;
const $v81 = $p1.topReview;
const $x82 = $es($v67);
$o += "<article" + ($x82 !== null ? " data-sku=\"" + $x82 + "\"" : $at($v67, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 158)) + $at($v68, " data-category=\"", "\"", " data-category=\"true\"", " data-category=\"false\"", "", 159) + ($v1 ? " data-in-stock=\"true\"" : " data-in-stock=\"false\"") + ($v69 ? " data-featured=\"true\"" : " data-featured=\"false\"") + " itemscope=\"\" class=\"" + $v72 + "\" style=\"order:" + ("" + $p0) + "\">";
$L = false;
$T33($p1, null);
$o += "<div class=\"ns-card-head\"><span class=\"ns-card-brand\">";
$L = false;
$tn($v73);
$o += "</span><span class=\"ns-card-sku\">#";
$L = true;
if ($x82 !== null) $te($x82); else $tn($v67);
const $v83 = ("/p/" + $v67);
const $x84 = $es($v70);
$o += "</span></div><h3 class=\"ns-card-title\"><a href=\"" + $e($v83) + "\"" + ($x84 !== null ? " title=\"" + $x84 + "\"" : $at($v70, " title=\"", "\"", "", "", "", 164)) + ">";
$L = false;
if ($x84 !== null) $te($x84); else $tn($v70);
$o += "</a></h3>";
$L = false;
$T29($v74, $v75, null);
$T30($v76, null);
$T27($v78, $v77, $v79, null);
$o += "<div class=\"ns-card-footer\">";
$L = false;
$T28($v80, $v0, null);
const $v85 = ({"data-add-sku": $v67, "aria-label": ("Unavailable: " + $v70)});
$T10_2($v71, $v85, null);
$o += "</div>";
$L = false;
$T32($v81, null);
$o += "</article>";
$L = false;
break;
}
default: $fb(165);
}
}
}
}
function $T35($p0, $tc) {
if ($p0) {
$o += "<div class=\"ns-empty\" role=\"status\"" + $at($p0, " data-query=\"", "\"", " data-query=\"true\"", " data-query=\"false\"", "", 166) + "><h3 class=\"ns-empty-title\">No matching products found</h3><p class=\"ns-empty-desc\">";
$L = false;
$te($e(("No hardware matched \"" + $p0)) + "&quot;. Try clearing filters.");
$o += "</p>";
$L = false;
$T10_3(null);
$o += "</div>";
$L = false;
} else {
$o += "<div class=\"ns-empty\" role=\"status\"" + $at($p0, " data-query=\"", "\"", " data-query=\"true\"", " data-query=\"false\"", "", 167) + "><h3 class=\"ns-empty-title\">No matching products found</h3><p class=\"ns-empty-desc\">This category currently has 0 items available.</p>";
$L = false;
$T10_3(null);
$o += "</div>";
$L = false;
}
}
function $T36($p0, $p1, $tc) {
const $v0 = $p0.length;
if (($v0 === 0)) {
$T35($p1, null);
} else {
$o += "<div class=\"ns-grid\"" + $at($v0, " data-count=\"", "\"", " data-count=\"true\"", " data-count=\"false\"", "", 168) + ">";
$L = false;
const $a1 = $p0;
if (!Array.isArray($a1)) $fb(169);
const $n1 = $a1.length;
for (let $i1 = 0; $i1 < $n1; $i1++) $B37($a1[$i1], $i1, $a1, null);
$o += "</div>";
$L = false;
}
}
function $T38($p0, $tc) {
if ((!$p0)) {

} else {
const $v0 = $p0.blurb;
if ($v0) {
const $v1 = $p0.sku;
const $v2 = $p0.headline;
const $v3 = $p0.endsAtSec;
const $v4 = formatDateUTC($v3, true);
const $v5 = $p0.price;
const $v6 = $p0.originalPrice;
const $v7 = $p0.stock;
$o += "<section class=\"ns-spotlight\"" + $at($v1, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 170) + "><div class=\"ns-spotlight-body\"><span class=\"ns-spotlight-kicker\">Deal of the Day</span><h2 class=\"ns-spotlight-title\">";
$L = false;
$tn($v2);
$o += "</h2><p class=\"ns-spotlight-blurb\">";
$L = false;
$tn($v0);
$o += "</p><p class=\"ns-spotlight-ends\">Ends ";
$L = true;
$tn($v4);
$o += "</p></div><div class=\"ns-spotlight-aside\">";
$L = false;
$T27_0($v6, $v5, null);
$T28_0($v7, null);
const $v8 = ($v7 <= 0);
const $v9 = ({"data-spotlight-sku": $v1});
$T10_4($v8, $v9, null);
$o += "</div></section>";
$L = false;
} else {
const $v10 = $p0.sku;
const $v11 = $p0.headline;
const $v12 = $p0.endsAtSec;
const $v13 = formatDateUTC($v12, true);
const $v14 = $p0.price;
const $v15 = $p0.originalPrice;
const $v16 = $p0.stock;
$o += "<section class=\"ns-spotlight\"" + $at($v10, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 171) + "><div class=\"ns-spotlight-body\"><span class=\"ns-spotlight-kicker\">Deal of the Day</span><h2 class=\"ns-spotlight-title\">";
$L = false;
$tn($v11);
$o += "</h2><p class=\"ns-spotlight-ends\">Ends ";
$L = true;
$tn($v13);
$o += "</p></div><div class=\"ns-spotlight-aside\">";
$L = false;
$T27_0($v15, $v14, null);
$T28_0($v16, null);
const $v17 = ($v16 <= 0);
const $v18 = ({"data-spotlight-sku": $v10});
$T10_4($v17, $v18, null);
$o += "</div></section>";
$L = false;
}
}
}
function $T39($p0, $p1, $p2, $tc) {
const $rC1 = $ctx[1];
const $rI0 = $id($tc, 0);
switch ($acls($rI0)) {
case "v": {
if ($p0 === "price-asc") {
const $v0 = $p1.visibleCount;
const $v1 = $rC1.groupSep;
const $v2 = formatInt($v0, $v1);
const $v3 = formatInt($p2, $v1);
const $v4 = $p1.inStockCount;
const $v5 = $p1.onSaleCount;
$o += "<div class=\"ns-toolbar\"><p class=\"ns-toolbar-summary\">Showing <strong>";
$L = false;
$tn($v2);
$o += "</strong> <!-- -->of <strong>";
$L = false;
$tn($v3);
$o += "</strong> <!-- -->items (";
$L = true;
$tn($v4);
$o += ($L ? "<!-- -->" : "") + " ready, ";
$L = true;
$tn($v5);
$o += ($L ? "<!-- -->" : "") + " on sale)</p><div class=\"ns-toolbar-sort\"><label for=\"" + $rI0 + "\">Sort:</label><select id=\"" + $rI0 + "\" name=\"sort\"><option value=\"featured\">Featured</option><option value=\"price-asc\" selected=\"\">Price: Low to High</option><option value=\"price-desc\">Price: High to Low</option><option value=\"rating\">Customer Rating</option></select></div></div>";
$L = false;
} else if ($p0 === "rating") {
const $v6 = $p1.visibleCount;
const $v7 = $rC1.groupSep;
const $v8 = formatInt($v6, $v7);
const $v9 = formatInt($p2, $v7);
const $v10 = $p1.inStockCount;
const $v11 = $p1.onSaleCount;
$o += "<div class=\"ns-toolbar\"><p class=\"ns-toolbar-summary\">Showing <strong>";
$L = false;
$tn($v8);
$o += "</strong> <!-- -->of <strong>";
$L = false;
$tn($v9);
$o += "</strong> <!-- -->items (";
$L = true;
$tn($v10);
$o += ($L ? "<!-- -->" : "") + " ready, ";
$L = true;
$tn($v11);
$o += ($L ? "<!-- -->" : "") + " on sale)</p><div class=\"ns-toolbar-sort\"><label for=\"" + $rI0 + "\">Sort:</label><select id=\"" + $rI0 + "\" name=\"sort\"><option value=\"featured\">Featured</option><option value=\"price-asc\">Price: Low to High</option><option value=\"price-desc\">Price: High to Low</option><option value=\"rating\" selected=\"\">Customer Rating</option></select></div></div>";
$L = false;
} else if ($p0 === "price-desc") {
const $v12 = $p1.visibleCount;
const $v13 = $rC1.groupSep;
const $v14 = formatInt($v12, $v13);
const $v15 = formatInt($p2, $v13);
const $v16 = $p1.inStockCount;
const $v17 = $p1.onSaleCount;
$o += "<div class=\"ns-toolbar\"><p class=\"ns-toolbar-summary\">Showing <strong>";
$L = false;
$tn($v14);
$o += "</strong> <!-- -->of <strong>";
$L = false;
$tn($v15);
$o += "</strong> <!-- -->items (";
$L = true;
$tn($v16);
$o += ($L ? "<!-- -->" : "") + " ready, ";
$L = true;
$tn($v17);
$o += ($L ? "<!-- -->" : "") + " on sale)</p><div class=\"ns-toolbar-sort\"><label for=\"" + $rI0 + "\">Sort:</label><select id=\"" + $rI0 + "\" name=\"sort\"><option value=\"featured\">Featured</option><option value=\"price-asc\">Price: Low to High</option><option value=\"price-desc\" selected=\"\">Price: High to Low</option><option value=\"rating\">Customer Rating</option></select></div></div>";
$L = false;
} else if ($p0 === "featured") {
const $v18 = $p1.visibleCount;
const $v19 = $rC1.groupSep;
const $v20 = formatInt($v18, $v19);
const $v21 = formatInt($p2, $v19);
const $v22 = $p1.inStockCount;
const $v23 = $p1.onSaleCount;
$o += "<div class=\"ns-toolbar\"><p class=\"ns-toolbar-summary\">Showing <strong>";
$L = false;
$tn($v20);
$o += "</strong> <!-- -->of <strong>";
$L = false;
$tn($v21);
$o += "</strong> <!-- -->items (";
$L = true;
$tn($v22);
$o += ($L ? "<!-- -->" : "") + " ready, ";
$L = true;
$tn($v23);
$o += ($L ? "<!-- -->" : "") + " on sale)</p><div class=\"ns-toolbar-sort\"><label for=\"" + $rI0 + "\">Sort:</label><select id=\"" + $rI0 + "\" name=\"sort\"><option value=\"featured\" selected=\"\">Featured</option><option value=\"price-asc\">Price: Low to High</option><option value=\"price-desc\">Price: High to Low</option><option value=\"rating\">Customer Rating</option></select></div></div>";
$L = false;
} else { $fb(176); }
break;
}
default: $fb(177);
}
}
function $T40($p0, $tc) {
if ((!$p0)) {
$fb(178);
} else {
const $v0 = $p0.totalPages;
if (($v0 <= 1)) {

} else {
const $v1 = Math.max(1, ($p0.currentPage - 2));
const $v2 = Math.min($v0, ($v1 + 4));
if (($v1 <= $v2)) {
const $v3 = ((+$v1) + 1);
if (($v3 <= $v2)) {
const $v4 = ((+$v3) + 1);
if (($v4 <= $v2)) {
const $v5 = ((+$v4) + 1);
if (($v5 <= $v2)) {
if ((((+$v5) + 1) <= $v2)) {
$fb(179);
} else {
const $v6 = $p0.currentPage;
$o += "<nav class=\"ns-pagination\" aria-label=\"Pagination\">";
$L = false;
const $a7 = [$v1, $v3, $v4, $v5];
if (!Array.isArray($a7)) $fb(180);
const $n7 = $a7.length;
const $b7_0 = $p0;
for (let $i7 = 0; $i7 < $n7; $i7++) $B41($a7[$i7], $i7, $a7, $b7_0, null);
$o += "</nav>";
$L = false;
}
} else {
const $v8 = $p0.currentPage;
$o += "<nav class=\"ns-pagination\" aria-label=\"Pagination\">";
$L = false;
const $a9 = [$v1, $v3, $v4];
if (!Array.isArray($a9)) $fb(181);
const $n9 = $a9.length;
const $b9_0 = $p0;
for (let $i9 = 0; $i9 < $n9; $i9++) $B41($a9[$i9], $i9, $a9, $b9_0, null);
$o += "</nav>";
$L = false;
}
} else {
const $v10 = $p0.currentPage;
$o += "<nav class=\"ns-pagination\" aria-label=\"Pagination\">";
$L = false;
const $a11 = [$v1, $v3];
if (!Array.isArray($a11)) $fb(182);
const $n11 = $a11.length;
const $b11_0 = $p0;
for (let $i11 = 0; $i11 < $n11; $i11++) $B41($a11[$i11], $i11, $a11, $b11_0, null);
$o += "</nav>";
$L = false;
}
} else {
$fb(183);
}
} else {
$fb(184);
}
}
}
}
function $T42($p0, $tc) {
const $rC1 = $ctx[1];
const $v0 = $p0.backordered;
if ($v0) {
const $v1 = $p0.qty;
const $v2 = $p0.unitPrice;
const $v3 = $p0.sku;
const $v4 = $p0.title;
const $v5 = formatMoney($v2, $rC1);
const $v6 = formatMoney(($v1 * $v2), $rC1);
$o += "<li class=\"ns-cart-item\"" + $at($v3, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 185) + "><div class=\"ns-cart-item-main\"><span class=\"ns-cart-item-title\">";
$L = false;
$tn($v4);
$o += "</span><span class=\"ns-cart-backorder\">Backorder</span></div><div class=\"ns-cart-item-math\">";
$L = false;
$tn($v1);
$o += ($L ? "<!-- -->" : "") + " × ";
$L = true;
$tn($v5);
$o += ($L ? "<!-- -->" : "") + " =<!-- --> <strong>";
$L = false;
$tn($v6);
$o += "</strong></div></li>";
$L = false;
} else {
const $v7 = $p0.qty;
const $v8 = $p0.unitPrice;
const $v9 = $p0.sku;
const $v10 = $p0.title;
const $v11 = formatMoney($v8, $rC1);
const $v12 = formatMoney(($v7 * $v8), $rC1);
$o += "<li class=\"ns-cart-item\"" + $at($v9, " data-sku=\"", "\"", " data-sku=\"true\"", " data-sku=\"false\"", "", 186) + "><div class=\"ns-cart-item-main\"><span class=\"ns-cart-item-title\">";
$L = false;
$tn($v10);
$o += "</span></div><div class=\"ns-cart-item-math\">";
$L = false;
$tn($v7);
$o += ($L ? "<!-- -->" : "") + " × ";
$L = true;
$tn($v11);
$o += ($L ? "<!-- -->" : "") + " =<!-- --> <strong>";
$L = false;
$tn($v12);
$o += "</strong></div></li>";
$L = false;
}
}
function $T43($p0, $tc) {
const $rC1 = $ctx[1];
const $rC2 = $ctx[2];
const $v0 = $p0.items;
const $v1 = $v0.length;
const $v2 = ($v1 === 0);
if ((!$v2)) {
if ($v2) {
$fb(187);
} else {
const $v3 = $hy_mk44($p0, $rC2)();
const $v4 = $v3.memberDiscount;
const $v5 = ($v4 !== 0);
if ($v5) {
const $v6 = $p0.creditAdjustment;
const $v7 = ($v6 !== 0);
if ($v7) {
const $v8 = $v3.shipping;
const $v9 = ($v8 === 0);
if ($v9) {
const $v10 = $v3.unitCount;
const $v11 = $v3.subtotal;
const $v12 = formatMoney($v11, $rC1);
const $v13 = formatMoney($v4, $rC1);
const $v14 = formatMoney($v6, $rC1);
const $v15 = $v3.tax;
const $v16 = formatMoney($v15, $rC1);
const $v17 = $v3.grandTotal;
const $v18 = formatMoney($v17, $rC1);
const $v19 = $p0.notesOpen;
const $v20 = Boolean($v19);
const $v21 = $p0.freeShippingThreshold;
const $v22 = formatMoney($v21, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v10);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a23 = $v0;
if (!Array.isArray($a23)) $fb(189);
const $n23 = $a23.length;
for (let $i23 = 0; $i23 < $n23; $i23++) $B45($a23[$i23], $i23, $a23, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v12);
$o += "</dd><dt>Member Discount</dt><dd>";
$L = false;
$tn($v13);
$o += "</dd><dt>Account Credit</dt><dd>";
$L = false;
$tn($v14);
$o += "</dd><dt>Shipping</dt><dd>FREE</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v16);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v18);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v20 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v22);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
} else {
const $v24 = $v3.unitCount;
const $v25 = $v3.subtotal;
const $v26 = formatMoney($v25, $rC1);
const $v27 = formatMoney($v4, $rC1);
const $v28 = formatMoney($v6, $rC1);
const $v29 = formatMoney($v8, $rC1);
const $v30 = $v3.tax;
const $v31 = formatMoney($v30, $rC1);
const $v32 = $v3.grandTotal;
const $v33 = formatMoney($v32, $rC1);
const $v34 = $p0.notesOpen;
const $v35 = Boolean($v34);
const $v36 = $p0.freeShippingThreshold;
const $v37 = formatMoney($v36, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v24);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a38 = $v0;
if (!Array.isArray($a38)) $fb(192);
const $n38 = $a38.length;
for (let $i38 = 0; $i38 < $n38; $i38++) $B45($a38[$i38], $i38, $a38, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v26);
$o += "</dd><dt>Member Discount</dt><dd>";
$L = false;
$tn($v27);
$o += "</dd><dt>Account Credit</dt><dd>";
$L = false;
$tn($v28);
$o += "</dd><dt>Shipping</dt><dd>";
$L = false;
$tn($v29);
$o += "</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v31);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v33);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v35 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v37);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
}
} else {
const $v39 = $v3.shipping;
const $v40 = ($v39 === 0);
if ($v40) {
const $v41 = $v3.unitCount;
const $v42 = $v3.subtotal;
const $v43 = formatMoney($v42, $rC1);
const $v44 = formatMoney($v4, $rC1);
const $v45 = $v3.tax;
const $v46 = formatMoney($v45, $rC1);
const $v47 = $v3.grandTotal;
const $v48 = formatMoney($v47, $rC1);
const $v49 = $p0.notesOpen;
const $v50 = Boolean($v49);
const $v51 = $p0.freeShippingThreshold;
const $v52 = formatMoney($v51, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v41);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a53 = $v0;
if (!Array.isArray($a53)) $fb(195);
const $n53 = $a53.length;
for (let $i53 = 0; $i53 < $n53; $i53++) $B45($a53[$i53], $i53, $a53, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v43);
$o += "</dd><dt>Member Discount</dt><dd>";
$L = false;
$tn($v44);
$o += "</dd><dt>Shipping</dt><dd>FREE</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v46);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v48);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v50 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v52);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
} else {
const $v54 = $v3.unitCount;
const $v55 = $v3.subtotal;
const $v56 = formatMoney($v55, $rC1);
const $v57 = formatMoney($v4, $rC1);
const $v58 = formatMoney($v39, $rC1);
const $v59 = $v3.tax;
const $v60 = formatMoney($v59, $rC1);
const $v61 = $v3.grandTotal;
const $v62 = formatMoney($v61, $rC1);
const $v63 = $p0.notesOpen;
const $v64 = Boolean($v63);
const $v65 = $p0.freeShippingThreshold;
const $v66 = formatMoney($v65, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v54);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a67 = $v0;
if (!Array.isArray($a67)) $fb(198);
const $n67 = $a67.length;
for (let $i67 = 0; $i67 < $n67; $i67++) $B45($a67[$i67], $i67, $a67, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v56);
$o += "</dd><dt>Member Discount</dt><dd>";
$L = false;
$tn($v57);
$o += "</dd><dt>Shipping</dt><dd>";
$L = false;
$tn($v58);
$o += "</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v60);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v62);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v64 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v66);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
}
}
} else {
const $v68 = $p0.creditAdjustment;
const $v69 = ($v68 !== 0);
if ($v69) {
const $v70 = $v3.shipping;
const $v71 = ($v70 === 0);
if ($v71) {
const $v72 = $v3.unitCount;
const $v73 = $v3.subtotal;
const $v74 = formatMoney($v73, $rC1);
const $v75 = formatMoney($v68, $rC1);
const $v76 = $v3.tax;
const $v77 = formatMoney($v76, $rC1);
const $v78 = $v3.grandTotal;
const $v79 = formatMoney($v78, $rC1);
const $v80 = $p0.notesOpen;
const $v81 = Boolean($v80);
const $v82 = $p0.freeShippingThreshold;
const $v83 = formatMoney($v82, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v72);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a84 = $v0;
if (!Array.isArray($a84)) $fb(201);
const $n84 = $a84.length;
for (let $i84 = 0; $i84 < $n84; $i84++) $B45($a84[$i84], $i84, $a84, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v74);
$o += "</dd><dt>Account Credit</dt><dd>";
$L = false;
$tn($v75);
$o += "</dd><dt>Shipping</dt><dd>FREE</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v77);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v79);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v81 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v83);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
} else {
const $v85 = $v3.unitCount;
const $v86 = $v3.subtotal;
const $v87 = formatMoney($v86, $rC1);
const $v88 = formatMoney($v68, $rC1);
const $v89 = formatMoney($v70, $rC1);
const $v90 = $v3.tax;
const $v91 = formatMoney($v90, $rC1);
const $v92 = $v3.grandTotal;
const $v93 = formatMoney($v92, $rC1);
const $v94 = $p0.notesOpen;
const $v95 = Boolean($v94);
const $v96 = $p0.freeShippingThreshold;
const $v97 = formatMoney($v96, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v85);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a98 = $v0;
if (!Array.isArray($a98)) $fb(204);
const $n98 = $a98.length;
for (let $i98 = 0; $i98 < $n98; $i98++) $B45($a98[$i98], $i98, $a98, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v87);
$o += "</dd><dt>Account Credit</dt><dd>";
$L = false;
$tn($v88);
$o += "</dd><dt>Shipping</dt><dd>";
$L = false;
$tn($v89);
$o += "</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v91);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v93);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v95 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v97);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
}
} else {
const $v99 = $v3.shipping;
const $v100 = ($v99 === 0);
if ($v100) {
const $v101 = $v3.unitCount;
const $v102 = $v3.subtotal;
const $v103 = formatMoney($v102, $rC1);
const $v104 = $v3.tax;
const $v105 = formatMoney($v104, $rC1);
const $v106 = $v3.grandTotal;
const $v107 = formatMoney($v106, $rC1);
const $v108 = $p0.notesOpen;
const $v109 = Boolean($v108);
const $v110 = $p0.freeShippingThreshold;
const $v111 = formatMoney($v110, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v101);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a112 = $v0;
if (!Array.isArray($a112)) $fb(207);
const $n112 = $a112.length;
for (let $i112 = 0; $i112 < $n112; $i112++) $B45($a112[$i112], $i112, $a112, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v103);
$o += "</dd><dt>Shipping</dt><dd>FREE</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v105);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v107);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v109 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v111);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
} else {
const $v113 = $v3.unitCount;
const $v114 = $v3.subtotal;
const $v115 = formatMoney($v114, $rC1);
const $v116 = formatMoney($v99, $rC1);
const $v117 = $v3.tax;
const $v118 = formatMoney($v117, $rC1);
const $v119 = $v3.grandTotal;
const $v120 = formatMoney($v119, $rC1);
const $v121 = $p0.notesOpen;
const $v122 = Boolean($v121);
const $v123 = $p0.freeShippingThreshold;
const $v124 = formatMoney($v123, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v113);
$o += ($L ? "<!-- -->" : "") + ")</h2><ul class=\"ns-cart-list\">";
$L = false;
const $a125 = $v0;
if (!Array.isArray($a125)) $fb(210);
const $n125 = $a125.length;
for (let $i125 = 0; $i125 < $n125; $i125++) $B45($a125[$i125], $i125, $a125, null);
$o += "</ul><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v115);
$o += "</dd><dt>Shipping</dt><dd>";
$L = false;
$tn($v116);
$o += "</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v118);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v120);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v122 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v124);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
}
}
}
}
} else {
if ($v2) {
const $v126 = $p0.creditAdjustment;
const $v127 = ($v126 !== 0);
if ($v127) {
const $v128 = $hy_mk44($p0, $rC2)();
const $v129 = $v128.memberDiscount;
const $v130 = ($v129 !== 0);
if ($v130) {
$fb(212);
} else {
const $v131 = $v128.shipping;
const $v132 = ($v131 === 0);
if ($v132) {
const $v133 = $v128.unitCount;
const $v134 = $v128.subtotal;
const $v135 = formatMoney($v134, $rC1);
const $v136 = formatMoney($v126, $rC1);
const $v137 = $v128.tax;
const $v138 = formatMoney($v137, $rC1);
const $v139 = $v128.grandTotal;
const $v140 = formatMoney($v139, $rC1);
const $v141 = $p0.notesOpen;
const $v142 = Boolean($v141);
const $v143 = $p0.freeShippingThreshold;
const $v144 = formatMoney($v143, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v133);
$o += ($L ? "<!-- -->" : "") + ")</h2><p class=\"ns-cart-empty\">Your quote list is empty.</p><dl class=\"ns-cart-totals\"><dt>Subtotal</dt><dd>";
$L = false;
$tn($v135);
$o += "</dd><dt>Account Credit</dt><dd>";
$L = false;
$tn($v136);
$o += "</dd><dt>Shipping</dt><dd>FREE</dd><dt>Est. Tax</dt><dd>";
$L = false;
$tn($v138);
$o += "</dd><dt class=\"ns-cart-grand-label\">Total</dt><dd class=\"ns-cart-grand-val\">";
$L = false;
$tn($v140);
$o += "</dd></dl><details class=\"ns-cart-notes\"" + ($v142 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v144);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
} else {
$fb(215);
}
}
} else {
const $v145 = $hy_mk44($p0, $rC2)();
const $v146 = $v145.unitCount;
const $v147 = $p0.notesOpen;
const $v148 = Boolean($v147);
const $v149 = $p0.freeShippingThreshold;
const $v150 = formatMoney($v149, $rC1);
$o += "<aside class=\"ns-cart\"" + ($v2 ? " data-empty=\"true\"" : " data-empty=\"false\"") + "><h2 class=\"ns-cart-title\">Order Quote (";
$L = true;
$tn($v146);
$o += ($L ? "<!-- -->" : "") + ")</h2><p class=\"ns-cart-empty\">Your quote list is empty.</p><details class=\"ns-cart-notes\"" + ($v148 ? " open=\"\"" : "") + "><summary>Freight &amp; Net-30 Terms</summary><p>Orders above ";
$L = true;
$tn($v150);
$o += ($L ? "<!-- -->" : "") + " ship free.</p></details>";
$L = false;
$T10_5($v2, null);
$o += "</aside>";
$L = false;
}
} else {
$fb(218);
}
}
}
function $T46($p0, $tc) {
const $rC0 = $ctx[0];
const $rC1 = $ctx[1];
const $v0 = formatDateUTC($p0, true);
const $v1 = $rC1.code;
const $v2 = $rC1.currency;
$o += "<footer class=\"ns-footer\"><p class=\"ns-footer-copy\">© Northstar Industrial Supply · Generated<!-- --> <time>";
$L = false;
$tn($v0);
$o += "</time></p><p class=\"ns-footer-meta\"><span>Locale: ";
$L = true;
$tn($v1);
$o += "</span> · <span>Currency: ";
$L = true;
$tn($v2);
$o += "</span> · <span>Theme: ";
$L = true;
$tn($rC0);
$o += "</span></p></footer>";
$L = false;
}
function $T47($p0, $p1, $tc) {
const $rC0 = $ctx[0];
const $rC1 = $ctx[1];
const $v0 = getThemePalette($rC0);
const $v1 = $v0.bg;
switch ($scls($v1)) {
case "S": {
const $v2 = $v0.fg;
switch ($scls($v2)) {
case "S": {
const $v3 = $p0.compactMode;
const $v4 = Boolean($v3);
const $v5 = cx("ns-shell", ("ns-theme-" + $rC0), ({"ns-compact": $v4}));
const $v6 = $rC1.code;
const $v7 = $p0.requestId;
const $v8 = $p0.promo;
const $v9 = $p0.search;
const $v10 = $p0.categories;
const $v11 = $p0.breadcrumbs;
const $v12 = $p0.filters;
const $v13 = $v9.inStockOnly;
const $v14 = $p0.spotlight;
const $v15 = $p0.pagination;
const $v16 = $v15.totalMatching;
const $v17 = $v9.sortBy;
const $v18 = $p0.products;
const $v19 = $v9.query;
const $v20 = $p0.cart;
const $v21 = $p0.timestampSec;
$o += "<div id=\"northstar-app\"" + $at($v5, " class=\"", "\"", "", "", "", 219) + $at($rC0, " data-theme=\"", "\"", " data-theme=\"true\"", " data-theme=\"false\"", "", 220) + $at($v6, " data-locale=\"", "\"", " data-locale=\"true\"", " data-locale=\"false\"", "", 221) + $at($v7, " data-request-id=\"", "\"", " data-request-id=\"true\"", " data-request-id=\"false\"", "", 222) + " style=\"background-color:" + $e(("" + $v1).trim()) + ";color:" + $e(("" + $v2).trim()) + ";min-height:100vh\">";
$L = false;
$T19($v8, null);
const $tc22 = $push($tc, 5, 1);
$T18($v10, $v9, $tc22);
$T20($v11, null);
const $tc23 = $push($tc, 5, 3);
const $tc24 = $push($tc23, 3, 0);
$o += "<div class=\"ns-layout\">";
$L = false;
$T25($v12, $v13, $tc24);
const $tc25 = $push($tc23, 3, 1);
$o += "<main class=\"ns-main\">";
$L = false;
$T38($v14, null);
const $tc26 = $push($tc25, 4, 1);
$T39($v17, $p1, $v16, $tc26);
$T36($v18, $v19, null);
$T40($v15, null);
$o += "</main>";
$L = false;
$T43($v20, null);
$o += "</div>";
$L = false;
$T46($v21, null);
$o += "</div>";
$L = false;
break;
}
default: $fb(223);
}
break;
}
default: $fb(224);
}
}
function $T48($p0, $tc) {
const $v0 = $p0.products;
const $v1 = $hy_mk49($p0)();
const $v2 = $p0.theme;
const $v3 = $p0.locale;
const $v4 = $p0.user;
const $s5 = $ctx[0];
$ctx[0] = $v2;
const $s6 = $ctx[1];
$ctx[1] = $v3;
const $s7 = $ctx[2];
$ctx[2] = $v4;
$T47($p0, $v1, $tc);
$ctx[2] = $s7;
$ctx[1] = $s6;
$ctx[0] = $s5;
}
function $T9($p0, $p1, $tc) {
const $rC1 = $ctx[1];
const $v0 = Boolean($p1);
const $v1 = $tab4[($v0 ? 1 : 0)];
const $v2 = $rC1.groupSep;
const $v3 = formatInt($p0, $v2);
$o += "<span class=\"" + $v1 + "\"" + (($p0 <= 0) ? " hidden=\"\"" : "") + (($p0 === 0) ? " data-zero=\"true\"" : " data-zero=\"false\"") + ">";
$L = false;
$tn($v3);
$o += "</span>";
$L = false;
}
function $T10_0($p2, $tc) {
const $v0 = Boolean($p2);
$o += "<button data-action=\"catalog-search\" aria-label=\"Run catalog search\" type=\"submit\" class=\"ns-btn ns-btn-secondary ns-btn-sm\"" + ($v0 ? " disabled=\"\"" : "") + " data-variant=\"secondary\">Search</button>";
$L = false;
}
function $T9_0($p0, $tc) {
const $rC1 = $ctx[1];
const $v0 = $rC1.groupSep;
const $v1 = formatInt($p0, $v0);
$o += "<span class=\"ns-pill\"" + (($p0 <= 0) ? " hidden=\"\"" : "") + (($p0 === 0) ? " data-zero=\"true\"" : " data-zero=\"false\"") + ">";
$L = false;
$tn($v1);
$o += "</span>";
$L = false;
}
function $T10_1($p2, $p3, $tc) {
const $k0 = $okeys($p3);
if (typeof $k0 !== "string" && $k0.length === 2 && $k0[0] === "data-add-sku" && $k0[1] === "aria-label") {
const $v1 = Boolean($p2);
const $v2 = $p3["data-add-sku"];
const $v3 = $p3["aria-label"];
$o += "<button" + $at($v2, " data-add-sku=\"", "\"", " data-add-sku=\"true\"", " data-add-sku=\"false\"", "", 231) + $at($v3, " aria-label=\"", "\"", " aria-label=\"true\"", " aria-label=\"false\"", "", 232) + " type=\"button\" class=\"ns-btn ns-btn-primary ns-btn-sm\"" + ($v1 ? " disabled=\"\"" : "") + " data-variant=\"primary\">Add to Cart</button>";
$L = false;
} else { $fb(234); }
}
function $T10_2($p2, $p3, $tc) {
const $k0 = $okeys($p3);
if (typeof $k0 !== "string" && $k0.length === 2 && $k0[0] === "data-add-sku" && $k0[1] === "aria-label") {
const $v1 = Boolean($p2);
const $v2 = $p3["data-add-sku"];
const $v3 = $p3["aria-label"];
$o += "<button" + $at($v2, " data-add-sku=\"", "\"", " data-add-sku=\"true\"", " data-add-sku=\"false\"", "", 235) + $at($v3, " aria-label=\"", "\"", " aria-label=\"true\"", " aria-label=\"false\"", "", 236) + " type=\"button\" class=\"ns-btn ns-btn-ghost ns-btn-sm\"" + ($v1 ? " disabled=\"\"" : "") + " data-variant=\"ghost\">Notify Me</button>";
$L = false;
} else { $fb(238); }
}
function $T10_3($tc) {
$o += "<button data-action=\"reset-filters\" type=\"button\" class=\"ns-btn ns-btn-secondary\" data-variant=\"secondary\">Reset Filters</button>";
$L = false;
}
function $T27_0($p0, $p1, $tc) {
const $rC1 = $ctx[1];
const $v0 = ((typeof $p0) === "number");
if ($v0) {
if (($p0 > $p1)) {
const $v1 = ($p0 > 0);
if ($v1) {
const $v2 = Math.round(((($p0 - $p1) / $p0) * 100));
const $v3 = formatMoney($p1, $rC1);
const $v4 = formatMoney($p0, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v1 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v3);
$o += "</span><del class=\"ns-price-orig\">";
$L = false;
$tn($v4);
$o += "</del><span class=\"ns-price-save\">Save ";
$L = true;
$te(("" + $v2));
$o += ($L ? "<!-- -->" : "") + "%</span></div>";
$L = false;
} else {
$fb(240);
}
} else {
$fb(241);
}
} else {
const $v5 = formatMoney($p1, $rC1);
$o += "<div class=\"ns-price-block\"" + ($v0 ? " data-on-sale=\"true\"" : " data-on-sale=\"false\"") + "><span class=\"ns-price-current\">";
$L = false;
$tn($v5);
$o += "</span></div>";
$L = false;
}
}
function $T28_0($p1, $tc) {
if (($p1 <= 0)) {
$o += "<span class=\"ns-stock ns-stock-out\" data-stock-state=\"out\">Out of stock</span>";
$L = false;
} else {
if (($p1 <= 5)) {
$o += "<span class=\"ns-stock ns-stock-low\" data-stock-state=\"low\">Only ";
$L = true;
$tn($p1);
$o += ($L ? "<!-- -->" : "") + " left</span>";
$L = false;
} else {
$o += "<span class=\"ns-stock ns-stock-in\" data-stock-state=\"in\">In stock</span>";
$L = false;
}
}
}
function $T10_4($p2, $p3, $tc) {
const $k0 = $okeys($p3);
if ($k0 === "#nullish") {
const $v1 = Boolean($p2);
$o += "<button type=\"button\" class=\"ns-btn ns-btn-primary\"" + ($v1 ? " disabled=\"\"" : "") + " data-variant=\"primary\">View Deal</button>";
$L = false;
} else if (typeof $k0 !== "string" && $k0.length === 1 && $k0[0] === "data-spotlight-sku") {
const $v2 = Boolean($p2);
const $v3 = $p3["data-spotlight-sku"];
$o += "<button" + $at($v3, " data-spotlight-sku=\"", "\"", " data-spotlight-sku=\"true\"", " data-spotlight-sku=\"false\"", "", 244) + " type=\"button\" class=\"ns-btn ns-btn-primary\"" + ($v2 ? " disabled=\"\"" : "") + " data-variant=\"primary\">View Deal</button>";
$L = false;
} else if (typeof $k0 !== "string" && $k0.length === 1 && $k0[0] === "data-action") {
const $v4 = Boolean($p2);
const $v5 = $p3["data-action"];
$o += "<button" + $at($v5, " data-action=\"", "\"", " data-action=\"true\"", " data-action=\"false\"", "", 246) + " type=\"button\" class=\"ns-btn ns-btn-primary\"" + ($v4 ? " disabled=\"\"" : "") + " data-variant=\"primary\">View Deal</button>";
$L = false;
} else { $fb(248); }
}
function $T10_5($p2, $tc) {
const $v0 = Boolean($p2);
$o += "<button type=\"button\" class=\"ns-btn ns-btn-primary\"" + ($v0 ? " disabled=\"\"" : "") + " data-variant=\"primary\">Proceed to Checkout</button>";
$L = false;
}
return {
  contexts: [ThemeContext, LocaleContext, UserContext],
  setDefaults(values) { for (let i = 0; i < values.length; i++) $ctxDefault[i] = values[i]; },
  render(data) {
    $o = "";
    $L = false;
    for (let i = 0; i < $ctxDefault.length; i++) $ctx[i] = $ctxDefault[i];
    $T48(data, { id: 1, ov: "" });
    const out = $o;
    $o = "";
    return out;
  },
  isFallback(e) { return e === $FB; },
  lastFallbackSite() { return $fbSite; },
  fallbackNow() { $fb(-2); },
};
})()
/* ═══════════════════════════════════════════════════════════════════════════
   ANTESIGNA — front end

   Reads two files written by the generator:
     data/index_latest.json   current snapshot
     data/history.json        rolling hourly series

   Everything visible is derived from those at runtime. No figure and no
   sentence is hardcoded: the prose is produced by rule from the numbers
   (see §4), so the page rewrites itself every refresh without an author.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var RAW = {}, D = {}, ASSETS = [], EQUITY_BUCKETS = [], POSITION_BUCKETS = [],
    EQUITY_TIERS = [], WATCH_ACTIVITY = {}, SER = {}, MOVERS = [];
  var CFG = window.ANTESIGNA_CONFIG || {};
  var READ = window.ANTESIGNA_READ_LOGIC;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var timers = [];

  /* ── 0 · small helpers ─────────────────────────────────────────────── */
  var MINUS = "−", ARR = "→", STALE_MINUTES = 90, PUBLIC_HISTORY_DAYS = 90;
  var TRACKING_STARTED_AT = new Date("2026-01-17T00:44:00-05:00");
  function money(m) {
    var a = Math.abs(m), s = a >= 1 ? a.toFixed(1) : a.toFixed(2);
    return (m < 0 ? MINUS + "$" : "+$") + s + "M";
  }
  function sgn(v, d) {
    d = (d === undefined ? 2 : d);
    return (v < 0 ? MINUS : v > 0 ? "+" : "") + Math.abs(v).toFixed(d);
  }
  function two(v) { return (v < 10 ? "0" : "") + v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function B(x) { return "<b>" + x + "</b>"; }
  function el(id) { return document.getElementById(id); }
  function tstamp(p) { return new Date(p.timestamp).getTime(); }
  function etTime(date, seconds) {
    return date.toLocaleTimeString("en-CA", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: seconds ? "2-digit" : undefined
    });
  }

  /* ── 1 · load ──────────────────────────────────────────────────────── */
  function boot() {
    var bust = "?v=" + Math.floor(Date.now() / 3600000);
    Promise.all([
      fetch("data/index_latest.json" + bust).then(okJson),
      fetch("data/history.json" + bust).then(okJson),
      fetch("data/proof_ledger.json" + bust).then(okJson),
      fetch("data/cohort_profile.json" + bust).then(okJson),
      fetch("data/watch_activity.json" + bust).then(okJson)
    ]).then(function (r) {
      RAW.index = r[0]; RAW.history = r[1]; RAW.ledger = r[2];
      RAW.profile = r[3]; RAW.watch = r[4];
      derive();
      render();
      start();
    }).catch(fail);
  }
  function okJson(r) {
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    return r.json();
  }
  function fail(e) {
    var m = el("app");
    m.innerHTML = '<div class="boot err">Could not load the read.<br>' + esc(e.message) +
      '<br><button class="again" id="retry">Try again</button></div>';
    el("retry").addEventListener("click", function () {
      m.innerHTML = '<div class="boot">Loading the read…</div>'; boot();
    });
  }

  /* ── 2 · derive everything from the two files ──────────────────────── */
  function derive() {
    if (!READ) throw new Error("Read logic did not load");
    var idx = RAW.index, allH = RAW.history.hourly, cs = idx.cohort_stats;
    var newest = tstamp(allH[allH.length - 1]);
    var H = allH.filter(function (p) {
      return newest - tstamp(p) <= PUBLIC_HISTORY_DAYS * 864e5;
    });
    var s = H.map(function (p) { return p.index_score; });
    var now = tstamp(H[H.length - 1]), cur = s[s.length - 1];

    function at(daysBack) {
      var t = now - daysBack * 864e5, best = H[0], bd = Infinity;
      H.forEach(function (p) { var d = Math.abs(tstamp(p) - t); if (d < bd) { bd = d; best = p; } });
      return best;
    }
    /* last time the cohort was net long */
    var lastLong = null;
    for (var i = H.length - 1; i >= 0; i--) { if (H[i].index_score > 0) { lastLong = H[i]; break; } }

    /* If the comparison window crosses a cohort rotation the wallet set differs
       at each end, so a delta would measure the swap rather than trading. Clamp
       the window to the current cohort's lifetime. Silent by design. */
    var curCohort = H[H.length - 1].cohort_rebalanced_at, rotIdx = -1;
    for (i = H.length - 1; i > 0; i--) {
      if (H[i].cohort_rebalanced_at !== H[i - 1].cohort_rebalanced_at) { rotIdx = i; break; }
    }
    function comparable(daysBack) {
      var want = at(daysBack);
      if (rotIdx > -1 && tstamp(want) < tstamp(H[rotIdx])) return H[rotIdx];
      return want;
    }

    var base24 = comparable(1), base7 = comparable(7), last = H[H.length - 1];
    var privateAggregate = idx.assets.filter(function (a) { return a.asset === "OTHER"; })[0];
    ASSETS = idx.assets.filter(function (a) { return a.asset !== "OTHER"; }).map(function (a) {
      var net = +(a.net_usd / 1e6).toFixed(2);
      return [a.asset, net, Math.round(a.tilt * 100), a.position_count, +a.conv_equity.toFixed(2),
        READ.grossScale(net, a.tilt)];
    });
    var shortMk = ASSETS.filter(function (a) { return a[1] < 0; }).length;
    var longMk = ASSETS.filter(function (a) { return a[1] > 0; }).length;

    D = {
      generatedAt: new Date(idx.generated_at),
      ageMinutes: (Date.now() - new Date(idx.generated_at).getTime()) / 60000,
      signum: +cur.toFixed(4),
      d1h: +(cur - s[s.length - 2]).toFixed(4),
      d24h: +(cur - base24.index_score).toFixed(4),
      d7d: +(cur - base7.index_score).toFixed(4),
      shorterThanPct: Math.round(100 * s.filter(function (x) { return x > cur; }).length / s.length),
      daysSinceLong: lastLong ? +((now - tstamp(lastLong)) / 864e5).toFixed(1) : null,
      net: +(cs.net_usd / 1e6).toFixed(1),
      grossShortPct: Math.round(100 * cs.gross_short_usd / (cs.gross_long_usd + cs.gross_short_usd)),
      equity: +(cs.total_equity / 1e6).toFixed(1),
      grossLong: +(cs.gross_long_usd / 1e6).toFixed(1),
      grossShort: +(cs.gross_short_usd / 1e6).toFixed(1),
      aggLev: +(cs.gross_notional_usd / cs.total_equity).toFixed(2),
      wallets: cs.active_wallets, totalWallets: cs.total_wallets,
      marketsShown: ASSETS.length, shortMkts: shortMk, longMkts: longMk,
      suppressedPositions: privateAggregate ? privateAggregate.position_count : 0,
      lo: +Math.min.apply(null, s).toFixed(4), hi: +Math.max.apply(null, s).toFixed(4),
      windowHours: Math.round((now - tstamp(base24)) / 36e5),
      historyDays: Math.min(PUBLIC_HISTORY_DAYS, Math.max(1, Math.ceil((now - tstamp(H[0])) / 864e5))),
      publicWindowDays: PUBLIC_HISTORY_DAYS,
      trackedHours: Math.max(0, Math.floor((new Date(idx.generated_at).getTime() - TRACKING_STARTED_AT.getTime()) / 36e5))
    };
    chartRange = PUBLIC_HISTORY_DAYS;

    /* The public publisher exposes fixed aggregate buckets only. The position
       and equity views are intentionally not joinable at wallet level. */
    var W = idx.wallet_distribution;
    if (!W || W.schema_version !== 2 || W.privacy !== "fixed_usd_buckets") {
      throw new Error("Unsupported public distribution schema");
    }
    POSITION_BUCKETS = W.position.slice();
    EQUITY_BUCKETS = W.equity.slice();
    var P = RAW.profile;
    if (!P || P.schema_version !== 1 || P.privacy !== "aggregate_equity_tiers" ||
      P.total_wallets !== D.totalWallets || !Array.isArray(P.equity_tiers)) {
      throw new Error("Unsupported public cohort profile");
    }
    EQUITY_TIERS = P.equity_tiers.slice();
    var A = RAW.watch;
    if (!A || A.schema_version !== 1 || A.privacy !== "hour_slots_only" ||
      A.window_hours !== 168 || !Array.isArray(A.check_slots) ||
      !Array.isArray(A.alert_slots) || A.delivered_alert_count !== A.alert_slots.length) {
      throw new Error("Unsupported public Watch activity");
    }
    WATCH_ACTIVITY = A;

    /* chart series */
    var step = Math.max(1, Math.floor(H.length / 180)), sel = [];
    for (i = 0; i < H.length; i += step) sel.push(H[i]);
    if (sel[sel.length - 1] !== H[H.length - 1]) sel.push(H[H.length - 1]);
    var M = 1e6, fmtDay = function (p) {
      var d = new Date(p.timestamp);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };
    SER = {
      t: sel.map(fmtDay),
      days: sel.map(function (p) { return (now - tstamp(p)) / 864e5; }),
      signum: sel.map(function (p) { return +p.index_score.toFixed(4); }),
      net: sel.map(function (p) { return +(p.cohort_net_usd / M).toFixed(1); }),
      gl: sel.map(function (p) { return +(p.gross_long_usd / M).toFixed(1); }),
      gs: sel.map(function (p) { return -+(p.gross_short_usd / M).toFixed(1); }),
      expo: sel.map(function (p) { return +((p.gross_long_usd + p.gross_short_usd) / M).toFixed(1); }),
      btc: sel.map(function (p) { return +(p.btc_net_usd / M).toFixed(1); }),
      eth: sel.map(function (p) { return +(p.eth_net_usd / M).toFixed(1); }),
      sol: sel.map(function (p) { return +(p.sol_net_usd / M).toFixed(1); }),
      hype: sel.map(function (p) { return +(p.hype_net_usd / M).toFixed(1); }),
      eq: sel.map(function (p) { return +(p.cohort_total_equity / M).toFixed(1); }),
      lev: sel.map(function (p) { return +p.L_cohort_total.toFixed(2); })
    };

    /* movers — the four markets the history file carries per-asset */
    var look = { BTC: "btc", ETH: "eth", SOL: "sol", HYPE: "hype" };
    MOVERS = Object.keys(look).map(function (sym) {
      var k = look[sym], row = ASSETS.filter(function (a) { return a[0] === sym; })[0];
      return [sym, +(base24[k + "_net_usd"] / M).toFixed(2), +(last[k + "_net_usd"] / M).toFixed(2),
      +base24[k + "_conv"].toFixed(2), +last[k + "_conv"].toFixed(2),
      row ? row[3] : 0, row ? row[2] : 0];
    });
    D.lead = READ.selectLeadStory({
      signum: D.signum,
      signum24h: +base24.index_score,
      signum7d: +base7.index_score,
      net: D.net,
      grossLong: D.grossLong,
      grossShort: D.grossShort,
      longMarkets: D.longMkts,
      shortMarkets: D.shortMkts,
      marketCount: D.marketsShown,
      historyScores: s,
      assets: ASSETS.map(function (row) {
        return {
          symbol: row[0],
          net: row[1],
          tilt: row[2],
          traders: row[3],
          conviction: row[4]
        };
      }),
      movers: MOVERS.map(function (row) {
        return { symbol: row[0], previous: row[1], current: row[2] };
      })
    });
  }

  /* ── 3 · magnitude encoding for the hero number ────────────────────── */
  function heatStyle(v) {
    var ext = Math.max(Math.abs(D.lo), Math.abs(D.hi)) || 1,
      t = Math.min(1, Math.abs(v) / ext),
      dir = v < 0 ? [255, 77, 94] : [52, 211, 153], neu = [138, 141, 168],
      mix = 0.30 + 0.70 * t,
      c = [0, 1, 2].map(function (i) { return Math.round(neu[i] + (dir[i] - neu[i]) * mix); });
    return "color:rgb(" + c.join(",") + ");text-shadow:0 0 " + (3 + 14 * t).toFixed(1) +
      "px rgba(" + dir.join(",") + "," + (0.10 + 0.55 * t).toFixed(2) + "),0 0 " +
      (10 + 30 * t).toFixed(1) + "px rgba(" + dir.join(",") + "," + (0.04 + 0.30 * t).toFixed(2) + ")";
  }

  /* ── 4 · COPY GENERATION — rules, not prose ────────────────────────── */
  var FLAT_M = 0.5, CONV_MIN = 0.08;

  function deepestConviction() {
    var best = null;
    ASSETS.forEach(function (a) { if (!best || Math.abs(a[4]) > Math.abs(best[4])) best = a; });
    return best ? best[0] : null;
  }
  /* Conviction is signed: -0.43 -> -0.31 eases, +0.10 -> +0.24 hardens,
     -0.05 -> +0.11 turns. Comparing raw values gets all three wrong. */
  function convClause(cp, cn) {
    var range = B(sgn(cp) + " " + ARR + " " + sgn(cn));
    if ((cp < 0) !== (cn < 0) && Math.abs(cp) > 0.01 && Math.abs(cn) > 0.01)
      return "Conviction turned " + (cn > 0 ? "long" : "short") + ", " + range + ".";
    return "Conviction " + (Math.abs(cn) > Math.abs(cp) ? "hardened" : "eased") + " " + range + ".";
  }
  /* One main clause plus at most one modifier, so no row contradicts itself. */
  function moverSentence(m) {
    var sym = m[0], p = m[1], n = m[2], cp = m[3], cn = m[4], tr = m[5], tilt = m[6];
    var d = n - p, main, statedTilt = false, span = B(money(p) + " " + ARR + " " + money(n));
    if (p < 0 && n >= 0) main = "Crossed from net short to net long — " + span + " — across " + B(tr) + " of the Hundred.";
    else if (p > 0 && n <= 0) main = "Crossed from net long to net short — " + span + " — across " + B(tr) + " of the Hundred.";
    else if (Math.abs(d) < FLAT_M) { main = "Effectively unchanged at " + B(money(n)) + ", held by " + B(tr) + " of the Hundred at a " + B(sgn(tilt, 0) + "%") + " tilt."; statedTilt = true; }
    else if (n < 0 && d > 0) main = "Shorts trimmed " + span + " across " + B(tr) + " traders.";
    else if (n < 0 && d < 0) main = "Short deepened " + span + " across " + B(tr) + " traders.";
    else if (n > 0 && d > 0) main = "Long added to, " + span + ", across " + B(tr) + " traders.";
    else main = "Long reduced " + span + " across " + B(tr) + " traders.";

    var mod = null;
    if (sym === deepestConviction()) mod = "Still the deepest conviction on the board.";
    else if (Math.abs(cn - cp) >= CONV_MIN) mod = convClause(cp, cn);
    else if (!statedTilt && Math.abs(tilt) <= 5) mod = "Tilt is near flat at " + B(sgn(tilt, 0) + "%") + " — size without agreement.";
    return mod ? main + " " + mod : main;
  }
  function movers() {
    return MOVERS.map(function (m) { return [m[0], m[2] - m[1], moverSentence(m)]; })
      .sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
  }

  /* The pure read-logic module scores competing true facts by recency,
     regime significance, historical rarity, and major-market importance. */
  function headline() {
    return D.lead.headline;
  }

  function bucketInsight() {
    var shortCount = POSITION_BUCKETS.filter(function (b) { return b.direction === "short"; })
      .reduce(function (sum, b) { return sum + b.count; }, 0);
    var longCount = POSITION_BUCKETS.filter(function (b) { return b.direction === "long"; })
      .reduce(function (sum, b) { return sum + b.count; }, 0);
    var largest = EQUITY_TIERS.slice().sort(function (a, b) { return b.wallet_count - a.wallet_count; })[0];
    return "Signum is the Hundred’s aggregate lean—not a headcount or a single-market call. Today’s " +
      B(sgn(D.signum)) + " sits alongside " + B(shortCount + " net-short") + " and " + B(longCount +
      " net-long") + " accounts. The largest equity tier is " + B(largest.label) + " with " +
      B(largest.wallet_count) + " accounts. Large long and short exposures can offset, leaving Signum near flat; " +
      '<a href="/method/">see how the measures differ →</a>';
  }

  function latestFeed() {
    var hh = etTime(D.generatedAt), out = [];
    var side = ASSETS.filter(function (a) { return D.net < 0 ? a[1] < 0 : a[1] > 0; })
      .sort(function (a, b) { return D.net < 0 ? a[1] - b[1] : b[1] - a[1]; });
    out.push([hh, "Signum " + B(sgn(D.signum)) + " · net " + B(money(D.net)) + " · " + D.grossShortPct + "% of gross short"]);
    if (side.length > 1)
      out.push([hh, "Long in " + B(D.longMkts + " of " + D.marketsShown) + " markets — the " +
        (D.net < 0 ? "net short" : "net long") + " sits in " + side[0][0] + " and " + side[1][0]]);
    MOVERS.forEach(function (m) {
      if ((m[1] < 0 && m[2] >= 0) || (m[1] > 0 && m[2] <= 0))
        out.push([hh, m[0] + " crossed " + (m[2] >= 0 ? "net long" : "net short") + ", " + B(money(m[2]))]);
    });
    return out.slice(0, 5);
  }

  /* ── 5 · charts ────────────────────────────────────────────────────── */
  function distSvg() {
    var W = 760, BASE = 58, BINS = 52, LO = D.lo, HI = D.hi, i, b;
    var c = new Array(BINS).fill(0), src = SER.signum;
    for (i = 0; i < src.length; i++) {
      b = Math.min(BINS - 1, Math.max(0, Math.floor(((src[i] - LO) / (HI - LO)) * BINS))); c[b]++;
    }
    var sm = c.map(function (_, i) {
      var t = 0, n = 0, k;
      for (k = -2; k <= 2; k++) if (c[i + k] !== undefined) { t += c[i + k] * (3 - Math.abs(k)); n += 3 - Math.abs(k); }
      return t / n;
    });
    var peak = Math.max.apply(null, sm) || 1, bw = W / BINS, out = "";
    for (i = 0; i < BINS; i++) {
      var mid = LO + ((i + 0.5) / BINS) * (HI - LO), h = Math.max(2, Math.round(sm[i] / peak * 48));
      out += '<rect x="' + (i * bw).toFixed(2) + '" y="' + (BASE - h) + '" width="' + (bw - 0.7).toFixed(2) +
        '" height="' + h + '" fill="' + (mid < 0 ? "var(--short)" : "var(--long)") +
        '" fill-opacity="' + (0.28 + (sm[i] / peak) * 0.64).toFixed(2) + '"/>';
    }
    var zx = ((0 - LO) / (HI - LO)) * W, mx = ((D.signum - LO) / (HI - LO)) * W;
    out += '<rect x="' + (zx - 0.5) + '" y="4" width="1" height="' + (BASE - 1) + '" fill="var(--ink2)" fill-opacity=".5"/>';
    out += '<rect x="' + (mx - 1.5) + '" y="0" width="3" height="' + (BASE + 4) + '" fill="var(--ink)"/>';
    return { svg: '<svg viewBox="-2 0 ' + (W + 4) + ' 66" shape-rendering="crispEdges" role="img" aria-label="Distribution of Signum in the rolling ' + D.publicWindowDays + '-day public window, with today marked.">' + out + "</svg>", pct: (mx / W) * 100, zpct: (zx / W) * 100 };
  }

  var chartMode = "signum", chartRange = 90;
  var MODES = {
    signum: { label: "Signum", zero: true, series: [["signum", "Signum", null]] },
    net: { label: "Net position", zero: true, series: [["net", "Net position", null]] },
    ls: { label: "Long / short", zero: true, series: [["gl", "Gross long", "var(--long)"], ["gs", "Gross short", "var(--short)"]] },
    asset: { label: "By market", zero: true, series: [["btc", "BTC", "#F2C14E"], ["eth", "ETH", "#8B5CF6"], ["sol", "SOL", "#4DD8FF"], ["hype", "HYPE", "#E14FEF"]] },
    expo: { label: "Exposure", zero: false, series: [["expo", "Gross exposure", "#4DD8FF"]] },
    eq: { label: "Equity", zero: false, series: [["eq", "Cohort equity", "#8B5CF6"]] },
    lev: { label: "Leverage", zero: false, series: [["lev", "Gross leverage", "#F2C14E"]] }
  };
  function chartSvg() {
    var M = MODES[chartMode], W = 1120, H = 240, PL = 54, PT = 16, PB = 26, i, k;
    var idx = [];
    for (i = 0; i < SER.days.length; i++) if (SER.days[i] <= chartRange) idx.push(i);
    if (idx.length < 2) idx = SER.days.map(function (_, i) { return i; });
    var all = [];
    M.series.forEach(function (sp) { idx.forEach(function (i) { all.push(SER[sp[0]][i]); }); });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (M.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    var pad = (mx - mn) * 0.12 || 1; mn -= pad; mx += pad;
    var X = function (j) { return PL + j / (idx.length - 1) * (W - PL); };
    var Y = function (v) { return PT + (1 - (v - mn) / (mx - mn)) * (H - PT - PB); };
    var s = "", z = Y(0);

    for (k = 0; k <= 3; k++) {
      var gv = mn + (mx - mn) * k / 3, gy = Y(gv);
      s += '<rect x="' + PL + '" y="' + gy.toFixed(1) + '" width="' + (W - PL) + '" height="1" fill="#FFFFFF" fill-opacity=".04"/>';
      s += '<text x="' + (PL - 8) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" fill="#6C7488" font-size="9.5" font-family="JetBrains Mono">' +
        (chartMode === "signum" ? gv.toFixed(2) : chartMode === "lev" ? gv.toFixed(1) + "×" : Math.round(gv)) + "</text>";
    }
    if (M.zero && z > PT && z < H - PB)
      s += '<rect x="' + PL + '" y="' + (z - 0.5).toFixed(1) + '" width="' + (W - PL) + '" height="1" fill="var(--ink2)" fill-opacity=".5"/>';

    M.series.forEach(function (sp, si) {
      var key = sp[0], col = sp[2], d = "M" + X(0).toFixed(1) + "," + Y(SER[key][idx[0]]).toFixed(1);
      for (i = 1; i < idx.length; i++)
        d += " L" + X(i).toFixed(1) + "," + Y(SER[key][idx[i - 1]]).toFixed(1) + " L" + X(i).toFixed(1) + "," + Y(SER[key][idx[i]]).toFixed(1);
      if (col === null) {
        var area = d + " L" + X(idx.length - 1).toFixed(1) + "," + z.toFixed(1) + " L" + PL + "," + z.toFixed(1) + " Z";
        s += '<defs><clipPath id="a' + si + '"><rect x="' + PL + '" y="0" width="' + (W - PL) + '" height="' + z + '"/></clipPath>' +
          '<clipPath id="b' + si + '"><rect x="' + PL + '" y="' + z + '" width="' + (W - PL) + '" height="' + (H - z) + '"/></clipPath></defs>';
        s += '<path d="' + area + '" fill="var(--long)" fill-opacity=".13" clip-path="url(#a' + si + ')"/>';
        s += '<path d="' + area + '" fill="var(--short)" fill-opacity=".13" clip-path="url(#b' + si + ')"/>';
        s += '<path d="' + d + '" fill="none" stroke="var(--long)" stroke-width="1.7" clip-path="url(#a' + si + ')"/>';
        s += '<path d="' + d + '" fill="none" stroke="var(--short)" stroke-width="1.7" clip-path="url(#b' + si + ')"/>';
      } else s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.7"/>';
    });
    [0, Math.floor(idx.length / 3), Math.floor(idx.length * 2 / 3), idx.length - 1].forEach(function (j, n) {
      s += '<text x="' + X(j).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (n === 0 ? "start" : n === 3 ? "end" : "middle") +
        '" fill="#6C7488" font-size="9.5" font-family="JetBrains Mono">' + SER.t[idx[j]] + "</text>";
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" shape-rendering="crispEdges" role="img" aria-label="' + MODES[chartMode].label + ' over ' + chartRange + ' days.">' + s + "</svg>";
  }
  function chartLegend() {
    var M = MODES[chartMode];
    if (M.series.length < 2) return "";
    return '<div class="clegend">' + M.series.map(function (s) {
      return '<span><i style="background:' + (s[2] || "var(--ink2)") + '"></i>' + s[1] + "</span>";
    }).join("") + "</div>";
  }

  /* Privacy-safe distributions. The 100 bars preserve only the count in each
     published range. Their within-band heights are evenly spaced placeholders,
     never exact wallet values and never a joined position/equity record. */
  var barMode = "position";
  var POSITION_RANGES = [
    [-140, -100], [-100, -50], [-50, -25], [-25, -10], [-10, -5], [-5, 0],
    [0, 5], [5, 10], [10, 25], [25, 50], [50, 100], [100, 140]
  ];
  var EQUITY_RANGES = [
    [0, .5], [.5, 1], [1, 2.5], [2.5, 5], [5, 10],
    [10, 25], [25, 50], [50, 100], [100, 140]
  ];
  function expandedBandValues(rows, ranges) {
    var out = [];
    rows.forEach(function (row, index) {
      var range = ranges[index], count = row.count, step = (range[1] - range[0]) / (count + 1);
      for (var j = 0; j < count; j++) {
        out.push({ value: range[0] + step * (j + 1), label: row.label });
      }
    });
    return out;
  }
  function traderSeries() {
    var rows = barMode === "position" ? POSITION_BUCKETS : EQUITY_BUCKETS;
    var ranges = barMode === "position" ? POSITION_RANGES : EQUITY_RANGES;
    var values = expandedBandValues(rows, ranges);
    if (barMode === "log") {
      values.forEach(function (row) { row.value = Math.log10(1 + Math.max(0, row.value)); });
    }
    values.sort(function (a, b) { return b.value - a.value; });
    return values;
  }
  function axisMoney(v) {
    if (barMode === "log") return v.toFixed(1);
    var a = Math.abs(v), label = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(0) : a.toFixed(1);
    return (v < 0 ? MINUS : v > 0 ? "+" : "") + "$" + label + "M";
  }
  function barsSvg() {
    var points = traderSeries(), W = 1120, H = 258, PL = 50, PR = 4, PT = 14, PB = 28;
    var values = points.map(function (row) { return row.value; });
    var min = Math.min.apply(null, values.concat([0])), max = Math.max.apply(null, values.concat([0]));
    var pad = (max - min) * .08 || 1; min -= pad; max += pad;
    var plotH = H - PT - PB, y = function (v) { return PT + (max - v) / (max - min) * plotH; };
    var zero = y(0), bw = (W - PL - PR) / points.length, out = "";
    out += '<rect x="' + PL + '" y="' + zero.toFixed(1) + '" width="' + (W - PL - PR) +
      '" height="1" fill="var(--ink2)" fill-opacity=".56"/>';
    points.forEach(function (row, i) {
      var target = y(row.value), top = Math.min(zero, target), h = Math.max(1.5, Math.abs(target - zero));
      var color = barMode === "position"
        ? (row.value < 0 ? "var(--short)" : "var(--long)")
        : (barMode === "log" ? "var(--cyan)" : "var(--violet)");
      var title = "Anonymous account · public band " + row.label + " · representative height only";
      out += '<rect x="' + (PL + i * bw + .6).toFixed(1) + '" y="' + top.toFixed(1) +
        '" width="' + Math.max(1.2, bw - 1.2).toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="' + color + '" fill-opacity=".86"><title>' + esc(title) + "</title></rect>";
    });
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99].forEach(function (index) {
      out += '<text x="' + (PL + (index + .5) * bw).toFixed(1) + '" y="' + (H - 7) +
        '" text-anchor="middle" fill="#6C7488" font-size="9" font-family="JetBrains Mono">' +
        (index + 1) + "</text>";
    });
    out += '<text x="' + (PL - 7) + '" y="' + (PT + 7) +
      '" text-anchor="end" fill="#8A8DA8" font-size="9.5" font-family="JetBrains Mono">' +
      axisMoney(max - pad) + "</text>";
    out += '<text x="' + (PL - 7) + '" y="' + (H - PB) +
      '" text-anchor="end" fill="#8A8DA8" font-size="9.5" font-family="JetBrains Mono">' +
      axisMoney(min + pad) + "</text>";
    var label = barMode === "position" ? "position" : barMode === "equity" ? "equity" : "log equity";
    return '<svg viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="' + D.totalWallets + " anonymous traders ordered by public " + label +
      ' band. Bar heights are range representatives, not exact trader values.">' + out + "</svg>";
  }

  /* ── 6 · render ────────────────────────────────────────────────────── */
  var sortKey = READ.DEFAULT_BOARD_SORT.key,
    sortDir = READ.DEFAULT_BOARD_SORT.direction;   /* default: gross exposure, highest first */
  function boardRows() {
    var rows = READ.sortBoard(ASSETS, sortKey, sortDir);
    return rows.map(function (a) {
      var sym = a[0], net = a[1], tilt = a[2], tr = a[3], cv = a[4], gross = a[5];
      var mag = Math.min(100, Math.abs(tilt)) / 100 * 29;
      var bar = tilt < 0 ? '<i style="right:50%;width:' + mag.toFixed(1) + 'px;background:var(--short)"></i>'
        : '<i style="left:50%;width:' + mag.toFixed(1) + 'px;background:var(--long)"></i>';
      return "<tr><td class=\"m\">" + esc(sym) + "</td>" +
        '<td class="mut">' + grossText(gross) + "</td>" +
        '<td class="' + (net < 0 ? "dn" : net > 0 ? "up" : "mut") + '">' + money(net) + "</td>" +
        '<td class="tilt-cell mut">' + sgn(tilt, 0) + '%<span class="tilt">' + bar + "</span></td>" +
        '<td class="' + (cv < 0 ? "dn" : cv > 0 ? "up" : "mut") + '">' + sgn(cv) + "</td>" +
        "<td>" + tr + "</td></tr>";
    }).join("");
  }
  function grossText(gross) {
    if (gross === null) return "—";
    return gross < 1 ? "&lt;$1M" : "$" + gross.toFixed(0) + "M";
  }
  function tierRows() {
    var maxEquity = Math.max.apply(null, EQUITY_TIERS.map(function (b) { return b.equity_usd_rounded; })) || 1;
    return EQUITY_TIERS.map(function (b) {
      var total = b.wallet_count || 1;
      var width = Math.max(3, b.equity_usd_rounded / maxEquity * 100);
      return '<div class="tier"><span class="tl">' + esc(b.label) + '</span><span class="c">' +
        b.wallet_count + " traders</span>" +
        '<div class="ttrack"><div class="tbar" style="width:' + width.toFixed(1) + '%">' +
        '<i class="s" style="width:' + (b.short_count / total * 100).toFixed(1) + '%"></i>' +
        '<i class="l" style="width:' + (b.long_count / total * 100).toFixed(1) + '%"></i>' +
        '<i class="f" style="width:' + (b.flat_count / total * 100).toFixed(1) + '%"></i></div></div>' +
        '<span class="e">' + compactEquity(b.equity_usd_rounded) + " equity</span></div>";
    }).join("");
  }
  function compactEquity(value) {
    if (value >= 1e9) return "$" + (value / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    return "$" + (value / 1e3).toFixed(0) + "K";
  }
  function ticks() {
    var out = "", i, checked = {}, alerted = {};
    WATCH_ACTIVITY.check_slots.forEach(function (slot) { checked[slot] = true; });
    WATCH_ACTIVITY.alert_slots.forEach(function (slot) { alerted[slot] = true; });
    for (i = 0; i < 168; i++) {
      out += '<i class="' + (alerted[i] ? "a" : checked[i] ? "c" : "") +
        '" title="' + (alerted[i] ? "Delivered Watch alert" : checked[i] ? "Completed hourly check" : "Scheduled hour") + '"></i>';
    }
    return out;
  }
  function countWord(value) {
    return ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][value] || String(value);
  }
  function tapeHalf() {
    var lead = '<span class="ttag">THE HUNDRED · PER-MARKET NET · ' + D.shortMkts + " SHORT / " + D.longMkts + " LONG</span>";
    return lead + ASSETS.slice(0, 14).map(function (a) {
      return '<span class="tmk"><span class="s">' + esc(a[0]) + '</span><span class="v ' + (a[1] < 0 ? "dn" : "up") +
        '">' + money(a[1]) + '</span><span class="d mut">' + sgn(a[2], 0) + "%</span></span>";
    }).join("");
  }
  function watchStatus() {
    return {
      card: '<div class="alert"><div class="h"><span><b>Antesigna</b> · The Watch</span><span>Member delivery</span></div>' +
        '<div class="b"><span class="trig">Alerts only when positioning materially changes</span>' +
        '<div class="m">The complete tracked market universe is evaluated after every successful hourly refresh.</div>' +
        '<div class="r mut">Qualifying alerts are delivered directly to active subscribers.</div>' +
        '<div class="f">Aggregate positioning data.</div></div></div>'
    };
  }

  function render() {
    var dsv = distSvg(), hh = etTime(D.generatedAt);
    var stamp = D.generatedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) + " · " + hh;
    var LATEST = latestFeed(), MOVED = movers(), WATCH = watchStatus();
    var longBars = POSITION_BUCKETS.filter(function (b) { return b.direction === "long"; })
      .reduce(function (sum, b) { return sum + b.count; }, 0);
    var shortBars = POSITION_BUCKETS.filter(function (b) { return b.direction === "short"; })
      .reduce(function (sum, b) { return sum + b.count; }, 0);

    el("app").innerHTML =
      '<div class="tape"><div class="tapetrack" id="tt"><div class="thalf">' + tapeHalf() +
      '</div><div class="thalf">' + tapeHalf() + "</div></div></div>" +

      '<div class="latest"><div class="k">Latest</div><div class="lwin"><ul id="lu">' +
      LATEST.map(function (l) { return '<li><span class="t mut">' + l[0] + "</span><span>" + l[1] + "</span></li>"; }).join("") +
      '<li><span class="t mut">' + LATEST[0][0] + "</span><span>" + LATEST[0][1] + "</span></li></ul></div></div>" +

      '<div class="wrap"><nav class="nav" aria-label="Primary">' +
      '<a class="brand" href="/"><img src="assets/img/mark.webp" alt="" width="130" height="69"><span class="bname">Ante<i>signa</i></span></a>' +
      '<div class="links"><a class="on" href="/">The Read</a><a href="#board">The Board</a><a href="#hundred">The Hundred</a>' +
      '<a href="/ledger/">The Ledger</a><a href="/method/">The Method</a><a href="#watch">The Watch</a></div>' +
      '<div class="navr"><span class="cd"><i class="dot"></i><span id="cd">NEXT</span></span>' +
      '<a class="btn b-ghost" href="#read">Get the read</a><a class="btn b-gold" href="#watch">Start the Watch</a></div>' +
      "</nav></div><div class=\"rail\"></div>" +

      (D.ageMinutes > STALE_MINUTES
        ? '<div class="wrap"><div class="stale" role="alert">This read is ' +
          Math.max(2, Math.floor(D.ageMinutes / 60)) +
          " hours old. The hourly refresh has not completed since " + hh + " ET.</div></div>"
        : "") +

      '<div class="wrap"><section class="hero"><div class="eyeb">' +
      '<span class="id">Live positioning of 100 screened Hyperliquid traders</span><span class="n">' + stamp + " ET</span></div>" +
      '<h1 class="product-title">Antesigna — live positioning of 100 screened Hyperliquid traders</h1>' +
      '<h2 class="headline">' + esc(headline()) + "</h2>" +
      '<p class="sub"><b>' + esc(D.lead.detail) + '</b> Across the full board, the Hundred are net <b class="n">' +
      money(D.net) + "</b>, with <b>" + D.grossShortPct + "%</b> of gross exposure short, " +
      (D.longMkts > D.shortMkts ? "yet <b>long in " + D.longMkts + " of " + D.marketsShown + "</b> markets" :
        "and <b>short in " + D.shortMkts + " of " + D.marketsShown + "</b> markets") +
      '. <a href="/method/">Method →</a></p>' +
      '<p class="lore"><b>ante signa</b> — “before the standards.” The <em>antesignani</em> were elite legionaries who fought ahead of the line, scouting for what the formation could not yet see.</p>' +

      '<div class="hgrid"><div>' +
      '<div class="signal-label" data-tip="Signum is the normalized aggregate lean of the Hundred, from −1 (fully short) to +1 (fully long)." tabindex="0" role="button" aria-describedby="tip">SIGNUM</div>' +
      '<div class="big n" style="' + heatStyle(D.signum) + '">' + sgn(D.signum).replace(MINUS, "-") + "</div>" +
      '<div class="bmeta"><span class="n">Δ1h ' + sgn(D.d1h, 4) + "</span> · aggregate lean, −1 to +1</div>" +
      '<div class="marks">Net exposure <b class="n ' + (D.net < 0 ? "dn" : "up") + '">' + money(D.net) +
      '</b> · updated ' + hh + ' ET<br><span class="mut">aggregate positions · refreshed hourly</span></div>' +
      "</div><div>" +
      '<div class="lbl" style="margin-bottom:9px"><span data-tip="Every hourly Signum reading in the rolling public window, stacked into buckets. Taller means more hours spent at that level. The white line is now." tabindex="0" role="button" aria-describedby="tip">' + D.publicWindowDays + '-day public distribution · today marked</span></div>' +
      '<div class="dist"><div class="today" style="left:' + dsv.pct.toFixed(2) + '%">Today</div>' + dsv.svg +
      '<div class="dcap"><span>Max short ' + D.lo.toFixed(2) + '</span><span class="z" style="left:' + dsv.zpct.toFixed(2) + '%">Neutral</span><span>Max long +' + D.hi.toFixed(2) + "</span></div></div>" +
      '<div class="chips">' +
      '<span class="chip">' + (D.shorterThanPct >= 50 ? "More short than " + D.shorterThanPct :
        "More long than " + (100 - D.shorterThanPct)) + "% of the public window</span>" +
      (D.daysSinceLong !== null ? '<span class="chip n">Net long last seen <b>' + Math.round(D.daysSinceLong) + "d</b> ago</span>" : "") +
      '<span class="chip"><span data-tip="How many of the tracked markets share the cohort-level lean." tabindex="0" role="button" aria-describedby="tip">Breadth</span> <b>' + D.longMkts + "/" + D.marketsShown + " long</b></span>" +
      '<span class="chip n">Leverage <b>' + D.aggLev.toFixed(2) + "×</b></span></div></div></div>" +

      '<div class="cta"><a class="btn b-gold btn-lg" href="#watch">Start the Watch</a>' +
      '<a class="btn b-ghost btn-lg" href="#read">Get the read</a>' +
      '<span class="ctan">Free, twice daily. No wallet connection.</span></div>' +
      '<div class="trust">Positioning only, never advice · Hourly, not real-time</div></section></div>' +

      '<div class="strip">' +
      '<div><div class="v n">' + D.trackedHours.toLocaleString("en-US") + '</div><div class="k">hours tracked since Jan 17, 2026</div></div>' +
      '<div><div class="v n">' + D.wallets + " / " + D.totalWallets + '</div><div class="k">accounts resolved this hour</div></div>' +
      '<div><div class="v n">' + D.marketsShown + '</div><div class="k">markets currently held</div></div>' +
      '<div><div class="v n">' + D.publicWindowDays + ' d</div><div class="k">rolling public history</div></div></div>' +

      '<div class="wrap"><section class="sec" style="border-top:0" id="chartsec">' +
      '<div class="shead"><div><h2>The Hundred: positioning</h2><div class="ssub" style="margin-bottom:0">Hourly snapshots with a rolling ' + D.publicWindowDays + '-day public window</div></div>' +
      '<div class="ctabs"><div class="tabs" id="cmode">' +
      Object.keys(MODES).map(function (k, i) { return '<button data-c="' + k + '"' + (i === 0 ? ' class="on"' : "") + ">" + MODES[k].label + "</button>"; }).join("") +
      '</div><div class="tabs" id="crange">' +
      [30, 60, PUBLIC_HISTORY_DAYS]
        .map(function (r) { return '<button data-r="' + r + '"' + (r === chartRange ? ' class="on"' : "") + ">" + r + "D</button>"; }).join("") +
      "</div></div></div>" +
      '<div id="chart">' + chartSvg() + '</div><div id="clegend">' + chartLegend() + "</div></section></div>" +

      '<div class="wrap"><section class="sec"><div class="shead"><h2>What moved</h2>' +
      '<div class="tabs"><button class="on">' + D.windowHours + "H</button></div></div>" +
      '<div class="ssub">Largest shifts across the Hundred</div><div>' +
      MOVED.map(function (m) {
        return '<div class="mv"><span class="t">' + esc(m[0]) + '</span><span class="d n ' + (m[1] > 0 ? "up" : "dn") + '">' +
          (m[1] > 0 ? "▲ " : "▼ ") + money(m[1]).replace(/^[+−]/, "") + '</span><span class="c">' + m[2] + "</span></div>";
      }).join("") +
      '</div><div class="quiet">◆ The Watch checks for material aggregate changes after every successful hourly refresh.</div></section></div>' +

      '<div class="wrap"><section class="sec" id="board"><div class="shead"><h2>The Board</h2>' +
      '<div class="tabs"><button class="on">$250k threshold</button></div></div>' +
      '<div class="ssub">Every market the Hundred currently hold — <b class="dn">' + D.shortMkts + ' short</b> · <b class="up">' + D.longMkts + " long</b>.</div>" +
      '<div class="tw"><table><thead><tr>' +
      '<th><button data-s="0">Market</button></th><th><button data-s="5"><span data-tip="Total long + short notional across the Hundred." tabindex="0" aria-describedby="tip">Gross</span></button></th><th><button data-s="1">Net</button></th>' +
      '<th><button data-s="2"><span data-tip="Net exposure as a share of total long + short notional. +100% is all long; −100% is all short." tabindex="0" aria-describedby="tip">Tilt</span></button></th>' +
      '<th><button data-s="4"><span data-tip="The asset’s weighted long-vs-short agreement across the Hundred: +1 is fully long-aligned, −1 fully short-aligned, and 0 balanced." tabindex="0" role="button" aria-describedby="tip">Conviction</span></button></th><th><button data-s="3">Traders</button></th>' +
      '</tr></thead><tbody id="tbody">' + boardRows() + "</tbody></table></div>" +
      '<div class="bfoot"><span>' + D.marketsShown + ' assets currently tracked above $250K threshold</span>' +
      '<span>Sortable · refreshed hourly</span></div></section></div>' +

      '<div class="wrap"><section class="sec" id="hundred"><div class="shead"><h2>The Hundred</h2>' +
      '<div class="tabs" id="htabs"><button class="on" data-h="size">By size</button><button data-h="trader">By trader</button></div></div>' +
      '<div class="ssub" id="hsub">Where the equity sits, and which way each tier leans</div>' +
      '<div id="hsize">' + tierRows() +
      '<div class="legend"><span><i style="background:var(--short)"></i>Net short</span>' +
      '<span><i style="background:var(--long)"></i>Net long</span>' +
      '<span><i style="background:#3A3D55"></i>Flat</span></div>' +
      '<div class="callout">' + bucketInsight() + "</div></div>" +
      '<div id="htrader" hidden><div class="tabs" id="btabs" style="margin-bottom:14px;width:fit-content">' +
      '<button class="on" data-b="position">Position</button><button data-b="equity">Equity</button><button data-b="log">Log</button></div>' +
      '<div id="bars">' + barsSvg() + "</div>" +
      '<div class="bfoot"><span id="bfl">' + D.totalWallets + " anonymous bars ordered by public position band · " + longBars + " long · " + shortBars +
      ' short</span><span>Aggregate range view</span></div></div></section></div>' +

      '<div class="wrap"><div class="duo">' +
      '<div><h3>The Ledger</h3><p>Scheduled aggregate positioning snapshots, retained whether the read later looks useful or wrong.</p><a href="/ledger/">Read the Ledger →</a></div>' +
      '<div><h3>The Method</h3><p>How the Hundred is screened, when it changes, and how to read the system.</p><a href="/method/">Read the Method →</a></div>' +
      '</div></div><div class="rail"></div>' +

      '<div class="wrap"><section class="sec watch" style="border-top:0" id="watch"><div class="wgrid"><div>' +
      '<div class="lbl" style="color:var(--gold)">Antesigna · The Watch</div>' +
      '<h2 class="big2">Up to ' + WATCH_ACTIVITY.scheduled_check_count + " checks a week. " +
      countWord(WATCH_ACTIVITY.delivered_alert_count) + " " +
      (WATCH_ACTIVITY.delivered_alert_count === 1 ? "alert." : "alerts.") + "</h2>" +
      "<p>Everything above is free. The Watch runs the same measurement every hour across all " + D.marketsShown +
      " markets and contacts you only when the aggregate state actually changes — when a regime, Signum, or market-level positioning move clears the production materiality rules.</p>" +
      '<div class="ticks">' + ticks() + '</div><div class="tfoot"><span>7 days ago</span><span>Now</span></div>' +
      '<div class="watch-summary"><b>' + WATCH_ACTIVITY.recorded_check_count + "</b> completed checks in the rolling log · <b>" +
      WATCH_ACTIVITY.delivered_alert_count + "</b> " +
      (WATCH_ACTIVITY.delivered_alert_count === 1 ? "alert" : "alerts") + " delivered.</div>" +
      '<div class="price"><div class="p n">$14<small>/mo</small></div>' +
      '<div class="f">or $119/year · 7-day refund on the first payment<br>Cancel in one click · Telegram activation after checkout</div>' +
      '<a class="btn b-gold btn-lg" href="' + esc(CFG.checkoutMonthly) + '" rel="noopener">Start the Watch</a>' +
      '<a class="annual" href="' + esc(CFG.checkoutAnnual) + '" rel="noopener">Annual checkout →</a></div>' +
      (CFG.transitionNote ? '<p class="transition">' + esc(CFG.transitionNote) + "</p>" : "") + '</div>' +
      '<div>' + WATCH.card + '<p class="after">Review the measurement framework in <a href="/method/">The Method →</a></p></div>' +
      "</div></section></div>" +

      '<div class="wrap"><section class="sec" id="read"><div class="rgrid"><div>' +
      '<h2 class="big2">Get the read</h2>' +
      "<p>Twice a day, the same aggregate read you just looked at — in Telegram, with email available as a free weekly brief.</p>" +
      '<div class="form"><a class="btn b-ghost btn-lg" href="' + esc(CFG.telegramPublic) + '" target="_blank" rel="noopener">Open Telegram</a>' +
      '<a class="btn b-ghost btn-lg" href="' + esc(CFG.telegramSample) + '" target="_blank" rel="noopener">Send one sample</a></div>' +
      '<div class="newsletter" id="newsletterEmbed" aria-label="Email signup"></div>' +
      '<div class="trust">10:00 &amp; 18:00 ET · 2 messages a day</div></div>' +
      '<div><div class="lbl" style="margin-bottom:10px">Today’s read</div><div class="card n">' +
      "<b>Signum " + sgn(D.signum) + " · net " + (D.net < 0 ? "short" : "long") + "</b><br>" +
      "Net " + money(D.net) + " &nbsp;|&nbsp; " + D.grossShortPct + "% of gross short<br>" +
      "Long in " + D.longMkts + " of " + D.marketsShown + " markets<br>" +
      esc(headline()) + "<br>" +
      '<span class="mut">' + (D.shorterThanPct >= 50 ? "More short than " + D.shorterThanPct :
        "More long than " + (100 - D.shorterThanPct)) + "% of the public window.</span></div></div>" +
      "</div></section></div>" +

      '<div class="wrap"><div class="wire n" id="wire"></div></div>' +

      '<footer class="ft"><div class="wrap">' +
      '<a class="brand" href="/"><img src="assets/img/mark.webp" alt="" width="110" height="58" style="height:22px"><span class="bname" style="font-size:15px">Ante<i>signa</i></span></a>' +
      '<div class="ftag">Before the signal.</div>' +
      '<p class="lock"><b>ANTESIGNA</b> — from Lat. <em>ante signa</em>, “before the standards”: the elite legionaries who fought ahead of the line, scouting for what the formation could not yet see.</p>' +
      '<div class="fnav"><a href="/">The Read</a><a href="#board">The Board</a><a href="#hundred">The Hundred</a><a href="/ledger/">The Ledger</a><a href="/method/">The Method</a><a href="#watch">The Watch</a><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a></div>' +
      '<div class="llc">Antesigna is a product of Randolph Ventures LLC. Positioning data only. Not financial advice.</div>' +
      "</div></footer>";

    document.body.classList.toggle("run", !reduced);
    el("app").setAttribute("aria-busy", "false");
    el("wire").innerHTML = etTime(D.generatedAt, true) + " ET · " + D.wallets + "/" + D.totalWallets +
      " resolved · SIGNUM " + sgn(D.signum, 4) + " · Δ1h " + sgn(D.d1h, 4) + ' <span class="cur"></span>';
    wire();
  }

  /* ── 7 · interaction ───────────────────────────────────────────────── */
  function wire() {
    el("cmode").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      chartMode = b.getAttribute("data-c");
      [].forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      el("chart").innerHTML = chartSvg(); el("clegend").innerHTML = chartLegend();
    });
    el("crange").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      chartRange = +b.getAttribute("data-r");
      [].forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      el("chart").innerHTML = chartSvg(); el("clegend").innerHTML = chartLegend();
    });
    el("htabs").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var v = b.getAttribute("data-h");
      [].forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      el("hsize").hidden = v !== "size"; el("htrader").hidden = v !== "trader";
      el("hsub").textContent = v === "size"
        ? "Where the equity sits, and which way each tier leans"
        : D.totalWallets + " traders ordered by public band — long above the line, short below";
    });
    el("btabs").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      barMode = b.getAttribute("data-b");
      [].forEach.call(this.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      el("bars").innerHTML = barsSvg();
      el("bfl").textContent = D.totalWallets + " anonymous bars ordered by public " +
        (barMode === "log" ? "log equity" : barMode) +
        " band · heights represent ranges, not exact accounts";
    });
    document.querySelector("thead").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-s]"); if (!b) return;
      var k = +b.getAttribute("data-s");
      sortDir = (k === sortKey) ? -sortDir : -1;
      sortKey = k;
      el("tbody").innerHTML = boardRows();
    });
    if (CFG.newsletterFormId) {
      var host = el("newsletterEmbed"), script = document.createElement("script");
      script.async = true;
      script.src = "https://subscribe-forms.beehiiv.com/v3/loader.js";
      script.setAttribute("data-beehiiv-form", CFG.newsletterFormId);
      host.appendChild(script);
    }
  }

  /* tooltip: one node at body root so scroll containers cannot clip it */
  (function () {
    var tip = document.createElement("div"), pinned = null;
    tip.id = "tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip);
    function show(t) {
      tip.textContent = t.getAttribute("data-tip"); tip.classList.add("on");
      var r = t.getBoundingClientRect();
      var left = r.left + window.scrollX, top = r.top + window.scrollY - tip.offsetHeight - 9;
      if (top < window.scrollY + 4) top = r.bottom + window.scrollY + 9;
      left = Math.max(8, Math.min(left, document.documentElement.clientWidth - tip.offsetWidth - 8));
      tip.style.left = left + "px"; tip.style.top = top + "px";
    }
    document.addEventListener("mouseover", function (e) { var t = e.target.closest("[data-tip]"); if (t) show(t); });
    document.addEventListener("mouseout", function (e) {
      var from = e.target.closest("[data-tip]"); if (!from) return;
      var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest("[data-tip]") : null;
      if (to !== from && pinned !== from) tip.classList.remove("on");
    });
    document.addEventListener("focusin", function (e) { var t = e.target.closest("[data-tip]"); if (t) show(t); });
    document.addEventListener("focusout", function (e) {
      if (pinned !== e.target.closest("[data-tip]")) tip.classList.remove("on");
    });
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tip]");
      if (!t) { pinned = null; tip.classList.remove("on"); return; }
      if (pinned === t) {
        pinned = null;
        tip.classList.remove("on");
      } else {
        pinned = t;
        show(t);
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        pinned = null; tip.classList.remove("on");
        return;
      }
      var t = e.target.closest("[data-tip]");
      if (t && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        if (pinned === t) {
          pinned = null; tip.classList.remove("on");
        } else {
          pinned = t; show(t);
        }
      }
    });
  }());

  /* ── 8 · liveness ──────────────────────────────────────────────────── */
  function start() {
    timers.forEach(clearInterval); timers = [];
    var cd = el("cd");
    function tick() {
      var now = new Date(), nx = new Date(now); nx.setHours(now.getHours() + 1, 0, 5, 0);
      var s = Math.max(0, Math.floor((nx - now) / 1000));
      cd.textContent = reduced ? "NEXT " + two(nx.getHours()) + ":00"
        : "NEXT T−" + two(Math.floor(s / 60)) + ":" + two(s % 60);
    }
    if (D.ageMinutes > STALE_MINUTES) {
      cd.textContent = "NEXT —";
      timers.push(setInterval(boot, 300000));
    } else {
      tick();
      timers.push(setTimeout(boot, READ.msUntilNextHourlyRefresh(Date.now())));
      if (!reduced) timers.push(setInterval(tick, 1000));
    }
    if (reduced) return;

    var ul = el("lu"), i = 0, n = ul.children.length - 1;
    timers.push(setInterval(function () {
      i++; ul.style.transition = "transform .5s cubic-bezier(.4,0,.2,1)";
      ul.style.transform = "translateY(-" + (i * 34) + "px)";
      if (i >= n) setTimeout(function () { ul.style.transition = "none"; ul.style.transform = "translateY(0)"; i = 0; }, 520);
    }, 4600));

  }

  document.addEventListener("DOMContentLoaded", boot);
}());

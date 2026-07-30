/* ANTESIGNA — deterministic ranking and table logic.
   This file is deliberately dependency-free so the same aggregate-only rules
   can be exercised in Node tests and in the browser. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ANTESIGNA_READ_LOGIC = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FLAT_LIMIT = 0.05;
  var MAJORS = ["BTC", "ETH", "HYPE", "SOL"];

  function regime(value) {
    if (value > FLAT_LIMIT) return "long";
    if (value < -FLAT_LIMIT) return "short";
    return "flat";
  }

  function money(value) {
    var amount = Math.abs(value);
    var digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
    var rendered = amount.toFixed(digits).replace(/\.0$/, "");
    return (value < 0 ? "−$" : "+$") + rendered + "M";
  }

  function assetNameList(rows, limit) {
    var names = rows.slice(0, limit).map(function (row) { return row.symbol; });
    if (names.length < 2) return names[0] || "";
    return names[0] + " + " + names[1];
  }

  function sumNet(rows, limit) {
    return rows.slice(0, limit).reduce(function (sum, row) {
      return sum + row.net;
    }, 0);
  }

  function rankedAssets(assets, direction, majorsOnly) {
    return assets.filter(function (row) {
      return (!majorsOnly || MAJORS.indexOf(row.symbol) !== -1) &&
        (direction === "long" ? row.net > 0 : row.net < 0);
    }).sort(function (a, b) {
      return Math.abs(b.net) - Math.abs(a.net);
    });
  }

  function flatShare(scores) {
    if (!scores.length) return 1;
    var flat = scores.filter(function (value) {
      return regime(value) === "flat";
    }).length;
    return flat / scores.length;
  }

  function percentile(scores, current) {
    if (!scores.length) return 0.5;
    return scores.filter(function (value) { return value <= current; }).length /
      scores.length;
  }

  function selectLeadStory(input) {
    var assets = input.assets || [];
    var movers = input.movers || [];
    var scores = input.historyScores || [];
    var currentRegime = regime(input.signum);
    var priorRegime = regime(input.signum24h);
    var majorLongs = rankedAssets(assets, "long", true);
    var majorShorts = rankedAssets(assets, "short", true);
    var allLongs = rankedAssets(assets, "long", false);
    var allShorts = rankedAssets(assets, "short", false);
    var candidates = [];
    var flatPct = flatShare(scores);

    var majorFlips = movers.filter(function (row) {
      return MAJORS.indexOf(row.symbol) !== -1 &&
        ((row.previous < 0 && row.current >= 0) ||
         (row.previous > 0 && row.current <= 0));
    }).sort(function (a, b) {
      return Math.abs(b.current - b.previous) -
        Math.abs(a.current - a.previous);
    });

    function add(score, priority, key, headline, detail) {
      candidates.push({
        score: score,
        priority: priority,
        key: key,
        headline: headline,
        detail: detail
      });
    }

    /* A rare flat aggregate with large opposing major positions is the most
       informative state: the top-line calm is hiding an active split below. */
    if (currentRegime === "flat" && majorLongs.length && majorShorts.length) {
      var leadLong = majorLongs[0];
      var opposingShorts = majorShorts.slice(0, 2);
      var shortNames = assetNameList(opposingShorts, 2);
      var shortNet = sumNet(opposingShorts, 2);
      var rarityPoints = Math.max(0, Math.min(7, (0.25 - flatPct) * 28));
      var flip = majorFlips[0];
      if (flip) {
        add(
          100 + rarityPoints,
          100,
          "flat_major_flip",
          "SIGNUM FLAT. " + flip.symbol + " FLIPPED " +
            (flip.current >= 0 ? "LONG." : "SHORT."),
          flip.symbol + " moved from " + money(flip.previous) + " to " +
            money(flip.current) + " net over 24 hours. " + shortNames +
            " remain " + money(shortNet) + " combined; flat Signum readings " +
            "made up " + Math.round(flatPct * 100) +
            "% of the public window."
        );
      } else {
        add(
          92 + rarityPoints,
          90,
          "flat_major_split",
          "SIGNUM FLAT. " + leadLong.symbol + " LONG; " +
            shortNames + " SHORT.",
          leadLong.symbol + " is " + money(leadLong.net) + " net long while " +
            shortNames + " are " + money(shortNet) +
            " combined; flat Signum readings made up " +
            Math.round(flatPct * 100) + "% of the public window."
        );
      }
    }

    if (currentRegime !== priorRegime) {
      var transition = currentRegime === "flat"
        ? "SIGNUM TURNED FLAT IN 24 HOURS."
        : "SIGNUM TURNED NET " + currentRegime.toUpperCase() +
          " IN 24 HOURS.";
      add(
        96 + Math.min(4, Math.abs(input.signum - input.signum24h) * 25),
        95,
        "signum_transition",
        transition,
        "Signum moved from " + input.signum24h.toFixed(3) + " to " +
          input.signum.toFixed(3) + "; the aggregate regime changed from " +
          priorRegime + " to " + currentRegime + "."
      );
    }

    if (majorFlips.length) {
      var topFlip = majorFlips[0];
      add(
        93 + Math.min(5, Math.abs(topFlip.current - topFlip.previous) / 20),
        92,
        "major_asset_flip",
        topFlip.symbol + " FLIPPED NET " +
          (topFlip.current >= 0 ? "LONG." : "SHORT."),
        topFlip.symbol + " moved from " + money(topFlip.previous) + " to " +
          money(topFlip.current) + " net over 24 hours."
      );
    }

    var pct = percentile(scores, input.signum);
    if (pct >= 0.90 || pct <= 0.10) {
      add(
        84 + Math.abs(pct - 0.5) * 12,
        80,
        "signum_extreme",
        pct >= 0.90 ? "SIGNUM NEAR A 90-DAY HIGH." :
          "SIGNUM NEAR A 90-DAY LOW.",
        "The current " + input.signum.toFixed(3) + " reading is more " +
          (pct >= 0.90 ? "long" : "short") + " than " +
          Math.round(Math.abs(pct >= 0.90 ? pct : 1 - pct) * 100) +
          "% of the public window."
      );
    }

    if (Math.abs(input.signum - input.signum24h) >= 0.035) {
      add(
        80 + Math.min(6, Math.abs(input.signum - input.signum24h) * 40),
        75,
        "signum_move",
        "SIGNUM MOVED " +
          (input.signum > input.signum24h ? "TOWARD LONG." : "TOWARD SHORT."),
        "Signum moved from " + input.signum24h.toFixed(3) + " to " +
          input.signum.toFixed(3) + " over 24 hours."
      );
    }

    if (
      (input.net < 0 && input.longMarkets > input.shortMarkets) ||
      (input.net > 0 && input.shortMarkets > input.longMarkets)
    ) {
      add(
        74,
        70,
        "breadth_divergence",
        input.net < 0
          ? "NET SHORT, BUT MOST MARKETS ARE LONG."
          : "NET LONG, BUT MOST MARKETS ARE SHORT.",
        (input.net < 0 ? input.longMarkets : input.shortMarkets) + " of " +
          input.marketCount + " markets lean against the aggregate dollar net."
      );
    }

    var side = input.net < 0 ? allShorts : allLongs;
    if (
      side.length > 1 &&
      Math.abs(side[0].net + side[1].net) >= Math.abs(input.net)
    ) {
      add(
        64,
        60,
        "concentration",
        side[0].symbol + " + " + side[1].symbol + " CARRY THE NET " +
          (input.net < 0 ? "SHORT." : "LONG."),
        "The two largest same-side positions total " +
          money(side[0].net + side[1].net) + " net."
      );
    }

    add(
      10,
      0,
      "current_state",
      "THE HUNDRED ARE NET " + (input.net < 0 ? "SHORT " : "LONG ") +
        money(Math.abs(input.net)).replace("+", "") + ".",
      "Signum is " + input.signum.toFixed(3) + " across " +
        input.marketCount + " published markets."
    );

    candidates.sort(function (a, b) {
      return b.score - a.score || b.priority - a.priority ||
        a.key.localeCompare(b.key);
    });
    return candidates[0];
  }

  function sortBoard(rows, key, direction) {
    return rows.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      /* A derived public scale or a 24-hour comparison can be unavailable.
         Keep missing values at the bottom in either sort direction. */
      if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (key === 0) return direction * String(x).localeCompare(String(y));
      return direction * (x - y);
    });
  }

  /* Gross is not added to the public data contract. It is a coarse client-side
     display scale derived from already-public net and tilt, and is withheld
     when a near-zero tilt would make the estimate unstable. */
  function grossScale(netMillions, tilt) {
    if (!isFinite(netMillions) || !isFinite(tilt) || Math.abs(tilt) < 0.015) return null;
    return Math.round((Math.abs(netMillions) / Math.abs(tilt)) / 5) * 5;
  }

  return {
    FLAT_LIMIT: FLAT_LIMIT,
    regime: regime,
    selectLeadStory: selectLeadStory,
    sortBoard: sortBoard,
    grossScale: grossScale
  };
}));

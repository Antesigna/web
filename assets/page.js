(function () {
  "use strict";

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char];
    });
  }

  function money(value) {
    var n = Number(value), sign = n < 0 ? "−" : n > 0 ? "+" : "";
    return sign + "$" + (Math.abs(n) / 1e6).toFixed(1) + "M";
  }

  function dateTime(value) {
    return new Date(value).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    });
  }

  function loadMethod() {
    var status = document.getElementById("cohortStatus");
    if (!status) return;
    fetch("/data/cohort_change_latest.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("status unavailable");
        return response.json();
      })
      .then(function (record) {
        document.getElementById("cohortDate").textContent = record.effective_date;
        document.getElementById("cohortSize").textContent = record.cohort_size;
        status.innerHTML = '<i></i> Latest refresh ' + esc(record.status);
      })
      .catch(function () {
        status.textContent = "Public tracker status temporarily unavailable";
      });
  }

  function snapshotRow(row) {
    return "<tr><td>" + esc(dateTime(row.observed_at)) +
      '<br><span class="badge ' + (row.backfilled ? "" : "live") + '">' +
      (row.backfilled ? "Recorded history" : "Live ledger") + "</span></td>" +
      '<td class="' + (row.heat_score < 0 ? "dn" : row.heat_score > 0 ? "up" : "mut") + '">' +
      (row.heat_score > 0 ? "+" : "") + Number(row.heat_score).toFixed(4) + "</td>" +
      "<td>" + esc(row.regime) + "</td><td>" + money(row.net_usd) + "</td>" +
      "<td>" + Math.round(Number(row.short_share) * 100) + "%</td>" +
      "<td>" + money(row.btc_net_usd) + "</td><td>" + money(row.eth_net_usd) + "</td>" +
      "<td>" + money(row.sol_net_usd) + "</td><td>" + money(row.hype_net_usd) + "</td></tr>";
  }

  function loadLedger() {
    var table = document.getElementById("snapshotRows");
    if (!table) return;
    fetch("/data/proof_ledger.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("ledger unavailable");
        return response.json();
      })
      .then(function (ledger) {
        var snapshots = ledger.snapshots || [];
        document.getElementById("ledgerGenerated").textContent = dateTime(ledger.generated_at);
        document.getElementById("snapshotCount").textContent = snapshots.length;
        table.innerHTML = snapshots.slice(0, 100).map(snapshotRow).join("");
      })
      .catch(function (error) {
        table.innerHTML = '<tr><td colspan="9">Could not load the public Ledger: ' + esc(error.message) + "</td></tr>";
      });
  }

  function loadWelcome() {
    var button = document.getElementById("activateWatch");
    if (!button) return;
    var cfg = window.ANTESIGNA_CONFIG || {};
    var status = document.getElementById("activationStatus");
    var publicLink = document.getElementById("publicTelegram");
    if (cfg.telegramPublic) publicLink.href = cfg.telegramPublic;
    var sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
    var match = sessionId.match(/^cs_(live|test)_([A-Za-z0-9]+)$/);
    if (!match || !cfg.telegramBot) {
      status.textContent = "The secure activation reference is missing. Use the support fallback above.";
      return;
    }
    var payload = (match[1] === "live" ? "l" : "t") + "_" + match[2];
    if (payload.length > 64) {
      status.textContent = "This checkout reference needs manual activation. Use the support fallback above.";
      return;
    }
    button.href = cfg.telegramBot + "?start=" + encodeURIComponent(payload);
    button.hidden = false;
    status.textContent = "Use the same Telegram username you entered during checkout.";
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadMethod();
    loadLedger();
    loadWelcome();
  });
}());

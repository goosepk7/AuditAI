/*
 * AuditAI analyzer: turns bank / card statement text into transactions, then
 * finds recurring charges, subscriptions, negotiable bills, and fees.
 *
 * Runs entirely in the browser (and in Node for tests). Nothing is uploaded.
 */
(function (root) {
  "use strict";

  var Merchants =
    typeof module !== "undefined" && module.exports ? require("./merchants.js") : root.AuditMerchants;

  var DAY_MS = 86400000;
  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11 };

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  function detectDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 10).join("\n");
    var best = ",", bestCount = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var c = sample.split(d).length;
      if (c > bestCount) { best = d; bestCount = c; }
    });
    return best;
  }

  /** RFC-4180-ish CSV parser. Handles quotes, escaped quotes, and CRLF. */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    var delim = detectDelimiter(text);
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(function (f) { return f.trim() !== ""; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (f) { return f.trim() !== ""; })) rows.push(row);
    return rows.map(function (r) { return r.map(function (f) { return f.trim(); }); });
  }

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------

  /** Parses "$1,234.56", "(12.00)", "-5", "12.00-", "12.00 CR". Returns NaN if not money. */
  function parseAmount(str) {
    if (str == null) return NaN;
    var s = String(str).trim().toUpperCase();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\bCR$/.test(s)) { neg = true; s = s.replace(/\s*CR$/, ""); }
    s = s.replace(/\s*DR$/, "");
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (/^\+/.test(s)) s = s.slice(1);
    s = s.replace(/[$€£\s]/g, "").replace(/^USD/, "");
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/.test(s)) return NaN;
    var n = parseFloat(s.replace(/,/g, ""));
    return neg ? -n : n;
  }

  function utcDay(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m, d));
    if (dt.getUTCMonth() !== m) return null;
    return dt;
  }

  /**
   * Parses common statement date formats. `fallbackYear` is used for dates
   * without a year ("01/15", "Jan 15").
   */
  function parseDate(str, fallbackYear) {
    if (!str) return null;
    var s = String(str).trim().toUpperCase().replace(/\s+/g, " ");
    var m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return utcDay(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/))) {
      var a = +m[1], b = +m[2];
      // US month/day unless the first number cannot be a month.
      if (a > 12 && b <= 12) return utcDay(+m[3], b - 1, a);
      return utcDay(+m[3], a - 1, b);
    }
    if ((m = s.match(/^([A-Z]{3,4})[A-Z]*\.? (\d{1,2})(?:ST|ND|RD|TH)?,? (\d{4})/)) && m[1] in MONTHS)
      return utcDay(+m[3], MONTHS[m[1]], +m[2]);
    if ((m = s.match(/^(\d{1,2}) ([A-Z]{3,4})[A-Z]*\.?,? (\d{2,4})/)) && m[2] in MONTHS)
      return utcDay(+m[3], MONTHS[m[2]], +m[1]);
    if ((m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})/)) && m[2] in MONTHS)
      return utcDay(+m[3], MONTHS[m[2]], +m[1]);
    if (fallbackYear) {
      if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})$/))) return utcDay(fallbackYear, +m[1] - 1, +m[2]);
      if ((m = s.match(/^([A-Z]{3,4})[A-Z]*\.? (\d{1,2})$/)) && m[1] in MONTHS)
        return utcDay(fallbackYear, MONTHS[m[1]], +m[2]);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Statement → transactions
  // ---------------------------------------------------------------------------

  var INCOME_HINT = /PAYROLL|DIRECT DEP|DIR DEP|DEPOSIT|PAYMENT THANK|THANK YOU|REFUND|\bRETURN\b|INTEREST PAID|INTEREST EARNED|CASHBACK|CASH BACK REWARD|SALARY|AUTOPAY PAYMENT|PAYMENT RECEIVED|MOBILE PAYMENT/;

  function findColumns(header) {
    var cols = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1, type: -1 };
    var h = header.map(function (x) { return String(x).toLowerCase().trim(); });
    function pick(tests, avoid) {
      for (var t = 0; t < tests.length; t++)
        for (var i = 0; i < h.length; i++)
          if (tests[t].test(h[i]) && (avoid || []).indexOf(i) === -1) return i;
      return -1;
    }
    cols.date = pick([/^(transaction|trans\.?) ?date$/, /^date$/, /^posted ?date$|^posting ?date$|^post ?date$/, /date/]);
    cols.desc = pick([/^description$/, /description/, /^payee$|payee/, /^merchant|merchant/, /^name$/, /^transaction$|^details$/, /memo|narrative|reference/], [cols.date]);
    cols.debit = pick([/^debit$|^debit amount$|debits?\b/, /withdrawal|money out|paid out|^charges?$/]);
    cols.credit = pick([/^credit$|^credit amount$|credits?\b/, /deposit|money in|paid in|^payments?$/], [cols.debit]);
    cols.amount = pick([/^amount$/, /^(transaction )?amount|amount$|^amt$/], [cols.debit, cols.credit]);
    cols.type = pick([/^type$|transaction type|^details$|^dr\/cr$|^debit\/credit$/], [cols.desc, cols.date]);
    return cols;
  }

  function looksLikeHeader(row) {
    var joined = row.join(" ").toLowerCase();
    return /date/.test(joined) && /(amount|debit|credit|withdrawal|deposit)/.test(joined);
  }

  /** Infers columns from content when the file has no header row (e.g. Wells Fargo). */
  function inferColumns(rows) {
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var sample = rows.slice(0, 50);
    var cols = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1, type: -1 };
    var bestText = -1;
    for (var c = 0; c < width; c++) {
      var dates = 0, nums = 0, textLen = 0;
      sample.forEach(function (r) {
        var v = r[c] || "";
        if (parseDate(v)) dates++;
        else if (!isNaN(parseAmount(v))) nums++;
        else textLen += v.length;
      });
      if (cols.date === -1 && dates > sample.length * 0.7) cols.date = c;
      else if (cols.amount === -1 && nums > sample.length * 0.7 && /\./.test(sample.map(function (r) { return r[c]; }).join(""))) cols.amount = c;
      else if (textLen > bestText) { bestText = textLen; cols.desc = c; }
    }
    return cols;
  }

  /**
   * Converts CSV text into transactions. Positive `amount` means money left
   * the account (a charge); negative means money came in.
   */
  function parseStatementCSV(text, sourceName) {
    var rows = parseCSV(text);
    var warnings = [];
    if (!rows.length) return { transactions: [], warnings: ["The file is empty."] };

    var headerIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 20); i++) if (looksLikeHeader(rows[i])) { headerIdx = i; break; }
    var cols, data;
    if (headerIdx >= 0) {
      cols = findColumns(rows[headerIdx]);
      data = rows.slice(headerIdx + 1);
    } else {
      data = rows;
      cols = inferColumns(rows);
    }
    if (cols.date === -1 || (cols.amount === -1 && cols.debit === -1 && cols.credit === -1)) {
      return { transactions: [], warnings: ["Couldn't find date and amount columns. Try exporting the statement as CSV from your bank's website."] };
    }

    var raw = [];
    data.forEach(function (r) {
      var date = parseDate(r[cols.date]);
      if (!date) return;
      var desc = cols.desc >= 0 ? r[cols.desc] || "" : "";
      var amt;
      if (cols.debit >= 0 || cols.credit >= 0) {
        var d = cols.debit >= 0 ? parseAmount(r[cols.debit]) : NaN;
        var c = cols.credit >= 0 ? parseAmount(r[cols.credit]) : NaN;
        if (!isNaN(d) && d !== 0) amt = Math.abs(d);
        else if (!isNaN(c) && c !== 0) amt = -Math.abs(c);
        else if (cols.amount >= 0) amt = parseAmount(r[cols.amount]);
        else return;
        raw.push({ date: date, description: desc, amount: amt, signed: false, type: "" });
      } else {
        amt = parseAmount(r[cols.amount]);
        if (isNaN(amt)) return;
        raw.push({ date: date, description: desc, amount: amt, signed: true, type: cols.type >= 0 ? String(r[cols.type] || "").toUpperCase() : "" });
      }
    });

    // Single amount column: work out which sign means "charge".
    var signed = raw.filter(function (t) { return t.signed; });
    if (signed.length) {
      var flip = decideSpendSign(signed) > 0 ? 1 : -1; // +1: positives are charges
      signed.forEach(function (t) {
        if (/^(DEBIT|DR|SALE|PURCHASE|WITHDRAWAL|FEE)/.test(t.type)) t.amount = Math.abs(t.amount);
        else if (/^(CREDIT|CR|PAYMENT|DEPOSIT|RETURN|REFUND)/.test(t.type)) t.amount = -Math.abs(t.amount);
        else t.amount = t.amount * flip;
      });
    }

    var txns = raw
      .filter(function (t) { return t.amount !== 0 && !isNaN(t.amount); })
      .map(function (t) {
        return { date: t.date, description: t.description.replace(/\s+/g, " ").trim(), amount: round2(t.amount), source: sourceName || "" };
      });
    if (!txns.length) warnings.push("No transactions found in this file.");
    return { transactions: txns, warnings: warnings };
  }

  /** Returns +1 if positive numbers are charges in this file, -1 if negative numbers are. */
  function decideSpendSign(rows) {
    var incomePos = 0, incomeNeg = 0, pos = 0, neg = 0;
    rows.forEach(function (t) {
      if (t.amount > 0) pos++; else if (t.amount < 0) neg++;
      if (INCOME_HINT.test(String(t.description).toUpperCase())) {
        if (t.amount > 0) incomePos++; else incomeNeg++;
      }
    });
    if (incomePos + incomeNeg >= 1 && incomePos !== incomeNeg) return incomePos > incomeNeg ? -1 : 1;
    return neg > pos ? -1 : 1;
  }

  /**
   * Converts the text lines of a PDF statement into transactions. Lines look
   * like "01/15 NETFLIX.COM 866-579-7172 CA 15.49". Heuristic by nature.
   */
  function parseStatementLines(lines, sourceName) {
    var all = lines.join("\n");
    var yearMatch = all.match(/\b(20\d{2})\b/g) || [];
    var counts = {};
    yearMatch.forEach(function (y) { counts[y] = (counts[y] || 0) + 1; });
    var years = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    var endYear = years.length ? years[years.length - 1] : new Date().getUTCFullYear();
    if (endYear > new Date().getUTCFullYear() + 1) endYear = new Date().getUTCFullYear();

    var wrapsYear = hasMonth(lines, /^\s*(0?1[\/-]\d{1,2}\b|Jan\b)/) && hasMonth(lines, /^\s*(12[\/-]\d{1,2}\b|Dec\b)/);
    var dateRe = /^\s*((?:\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)|(?:[A-Z][a-z]{2}\.? \d{1,2}(?:, \d{4})?))\s+/;
    var amountRe = /(-?\(?\$?-?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?(?:\s?CR)?)\s*$/i;
    var txns = [];
    lines.forEach(function (line) {
      var dm = line.match(dateRe);
      if (!dm) return;
      var rest = line.slice(dm[0].length);
      // Some statements print a second (posting) date right after the first.
      var dm2 = rest.match(dateRe);
      if (dm2) rest = rest.slice(dm2[0].length);
      // Some statements end lines with a running balance: take the first of two trailing amounts.
      var am = rest.match(amountRe);
      if (!am) return;
      var before = rest.slice(0, am.index).trim();
      var am2 = before.match(amountRe);
      var amountText = am[1];
      if (am2) { amountText = am2[1]; before = before.slice(0, am2.index).trim(); }
      var date = parseDate(dm[1], endYear);
      if (!date) return;
      // A January statement can include December charges from the prior year.
      if (!/\d{4}/.test(dm[1]) && wrapsYear && date.getUTCMonth() >= 9)
        date = utcDay(endYear - 1, date.getUTCMonth(), date.getUTCDate());
      var amt = parseAmount(amountText);
      if (isNaN(amt) || !before || /^(total|balance|beginning|ending|previous|new balance)/i.test(before)) return;
      var desc = before.replace(/\s+/g, " ");
      if (amt > 0 && INCOME_HINT.test(desc.toUpperCase())) amt = -amt;
      txns.push({ date: date, description: desc, amount: round2(amt), source: sourceName || "" });
    });
    return {
      transactions: txns,
      warnings: txns.length ? [] : ["Couldn't read transactions from this PDF. If it's a scanned image, download the CSV version from your bank instead."]
    };
  }

  function hasMonth(lines, re) {
    return lines.some(function (l) { return re.test(l); });
  }

  // ---------------------------------------------------------------------------
  // Merchant names
  // ---------------------------------------------------------------------------

  var PREFIXES = [
    /^(POS|DEBIT|CREDIT|ACH|CHECKCARD|CHECK CARD|VISA|MC|DBT|PURCHASE|PMT|PAYMENT|RECURRING|RECUR|ONLINE|WEB|ELECTRONIC|PREAUTHORIZED|PRE-AUTH|AUTH|CARD|SALE|BILL ?PAY|BILLPAY|DIRECT ?DEBIT)\b\s*/,
    /^(PURCHASE )?AUTHORIZED ON \d{1,2}\/\d{1,2}\s*/,
    /^(SQ|TST|SP|PP|DD|PY|IN|BT|PAYPAL|GOOGLE|AMZN MKTP US|PADDLE\.NET|FS|WPY|CKO|EB|IC|DNH|LS|ZTL) ?\*\s*/,
    /^\d{1,2}\/\d{1,2}\s*/
  ];

  function cleanDescription(desc) {
    var s = String(desc || "").toUpperCase();
    for (var pass = 0; pass < 4; pass++) PREFIXES.forEach(function (re) { s = s.replace(re, ""); });
    s = s
      .replace(/\b(PPD|CCD|WEB|TEL|ARC|POP|IAT) ID:?.*$/, " ") // ACH trailers
      .replace(/\b(PAYMENTS?|PAYMENT TO|PMT|BILL PAYMT|AUTO ?PAY|E-?PAY|ONLINE PMT)\b/g, " ")
      .replace(/\*[A-Z0-9]{4,}\b/g, " ") // order codes like AMAZON PRIME*2K3J1
      .replace(/\b(WWW\.)/g, "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g, " ") // phone numbers
      .replace(/#\s?\d+/g, " ")
      .replace(/\b[A-Z]*\d[A-Z0-9-]*\b/g, " ") // tokens with digits
      .replace(/[^A-Z&+.' ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    var tokens = s.split(" ");
    if (tokens.length > 2 && STATES.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens.join(" ");
  }
  var STATES = /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|US|USA)$/;

  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); })
      .replace(/\.Com\b/g, ".com");
  }

  function merchantInfo(desc) {
    var upper = String(desc || "").toUpperCase();
    var known = Merchants.lookupMerchant(upper);
    var cleaned = cleanDescription(desc);
    var key = cleaned.split(" ").slice(0, 3).join(" ").replace(/\.COM$/, "");
    if (known) return { key: "K:" + known.name, name: known.name, known: known };
    return { key: "U:" + (key || upper.slice(0, 20)), name: titleCase(key || upper.slice(0, 30)), known: null };
  }

  // ---------------------------------------------------------------------------
  // Recurrence
  // ---------------------------------------------------------------------------

  var CADENCES = [
    { id: "weekly", label: "Weekly", min: 6, max: 8, perYear: 52 },
    { id: "biweekly", label: "Every 2 weeks", min: 13, max: 16, perYear: 26 },
    { id: "monthly", label: "Monthly", min: 25, max: 35, perYear: 12 },
    { id: "bimonthly", label: "Every 2 months", min: 55, max: 66, perYear: 6 },
    { id: "quarterly", label: "Every 3 months", min: 84, max: 98, perYear: 4 },
    { id: "semiannual", label: "Every 6 months", min: 170, max: 196, perYear: 2 },
    { id: "annual", label: "Yearly", min: 350, max: 380, perYear: 1 }
  ];

  var NOT_RECURRING = /\b(TRANSFER|XFER|PAYMENT THANK|THANK YOU|AUTOPAY PAYMENT|CRD AUTOPAY|CREDIT CRD|CREDIT CARD PAYMENT|CARD PAYMENT|ATM WITHDRAWAL|CASH WITHDRAWAL|WITHDRAWAL AT|SAVINGS|TO SAV|FROM SAV|PAYROLL|DEPOSIT|INTEREST PAID)\b/;

  // Everyday spending that repeats but isn't a subscription or bill.
  var EVERYDAY = /\b(KROGER|WALMART|WAL-MART|WM SUPERCENTER|TARGET|COSTCO WHSE|SAFEWAY|PUBLIX|ALDI|HEB|H-E-B|WHOLE ?FOODS|TRADER JOE|MEIJER|ALBERTSONS|WEGMANS|FOOD LION|GIANT|SHELL|EXXON|MOBIL|CHEVRON|BP|SUNOCO|CITGO|VALERO|MARATHON|SPEEDWAY|WAWA|QT|QUIKTRIP|7-ELEVEN|CIRCLE K|STARBUCKS|DUNKIN|MCDONALD'?S?|CHICK-FIL-A|TACO BELL|WENDY'?S|BURGER KING|SUBWAY|CHIPOTLE|PANERA|DOMINO'?S|PIZZA|CVS|WALGREENS|RITE AID|DOLLAR GENERAL|DOLLAR TREE|HOME DEPOT|LOWE'?S|AMAZON MKTP|AMZN MKTP|AMAZON\.COM|UBER TRIP|UBER EATS|LYFT|DOORDASH(?! ?DASHPASS)|GRUBHUB(?! ?\+| ?PLUS)|RESTAURANT|CAFE|COFFEE|FUEL|GROCERY)\b/;

  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function dayNum(d) { return Math.round(d.getTime() / DAY_MS); }

  /** Splits one merchant's charges into clusters of similar amounts (separate plans). */
  function clusterByAmount(txns) {
    var sorted = txns.slice().sort(function (a, b) { return a.amount - b.amount; });
    var clusters = [];
    sorted.forEach(function (t) {
      var c = clusters[clusters.length - 1];
      if (c && (t.amount - c.min) <= Math.max(1, c.min * 0.25)) { c.items.push(t); }
      else clusters.push({ min: t.amount, items: [t] });
    });
    return clusters.map(function (c) { return c.items.sort(function (a, b) { return a.date - b.date; }); });
  }

  function detectCadence(dates) {
    if (dates.length < 2) return null;
    var gaps = [];
    for (var i = 1; i < dates.length; i++) gaps.push(dayNum(dates[i]) - dayNum(dates[i - 1]));
    var med = median(gaps);
    var cad = null;
    CADENCES.forEach(function (c) { if (med >= c.min && med <= c.max) cad = c; });
    if (!cad) return null;
    // Allow a skipped period (gap ≈ 2×) but most gaps must fit.
    var fits = gaps.filter(function (g) {
      return (g >= cad.min - 2 && g <= cad.max + 2) || (g >= 2 * cad.min - 2 && g <= 2 * cad.max + 2);
    }).length;
    if (fits / gaps.length < 0.65) return null;
    return cad;
  }

  /**
   * Main entry point. Takes transactions from any number of files and returns
   * the audit: recurring items, fees, insights, and totals.
   */
  function analyze(transactions) {
    var txns = dedupe(transactions);
    var charges = txns.filter(function (t) { return t.amount > 0; });
    if (!txns.length) return emptyResult();

    var first = txns.reduce(function (m, t) { return t.date < m ? t.date : m; }, txns[0].date);
    var last = txns.reduce(function (m, t) { return t.date > m ? t.date : m; }, txns[0].date);
    var spanDays = Math.max(1, dayNum(last) - dayNum(first) + 1);

    var groups = {};
    var fees = {};
    charges.forEach(function (t) {
      var info = merchantInfo(t.description);
      if (info.known && info.known.kind === "fee") {
        var f = fees[info.known.name] || (fees[info.known.name] = { name: info.known.name, items: [] });
        f.items.push(t);
        return;
      }
      var upper = t.description.toUpperCase();
      if (!info.known && (NOT_RECURRING.test(upper) || EVERYDAY.test(upper))) return;
      var g = groups[info.key] || (groups[info.key] = { info: info, items: [] });
      g.items.push(t);
    });

    var items = [];
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var clusters = clusterByAmount(g.items);
      clusters.forEach(function (cl, idx) {
        var item = evaluateCluster(g.info, cl, spanDays);
        if (item) {
          item.id = slug(key) + "-" + idx;
          items.push(item);
        }
      });
    });

    // Same service, different plans (e.g. two Apple subscriptions): add the price to the name.
    var nameCount = {};
    items.forEach(function (i) { nameCount[i.name] = (nameCount[i.name] || 0) + 1; });
    items.forEach(function (i) { if (nameCount[i.name] > 1) i.name += " (" + money(i.lastAmount) + ")"; });
    items.sort(function (a, b) { return b.perYear - a.perYear; });

    var feeItems = Object.keys(fees).map(function (name) {
      var f = fees[name];
      var total = round2(f.items.reduce(function (s, t) { return s + t.amount; }, 0));
      var sorted = f.items.slice().sort(function (a, b) { return a.date - b.date; });
      var cad = detectCadence(sorted.map(function (t) { return t.date; }));
      // A one-off fee isn't projected forward; repeated fees are annualized.
      var perYear = cad ? round2(sorted[sorted.length - 1].amount * cad.perYear)
        : f.items.length >= 2 ? round2(total * 365 / Math.max(spanDays, 28)) : total;
      return {
        id: "fee-" + slug(name),
        name: name,
        category: "Bank fees",
        kind: "fee",
        cadence: cad ? cad.label : f.items.length + " charge" + (f.items.length > 1 ? "s" : "") + " in these statements",
        cadenceId: cad ? cad.id : null,
        count: f.items.length,
        total: total,
        lastAmount: sorted[sorted.length - 1].amount,
        lastDate: sorted[sorted.length - 1].date,
        perYear: perYear,
        confidence: "high",
        occurrences: sorted,
        cancelUrl: null
      };
    }).sort(function (a, b) { return b.perYear - a.perYear; });

    var subs = items.filter(function (i) { return i.kind === "subscription"; });
    var bills = items.filter(function (i) { return i.kind === "bill"; });
    var other = items.filter(function (i) { return i.kind === "recurring"; });

    return {
      period: { start: first, end: last, days: spanDays },
      transactionCount: txns.length,
      subscriptions: subs,
      bills: bills,
      fees: feeItems,
      otherRecurring: other,
      insights: buildInsights(subs, bills, feeItems, spanDays),
      totals: {
        subscriptions: sumYear(subs),
        bills: sumYear(bills),
        fees: sumYear(feeItems),
        other: sumYear(other)
      }
    };
  }

  function evaluateCluster(info, cl, spanDays) {
    var known = info.known;
    var amounts = cl.map(function (t) { return t.amount; });
    var lastT = cl[cl.length - 1];
    var cad = detectCadence(cl.map(function (t) { return t.date; }));
    var spread = (Math.max.apply(null, amounts) - Math.min.apply(null, amounts)) / median(amounts);
    var confidence, cadence = cad, note = null;

    if (cad) {
      // Unknown merchants need steadier amounts so groceries/gas don't show up.
      if (!known && spread > (cad.perYear >= 26 ? 0.03 : 0.12)) return null;
      if (!known && cad.perYear >= 26 && cl.length < 4) return null;
      confidence = cl.length >= 3 ? "high" : "medium";
    } else if (known && cl.length === 1) {
      var annualGuess = lastT.amount >= 60 && known.kind === "subscription";
      cadence = annualGuess ? CADENCES[6] : CADENCES[2];
      confidence = "low";
      note = "Seen once in these statements, so we assumed it's " + (annualGuess ? "yearly" : "monthly") + ". Check your account to confirm.";
    } else if (known && cl.length >= 2 && known.kind !== "fee") {
      // Known service but irregular timing (e.g. statements with gaps): estimate from the span.
      var perYearEst = Math.max(1, Math.round((cl.length / Math.max(spanDays, 30)) * 365));
      cadence = nearestCadence(perYearEst);
      confidence = "medium";
      note = "Charged " + cl.length + " times at irregular intervals.";
    } else {
      return null;
    }

    var priceIncrease = null;
    if (cl.length >= 2) {
      var prev = cl[cl.length - 2].amount;
      // Only call it a price increase when the earlier charges were steady (not a variable utility bill).
      var earlier = amounts.slice(0, -1);
      var steady = (Math.max.apply(null, earlier) - Math.min.apply(null, earlier)) <= Math.max(0.05, prev * 0.01);
      if (steady && lastT.amount - prev >= 0.5 && lastT.amount / prev >= 1.01)
        priceIncrease = { from: prev, to: lastT.amount };
    }

    return {
      name: info.name,
      category: known ? known.category : "Other recurring",
      kind: known ? known.kind : guessKind(lastT.description),
      cadence: cadence.label,
      cadenceId: cadence.id,
      perYear: round2(lastT.amount * cadence.perYear),
      lastAmount: lastT.amount,
      lastDate: lastT.date,
      count: cl.length,
      confidence: confidence,
      priceIncrease: priceIncrease,
      note: note,
      cancelUrl: known ? known.cancelUrl : null,
      description: lastT.description,
      occurrences: cl
    };
  }

  /** Unknown recurring merchants: utilities and loans are bills; small app-like charges are subscriptions. */
  function guessKind(desc) {
    var u = desc.toUpperCase();
    if (/INSURANCE|INS\b|MUTUAL|WIRELESS|MOBILE|CABLE|INTERNET|BROADBAND|FIBER|TELECOM|COMMUNICATIONS/.test(u)) return "bill";
    if (/MEMBERSHIP|SUBSCRIPTION|SUBSCR|MONTHLY PLAN|PREMIUM|\.COM|APP\b|\bPLUS\b|\+/.test(u)) return "subscription";
    return "recurring";
  }

  function nearestCadence(perYear) {
    var best = CADENCES[2];
    CADENCES.forEach(function (c) { if (Math.abs(c.perYear - perYear) < Math.abs(best.perYear - perYear)) best = c; });
    return best;
  }

  var OVERLAP_CATEGORIES = /^(Streaming|Music & audio|Fitness|Dating|News & learning)$/;

  function buildInsights(subs, bills, fees, spanDays) {
    var out = [];
    var byCat = {};
    subs.forEach(function (s) { (byCat[s.category] = byCat[s.category] || []).push(s); });
    Object.keys(byCat).forEach(function (cat) {
      var list = byCat[cat];
      if (list.length >= 2 && OVERLAP_CATEGORIES.test(cat)) {
        var cost = sumYear(list);
        out.push({
          type: "overlap",
          text: "You pay for " + list.length + " " + cat.toLowerCase() + " services (" +
            list.map(function (s) { return s.name; }).join(", ") + ") costing " + money(cost) +
            " a year. Keeping one and rotating the others month to month is an easy cut."
        });
      }
    });
    subs.concat(bills).forEach(function (s) {
      if (s.priceIncrease)
        out.push({ type: "increase", text: s.name + " went up from " + money(s.priceIncrease.from) + " to " + money(s.priceIncrease.to) + ". Price hikes are a good moment to ask for a discount or cancel." });
    });
    var feeTotal = fees.reduce(function (s, f) { return s + f.total; }, 0);
    if (feeTotal > 0)
      out.push({ type: "fees", text: "You paid " + money(feeTotal) + " in bank or card fees in these statements. Banks refund a first-time fee most of the time when you simply ask." });
    var small = subs.filter(function (s) { return s.lastAmount < 10 && s.cadenceId === "monthly"; });
    if (small.length >= 3)
      out.push({ type: "small", text: small.length + " small monthly charges under $10 add up to " + money(sumYear(small)) + " a year. These are the easiest to forget." });
    if (spanDays < 50)
      out.push({ type: "short", text: "These statements cover only " + spanDays + " days. Add another month or two so monthly charges can be confirmed." });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function dedupe(txns) {
    var seen = {};
    return txns.filter(function (t) {
      var k = dayNum(t.date) + "|" + t.amount + "|" + t.description.toUpperCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).sort(function (a, b) { return a.date - b.date; });
  }

  function sumYear(list) { return round2(list.reduce(function (s, i) { return s + i.perYear; }, 0)); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function money(n) {
    var neg = n < 0; n = Math.abs(n);
    var s = n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2);
    return (neg ? "-$" : "$") + s;
  }

  function emptyResult() {
    return { period: null, transactionCount: 0, subscriptions: [], bills: [], fees: [], otherRecurring: [], insights: [], totals: { subscriptions: 0, bills: 0, fees: 0, other: 0 } };
  }

  var api = {
    parseCSV: parseCSV,
    parseAmount: parseAmount,
    parseDate: parseDate,
    parseStatementCSV: parseStatementCSV,
    parseStatementLines: parseStatementLines,
    cleanDescription: cleanDescription,
    merchantInfo: merchantInfo,
    detectCadence: detectCadence,
    analyze: analyze,
    money: money
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AuditAnalyzer = api;
})(typeof self !== "undefined" ? self : this);

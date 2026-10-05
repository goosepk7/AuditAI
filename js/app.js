/* AuditAI page logic: file intake, rendering, choices, and the action plan. */
(function () {
  "use strict";

  var A = window.AuditAnalyzer;
  var S = window.AuditScripts;
  var money = A.money;

  var state = { files: [], result: null, choices: {} };
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------------------
  // File intake
  // ---------------------------------------------------------------------------

  var drop = $("drop"), input = $("file");
  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  // Dropping a file anywhere else on the page shouldn't navigate away from it.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  $("sample").addEventListener("click", loadSamples);
  $("reset").addEventListener("click", function () {
    state = { files: [], result: null, choices: {} };
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    var jobs = files.map(function (f) {
      var entry = { name: f.name, status: "Reading…", transactions: [], warnings: [] };
      state.files.push(entry);
      renderFiles();
      var isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      var job = isPdf ? readPdf(f) : f.text().then(function (text) { return A.parseStatementCSV(text, f.name); });
      return job.then(function (res) {
        entry.transactions = res.transactions;
        entry.warnings = res.warnings;
        entry.status = res.transactions.length ? "ok" : "error";
      }).catch(function (err) {
        console.error(err);
        entry.status = "error";
        entry.warnings = [isPdf ? "Couldn't open this PDF. Try the CSV download from your bank instead." : "Couldn't read this file. Is it a CSV export?"];
      });
    });
    Promise.all(jobs).then(analyze);
  }

  function loadSamples() {
    var names = ["samples/sample-credit-card.csv", "samples/sample-checking.csv"];
    Promise.all(names.map(function (n) {
      return fetch(n).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    })).then(function (texts) {
      texts.forEach(function (t, i) {
        var res = A.parseStatementCSV(t, names[i].split("/")[1]);
        state.files.push({ name: names[i].split("/")[1] + " (sample)", status: "ok", transactions: res.transactions, warnings: res.warnings });
      });
      analyze();
    }).catch(function () {
      alert("The sample files couldn't be loaded. If you opened this page straight from your computer, use the hosted version instead, or upload your own statements.");
    });
  }

  // PDF text extraction with the bundled pdf.js, loaded only when a PDF is added.
  var pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "vendor/pdfjs/pdf.min.js";
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { pdfLib = null; reject(new Error("pdf.js failed to load")); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }

  function readPdf(file) {
    return Promise.all([loadPdfJs(), file.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: r[1] }).promise;
    }).then(function (pdf) {
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++) pages.push(pdf.getPage(p).then(function (page) { return page.getTextContent(); }));
      return Promise.all(pages);
    }).then(function (contents) {
      var lines = [];
      contents.forEach(function (c) { lines = lines.concat(textToLines(c.items)); });
      return A.parseStatementLines(lines, file.name);
    });
  }

  /** Groups positioned PDF text runs into visual lines, left to right. */
  function textToLines(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5], x = it.transform[4];
      var row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= 2.5) { row = rows[i]; break; }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, w: it.width || 0, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var out = "", end = null;
      r.parts.forEach(function (p) {
        if (end !== null && p.x - end > 1) out += " ";
        out += p.s;
        end = p.x + p.w;
      });
      return out.replace(/\s+/g, " ").trim();
    });
  }

  // ---------------------------------------------------------------------------
  // Analysis + rendering
  // ---------------------------------------------------------------------------

  function analyze() {
    var all = [];
    state.files.forEach(function (f) { all = all.concat(f.transactions); });
    state.result = all.length ? A.analyze(all) : null;
    render();
    if (state.result) $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function render() {
    renderFiles();
    var r = state.result;
    $("results").classList.toggle("hidden", !r);
    $("reset").classList.toggle("hidden", !state.files.length);
    $("intro").classList.toggle("hidden", !!r);
    if (!r) return;

    var groups = [
      ["g-subscriptions", r.subscriptions],
      ["g-bills", r.bills],
      ["g-fees", r.fees],
      ["g-other", r.otherRecurring]
    ];
    groups.forEach(function (g) {
      var sec = $(g[0]), list = sec.querySelector(".list");
      list.innerHTML = "";
      sec.classList.toggle("hidden", !g[1].length);
      g[1].forEach(function (item) { list.appendChild(renderItem(item)); });
    });
    var count = r.subscriptions.length + r.bills.length + r.fees.length + r.otherRecurring.length;
    $("none").classList.toggle("hidden", count > 0);
    $("s-count").textContent = count;
    $("s-total").textContent = money(r.totals.subscriptions + r.totals.bills + r.totals.fees);

    var fmt = function (d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
    $("period").textContent = "Based on " + r.transactionCount + " transactions from " + fmt(r.period.start) + " to " + fmt(r.period.end) +
      ". The yearly total covers subscriptions, bills, and fees (not rent or other payments).";

    var ins = $("insights");
    ins.innerHTML = "";
    r.insights.forEach(function (i) { var li = document.createElement("li"); li.textContent = i.text; ins.appendChild(li); });

    renderPlan();
  }

  function renderFiles() {
    var box = $("files");
    box.innerHTML = "";
    state.files.forEach(function (f) {
      var div = el("div", "file");
      div.appendChild(el("span", "", f.name));
      var msg;
      if (f.status === "ok") {
        msg = el("span", "muted", f.transactions.length + " transactions read");
      } else if (f.status === "error") {
        msg = el("span", "err", f.warnings[0] || "Couldn't read this file.");
      } else msg = el("span", "muted", f.status);
      div.appendChild(msg);
      box.appendChild(div);
    });
  }

  var ACTIONS = {
    subscription: [["cancel", "Cancel it"], ["keep", "Keep"]],
    bill: [["negotiate", "Negotiate"], ["cancel", "Cancel it"], ["keep", "Keep"]],
    fee: [["refund", "Get refund"], ["keep", "Ignore"]],
    recurring: [["cancel", "Cancel it"], ["negotiate", "Negotiate"], ["keep", "Keep"]]
  };

  function savingsFor(item, action) {
    if (action === "cancel" || action === "refund") return item.perYear;
    if (action === "negotiate") return Math.round(item.perYear * 0.2);
    return 0;
  }

  function renderItem(item) {
    var choice = state.choices[item.id];
    var card = el("div", "item" + (choice ? " chosen-" + choice : ""));

    var head = el("div", "item-head");
    var left = el("div");
    left.appendChild(el("div", "item-name", item.name));
    var meta = [item.category, item.cadence];
    if (item.kind !== "fee") meta.push("last charged " + item.lastDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
    left.appendChild(el("div", "item-meta", meta.join(" · ")));
    var badges = el("div", "badges");
    if (item.priceIncrease) badges.appendChild(el("span", "badge up", "Price went up " + money(item.priceIncrease.from) + " → " + money(item.priceIncrease.to)));
    if (item.confidence === "low") badges.appendChild(el("span", "badge low", "Double-check"));
    badges.appendChild(el("span", "badge", item.count + " charge" + (item.count > 1 ? "s" : "") + " found"));
    left.appendChild(badges);
    if (item.note) left.appendChild(el("div", "note", item.note));
    head.appendChild(left);

    var cost = el("div", "item-cost");
    cost.appendChild(el("div", "yr", money(item.perYear) + (item.kind === "fee" && !item.cadenceId && item.count < 2 ? "" : "/yr")));
    cost.appendChild(el("div", "per", item.kind === "fee" ? "paid " + money(item.total) + " so far" : money(item.lastAmount) + " " + item.cadence.toLowerCase()));
    head.appendChild(cost);
    card.appendChild(head);

    var choices = el("div", "choices");
    (ACTIONS[item.kind] || ACTIONS.recurring).forEach(function (a) {
      var b = el("button", "btn small choice", a[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(choice === a[0]));
      b.addEventListener("click", function () {
        state.choices[item.id] = choice === a[0] ? undefined : a[0];
        card.replaceWith(renderItem(item));
        renderPlan();
      });
      choices.appendChild(b);
    });
    var showTx = el("button", "btn small link", "See charges");
    showTx.type = "button";
    choices.appendChild(showTx);
    card.appendChild(choices);

    var occ = el("div", "occ hidden");
    var table = el("table");
    item.occurrences.slice().reverse().forEach(function (t) {
      var tr = el("tr");
      tr.appendChild(el("td", "", t.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })));
      tr.appendChild(el("td", "", t.description));
      tr.appendChild(el("td", "num", money(t.amount)));
      table.appendChild(tr);
    });
    occ.appendChild(table);
    card.appendChild(occ);
    showTx.addEventListener("click", function () {
      occ.classList.toggle("hidden");
      showTx.textContent = occ.classList.contains("hidden") ? "See charges" : "Hide charges";
    });

    if (choice && choice !== "keep") {
      var box = el("div", "script");
      var text = S.forItem(item, choice);
      box.appendChild(el("pre", "", text));
      var row = el("div", "row");
      var copy = el("button", "btn small primary", "Copy script");
      copy.type = "button";
      copy.addEventListener("click", function () {
        copyText(text).then(function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy script"; }, 1800); });
      });
      row.appendChild(copy);
      if (choice === "cancel" && item.cancelUrl) {
        var a = el("a", "btn small", "Open cancel page ↗");
        a.href = item.cancelUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
        row.appendChild(a);
      }
      box.appendChild(row);
      card.appendChild(box);
    }
    return card;
  }

  function chosenItems() {
    var r = state.result, out = [];
    if (!r) return out;
    r.subscriptions.concat(r.bills, r.fees, r.otherRecurring).forEach(function (item) {
      var c = state.choices[item.id];
      if (c && c !== "keep") out.push({ item: item, action: c, saves: savingsFor(item, c) });
    });
    return out;
  }

  var VERB = { cancel: "Cancel", negotiate: "Call to lower", refund: "Ask for a refund of the" };

  function renderPlan() {
    var chosen = chosenItems();
    var total = chosen.reduce(function (s, c) { return s + c.saves; }, 0);
    $("s-save").textContent = money(total);
    $("s-save-hint").textContent = chosen.length ? "from " + chosen.length + " action" + (chosen.length > 1 ? "s" : "") + " you picked" : "Pick cancel or negotiate below";
    var list = $("plan-list");
    list.innerHTML = "";
    chosen.forEach(function (c) {
      var li = el("li");
      li.textContent = VERB[c.action] + " " + c.item.name + ": saves about " + money(c.saves) + (c.action === "refund" && !c.item.cadenceId && c.item.count < 2 ? "" : " a year") +
        (c.action === "negotiate" ? " (estimate, assuming a 20% discount)" : "");
      list.appendChild(li);
    });
    $("plan-empty").classList.toggle("hidden", chosen.length > 0);
    $("plan-actions").classList.toggle("hidden", chosen.length === 0);
  }

  $("download-plan").addEventListener("click", function () {
    var chosen = chosenItems();
    var total = chosen.reduce(function (s, c) { return s + c.saves; }, 0);
    var parts = [
      "MY MONEY ACTION PLAN (made with AuditAI)",
      "Estimated savings: " + money(total) + " per year",
      "",
      "CHECKLIST"
    ];
    chosen.forEach(function (c, i) { parts.push("[ ] " + (i + 1) + ". " + VERB[c.action] + " " + c.item.name + " (about " + money(c.saves) + ")"); });
    chosen.forEach(function (c, i) {
      parts.push("", "==================================================", (i + 1) + ". " + c.item.name.toUpperCase(), "==================================================", S.forItem(c.item, c.action));
    });
    var blob = new Blob([parts.join("\n") + "\n"], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "money-action-plan.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $("print-plan").addEventListener("click", function () { window.print(); });

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    ta.remove();
    return Promise.resolve();
  }
})();

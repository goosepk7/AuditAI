"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const A = require("../js/analyzer.js");
const S = require("../js/scripts.js");

const sample = (name) => fs.readFileSync(path.join(__dirname, "..", "samples", name), "utf8");
const d = (s) => A.parseDate(s);

test("parseAmount handles bank formats", () => {
  assert.equal(A.parseAmount("$1,234.56"), 1234.56);
  assert.equal(A.parseAmount("(12.00)"), -12);
  assert.equal(A.parseAmount("-5"), -5);
  assert.equal(A.parseAmount("12.00-"), -12);
  assert.equal(A.parseAmount("12.00 CR"), -12);
  assert.equal(A.parseAmount("-$9.99"), -9.99);
  assert.ok(Number.isNaN(A.parseAmount("NETFLIX")));
  assert.ok(Number.isNaN(A.parseAmount("")));
});

test("parseDate handles common formats", () => {
  const iso = (x) => x && x.toISOString().slice(0, 10);
  assert.equal(iso(d("09/14/2026")), "2026-09-14");
  assert.equal(iso(d("9/4/26")), "2026-09-04");
  assert.equal(iso(d("2026-09-14")), "2026-09-14");
  assert.equal(iso(d("Sep 14, 2026")), "2026-09-14");
  assert.equal(iso(d("14 Sep 2026")), "2026-09-14");
  assert.equal(iso(d("25/09/2026")), "2026-09-25");
  assert.equal(iso(A.parseDate("01/15", 2026)), "2026-01-15");
  assert.equal(d("not a date"), null);
  assert.equal(d("02/30/2026"), null);
});

test("parseCSV handles quoted fields and CRLF", () => {
  const rows = A.parseCSV('a,b,c\r\n"x, y","he said ""hi""",3\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'he said "hi"', "3"]]);
});

test("credit card export with negative charges is normalized to positive charges", () => {
  const r = A.parseStatementCSV(sample("sample-credit-card.csv"), "cc");
  assert.ok(r.transactions.length > 40);
  const netflix = r.transactions.find((t) => /NETFLIX/.test(t.description));
  assert.ok(netflix.amount > 0, "charges should be positive");
  const payment = r.transactions.find((t) => /Payment Thank You/.test(t.description));
  assert.ok(payment.amount < 0, "payments should be negative");
});

test("debit/credit column layout", () => {
  const csv = "Date,Description,Debit,Credit\n" +
    "07/05/2026,SPOTIFY USA,11.99,\n08/05/2026,SPOTIFY USA,11.99,\n09/05/2026,SPOTIFY USA,11.99,\n09/06/2026,PAYROLL,,2000.00\n";
  const r = A.parseStatementCSV(csv, "x");
  assert.equal(r.transactions.length, 4);
  assert.equal(r.transactions.filter((t) => t.amount > 0).length, 3);
  const res = A.analyze(r.transactions);
  assert.equal(res.subscriptions.length, 1);
  assert.equal(res.subscriptions[0].name, "Spotify");
  assert.equal(res.subscriptions[0].perYear, 143.88);
});

test("headerless export (Wells Fargo style) is understood", () => {
  const csv = [
    '"07/03/2026","-15.49","*","","NETFLIX.COM 866-579-7172 CA"',
    '"08/03/2026","-15.49","*","","NETFLIX.COM 866-579-7172 CA"',
    '"09/03/2026","-15.49","*","","NETFLIX.COM 866-579-7172 CA"',
    '"09/15/2026","2400.00","*","","ACME PAYROLL"'
  ].join("\n");
  const r = A.parseStatementCSV(csv, "wf");
  assert.equal(r.transactions.length, 4);
  const res = A.analyze(r.transactions);
  assert.equal(res.subscriptions[0].name, "Netflix");
  assert.equal(res.subscriptions[0].lastAmount, 15.49);
});

test("sample statements: finds subscriptions, bills, fees and skips everyday spending", () => {
  const txns = A.parseStatementCSV(sample("sample-credit-card.csv"), "cc").transactions
    .concat(A.parseStatementCSV(sample("sample-checking.csv"), "ck").transactions);
  const res = A.analyze(txns);
  const names = (list) => list.map((i) => i.name);

  for (const n of ["Netflix", "Spotify", "Hulu", "Disney+", "Planet Fitness", "Google One", "DoorDash DashPass", "SiriusXM", "Amazon Prime"])
    assert.ok(names(res.subscriptions).includes(n), n + " should be found");
  assert.deepEqual(names(res.bills).sort(), ["GEICO", "Verizon", "Xfinity"]);
  assert.ok(names(res.fees).includes("Overdraft / NSF fee"));
  assert.ok(names(res.fees).includes("Monthly account fee"));

  const all = names(res.subscriptions.concat(res.bills, res.otherRecurring)).join("|");
  assert.doesNotMatch(all, /Kroger|Shell|Starbucks|Amazon Mktp|Chase|Payment Thank/i);

  const netflix = res.subscriptions.find((i) => i.name === "Netflix");
  assert.deepEqual(netflix.priceIncrease, { from: 15.49, to: 17.99 });
  assert.equal(netflix.perYear, 215.88);

  // Two Apple plans are kept apart and labelled by price.
  assert.equal(res.subscriptions.filter((i) => /^Apple/.test(i.name)).length, 2);

  // Variable utility bills aren't reported as price hikes.
  const energy = res.otherRecurring.find((i) => /Centerpoint/i.test(i.name));
  assert.ok(energy);
  assert.equal(energy.priceIncrease, null);

  assert.ok(res.insights.some((i) => i.type === "overlap" && /streaming/.test(i.text)));
});

test("duplicate rows from overlapping files are counted once", () => {
  const txns = A.parseStatementCSV(sample("sample-credit-card.csv"), "a").transactions;
  const once = A.analyze(txns);
  const twice = A.analyze(txns.concat(txns));
  assert.equal(twice.transactionCount, once.transactionCount);
});

test("PDF-style text lines are parsed", () => {
  const lines = [
    "ACCOUNT ACTIVITY Statement period 07/28/2026 - 09/27/2026",
    "08/03 NETFLIX.COM 866-579-7172 CA 15.49",
    "08/05 08/06 SPOTIFY USA 877-7781161 NY 11.99",
    "08/15 Payment Thank You - Web 450.00",
    "09/03 NETFLIX.COM 866-579-7172 CA 15.49",
    "09/05 09/06 SPOTIFY USA 877-7781161 NY 11.99",
    "Total fees charged in 2026 $0.00"
  ];
  const r = A.parseStatementLines(lines, "pdf");
  assert.equal(r.transactions.length, 5);
  assert.equal(r.transactions[0].date.getUTCFullYear(), 2026);
  assert.ok(r.transactions.find((t) => /Payment/.test(t.description)).amount < 0);
  const res = A.analyze(r.transactions);
  assert.deepEqual(res.subscriptions.map((s) => s.name).sort(), ["Netflix", "Spotify"]);
});

test("PDF lines spanning a new year put December in the prior year", () => {
  const r = A.parseStatementLines([
    "Statement closing date 01/10/2027",
    "12/14 NETFLIX.COM 15.49",
    "01/03 SPOTIFY USA 11.99"
  ], "pdf");
  assert.equal(r.transactions[0].date.toISOString().slice(0, 10), "2026-12-14");
  assert.equal(r.transactions[1].date.toISOString().slice(0, 10), "2027-01-03");
});

test("scripts mention the service and price", () => {
  const item = { name: "Netflix", lastAmount: 17.99, cadenceId: "monthly", cancelUrl: "https://www.netflix.com/cancelplan", category: "Streaming", lastDate: new Date(Date.UTC(2026, 8, 3)) };
  assert.match(S.cancel(item), /Netflix.*\$17\.99 a month/s);
  assert.match(S.cancel(item), /netflix\.com\/cancelplan/);
  assert.match(S.negotiate({ ...item, name: "Verizon", category: "Phone" }), /retention/);
  assert.match(S.refund({ name: "Overdraft / NSF fee", lastAmount: 34, lastDate: item.lastDate }), /\$34\.00.*Sep 3, 2026/s);
});

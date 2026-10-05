#!/usr/bin/env node
/*
 * Builds the static "how to cancel / lower / get refunded" guide pages under
 * guides/, plus sitemap.xml. These pages are what search engines index; each
 * one links back to the audit tool.
 *
 *   node tools/build-guides.js            write the pages
 *   node tools/build-guides.js --out DIR  write them somewhere else (used by tests)
 *
 * Re-run after changing js/merchants.js or this file, and commit the output.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MERCHANTS } = require("../js/merchants.js");

const SITE = "https://goosepk7.github.io/AuditAI/";
const UPDATED = "October 2026";

// Generic catch-all records that don't make sense as their own page.
const SKIP = new Set([
  "VPN", "Meal kit", "Subscription box", "Online courses", "Gym membership", "Dating app",
  "Fitness app", "Prime Video channel", "Mobile carrier", "Satellite TV", "Home security"
]);

const SLUGS = {
  "Apple (App Store / iCloud)": "apple-subscriptions",
  "Microsoft / Xbox": "xbox-microsoft",
  "AT&T": "att",
  "WW (Weight Watchers)": "weight-watchers",
  "Costco membership": "costco-membership",
  "Chewy Autoship": "chewy-autoship",
  "LinkedIn Premium": "linkedin-premium"
};

const APPLE_TIP = "On an iPhone or iPad: open Settings, tap your name, then Subscriptions. Pick the subscription and tap Cancel Subscription.";
const STORE_TIP = "If you signed up inside an iPhone or Android app, you're probably billed by Apple or Google, not by the company. Cancel it in your iPhone's Settings > [your name] > Subscriptions, or in the Google Play Store under Profile > Payments & subscriptions > Subscriptions.";

// Extra, merchant-specific notes. Keep these to things that are stable and
// widely documented; when unsure, the generic steps are the safer advice.
const TIPS = {
  "Apple (App Store / iCloud)": [APPLE_TIP, "A charge labeled APPLE.COM/BILL can be any app you subscribed to through Apple, so check the full list there."],
  "Apple TV+": [APPLE_TIP],
  "Apple Music": [APPLE_TIP],
  "Google Play": ["Open the Play Store app, tap your profile picture, then Payments & subscriptions > Subscriptions. Pick the subscription and tap Cancel subscription."],
  "Amazon Prime": ["Amazon may refund the current charge if you haven't used any Prime benefits since you were billed. The cancel page shows whether you qualify."],
  "Costco membership": ["Costco's satisfaction guarantee covers the membership fee, so ask the membership counter for a refund when you cancel."],
  "Audible": ["Unused credits disappear when the membership ends, so spend them before you cancel."],
  "Adobe": ["Many Adobe plans are annual plans paid monthly, and cancelling early can come with a fee. The plans page shows your plan type and any fee before you confirm."],
  "Planet Fitness": ["Many clubs only accept cancellations in person or by mailed letter. Call your home club and ask exactly how they want it done, then get a written confirmation."],
  "SiriusXM": ["SiriusXM is known for retention offers. If you'd rather keep it for less, ask for the promotional rate before you cancel."],
  "Peloton": ["The app membership and the All-Access membership for the bike or tread are separate. Check which one you're paying for."]
};

const CATEGORY_WORD = {
  "Streaming": "streaming service",
  "Music & audio": "subscription",
  "Apps & cloud": "subscription",
  "Gaming": "subscription",
  "Memberships": "membership",
  "News & learning": "subscription",
  "Fitness": "membership",
  "Dating": "subscription"
};

const COMPETITOR = {
  "Phone": "other carriers (Mint, Visible, or a prepaid plan) offer unlimited plans for $15 to $30 a line",
  "Internet & TV": "other internet providers in my area are offering new customers a lower price",
  "Insurance": "I've gotten quotes from other insurers for similar coverage at a lower price"
};

const FEE_PAGES = {
  "Overdraft / NSF fee": { slug: "overdraft-fee-refund", title: "How to Get an Overdraft Fee Refunded", short: "overdraft fee" },
  "Monthly account fee": { slug: "monthly-bank-fee-refund", title: "How to Get a Monthly Bank Fee Refunded", short: "monthly maintenance fee" },
  "ATM fee": { slug: "atm-fee-refund", title: "How to Get an ATM Fee Refunded", short: "ATM fee" },
  "Foreign transaction fee": { slug: "foreign-transaction-fee-refund", title: "How to Get a Foreign Transaction Fee Refunded", short: "foreign transaction fee" },
  "Late fee": { slug: "credit-card-late-fee-refund", title: "How to Get a Credit Card Late Fee Refunded", short: "late fee" },
  "Card annual fee": { slug: "credit-card-annual-fee-waived", title: "How to Get a Credit Card Annual Fee Waived", short: "annual fee" },
  "Interest charge": { slug: "credit-card-interest-refund", title: "How to Get Credit Card Interest Refunded", short: "interest charge" },
  "Bank service fee": { slug: "bank-fee-refund", title: "How to Get a Bank Fee Refunded", short: "fee" }
};

const PREVENT = {
  "Overdraft / NSF fee": "Turn on low-balance alerts, and ask the bank to decline transactions instead of charging overdraft fees (\"opt out of overdraft coverage\").",
  "Monthly account fee": "Ask what waives the monthly fee (a minimum balance or direct deposit), or switch to a free checking account. Many online banks and credit unions charge nothing.",
  "ATM fee": "Use your bank's ATM locator app, or get cash back at a grocery store checkout for free.",
  "Foreign transaction fee": "Use a card with no foreign transaction fees when traveling or buying from overseas sites.",
  "Late fee": "Turn on autopay for at least the minimum payment.",
  "Card annual fee": "Ask to switch (a \"product change\") to a no-annual-fee card from the same bank. This keeps your credit history.",
  "Interest charge": "Ask for a lower APR, and consider moving the balance to a 0% balance-transfer card.",
  "Bank service fee": "Ask the bank what account settings or account type would avoid this fee."
};

function slugify(s) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

/* ---------- page model ---------- */

function buildPages() {
  const pages = [];
  const seen = new Set();
  for (const m of MERCHANTS) {
    if (SKIP.has(m.name) || seen.has(m.name)) continue;
    seen.add(m.name);
    if (m.kind === "subscription") {
      pages.push({ type: "cancel", m, slug: "cancel-" + (SLUGS[m.name] || slugify(m.name)) });
    } else if (m.kind === "bill") {
      pages.push({ type: "lower", m, slug: "lower-" + (SLUGS[m.name] || slugify(m.name)) + "-bill" });
    } else if (m.kind === "fee" && FEE_PAGES[m.name]) {
      pages.push({ type: "fee", m, slug: FEE_PAGES[m.name].slug });
    }
  }
  for (const p of pages) Object.assign(p, describe(p));
  return pages;
}

function describe(p) {
  const n = p.m.name;
  if (p.type === "cancel") {
    return {
      title: "How to Cancel " + n + " (Step by Step + Script)",
      heading: "How to cancel " + n,
      description: "Cancel " + n + " in a few minutes: the direct cancel page, step-by-step instructions, and a word-for-word script if you have to call or chat.",
      linkText: "Cancel " + n
    };
  }
  if (p.type === "lower") {
    return {
      title: "How to Lower Your " + n + " Bill (Script That Works)",
      heading: "How to lower your " + n + " bill",
      description: "A word-for-word script for getting " + n + " to lower your bill, who to ask for, and what to say if they say no.",
      linkText: "Lower your " + n + " bill"
    };
  }
  const f = FEE_PAGES[n];
  return {
    title: f.title + " (Script)",
    heading: f.title,
    description: "Banks refund many fees when you ask. A short script for getting a " + f.short + " refunded, and how to stop it happening again.",
    linkText: f.title.replace(/^How to /, "")
  };
}

/* ---------- page bodies ---------- */

function cancelBody(p) {
  const m = p.m;
  const word = CATEGORY_WORD[m.category] || "subscription";
  const tips = TIPS[m.name] || [];
  const appStore = /Apple|Google Play/.test(m.name);
  let steps;
  if (m.cancelUrl) {
    steps = `
      <ol>
        <li>Sign in and go to the cancel page: <a href="${esc(m.cancelUrl)}" rel="nofollow noopener">${esc(hostOf(m.cancelUrl))}</a>.</li>
        <li>Look for <b>Cancel</b>, <b>Cancel membership</b> or <b>Manage plan</b>. You may need to click past one or two "are you sure?" offers.</li>
        <li>Finish until you see a confirmation screen or get a confirmation email. Save it.</li>
        <li>If the page tells you to call or chat instead, use the script below.</li>
      </ol>`;
  } else {
    steps = `
      <ol>
        <li>Sign in to your ${esc(m.name)} account on the website or app.</li>
        <li>Open <b>Account</b>, <b>Membership</b> or <b>Billing</b> and look for <b>Cancel</b>.</li>
        <li>If there's no cancel option online, call or use chat with the script below.</li>
        <li>Get a confirmation number or email before you hang up or close the chat.</li>
      </ol>`;
  }
  const tipList = (appStore ? tips : tips.concat([STORE_TIP]))
    .map((t) => `<li>${esc(t)}</li>`).join("");
  return `
    <p>Cancelling ${esc(m.name)} takes a few minutes. Here's the fastest way, plus a script to use if they make you call or chat. Your access usually continues until the end of the period you already paid for.</p>
    <h2>Steps</h2>${steps}
    <h2>Good to know</h2>
    <ul>${tipList}</ul>
    <h2>Phone or chat script</h2>
    <blockquote>
      <p>"Hi, I'd like to cancel my ${esc(m.name)} ${esc(word)}, effective today. Please don't transfer me to another offer; I've decided to cancel. Can you confirm the cancellation and send me a confirmation number or email?"</p>
      <p>If they offer a discount: "Thanks, but please go ahead and cancel." (Or, if the discount is worth it to you, ask them to put it in writing.)</p>
    </blockquote>
    <h2>After you cancel</h2>
    <ul>
      <li>Save the confirmation email or number.</li>
      <li>Check your next statement. If you're charged again, dispute it with your bank or card company and mention the confirmation.</li>
    </ul>`;
}

function lowerBody(p) {
  const m = p.m;
  const competitor = COMPETITOR[m.category] || "I've found lower prices from competitors";
  const insurance = m.category === "Insurance"
    ? `<h2>Insurance tip</h2>
    <p>Get two or three online quotes first (about 10 minutes each). Ask about raising your deductible, bundling home and auto, and low-mileage or safe-driver discounts.</p>`
    : "";
  return `
    <p>${esc(m.name)} and companies like it often cut prices for customers who ask, especially ones who mention leaving. A 15 minute call commonly saves 10 to 30 percent.</p>
    <h2>Who to call</h2>
    <p>Call the customer service number on your bill. When the phone menu asks why you're calling, say <b>"cancel service"</b>. That usually reaches the retention team, who are allowed to give discounts. Have your current monthly price ready.</p>
    <h2>Script</h2>
    <blockquote>
      <p>"Hi, I've been a customer for a while and I'm currently paying [your amount] a month. That's more than I want to spend, and ${esc(competitor)}. I'd like to stay, but I need my bill closer to [about 25% less]. What promotions or loyalty discounts can you apply to my account today?"</p>
    </blockquote>
    <h2>If they say no</h2>
    <ul>
      <li>"Is there a cheaper plan that still covers what I actually use?"</li>
      <li>"Can you check for any autopay, paperless, bundle, or loyalty discounts?"</li>
      <li>"Could you transfer me to the retention or loyalty department?"</li>
      <li>If nothing works: "Okay, I'll think about switching," and call back in a few days. A different rep often says yes.</li>
    </ul>
    ${insurance}
    <h2>Before you hang up</h2>
    <ul>
      <li>Ask for the new monthly price, how long it lasts, and whether there's a contract.</li>
      <li>Write down the rep's name and the date.</li>
    </ul>`;
}

function feeBody(p) {
  const f = FEE_PAGES[p.m.name];
  return `
    <p>Banks and card companies refund many fees on the first ask, especially if you rarely get them. It takes one short call or chat.</p>
    <h2>Who to contact</h2>
    <p>Call the number on the back of your card, or use your bank's chat in the app. Have the date and amount of the ${esc(f.short)} ready.</p>
    <h2>Script</h2>
    <blockquote>
      <p>"Hi, I noticed a ${esc(f.short)} of [amount] on my account on [date]. I've been a customer for a while and this isn't typical for me. Could you please refund it as a courtesy?"</p>
    </blockquote>
    <h2>If they say no</h2>
    <ul>
      <li>"I understand. Could you refund half of it?"</li>
      <li>"Is there anything on my account that would make me eligible, like setting up direct deposit or alerts?"</li>
    </ul>
    <h2>Stop it happening again</h2>
    <p>${esc(PREVENT[p.m.name])}</p>`;
}

/* ---------- templates ---------- */

const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230f7b5f'/><text x='16' y='22' font-size='17' font-family='Arial' font-weight='700' fill='white' text-anchor='middle'>$</text></svg>";

function layout({ title, description, canonical, root, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | AuditAI</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:type" content="article">
  <link rel="icon" href="${FAVICON}">
  <link rel="stylesheet" href="${root}css/styles.css">
</head>
<body>
  <div class="wrap">
    <header class="top">
      <a href="${root}" class="row" style="text-decoration:none;color:inherit"><div class="logo" aria-hidden="true">$</div><div class="brand">AuditAI</div></a>
    </header>
${body}
    <footer>
      AuditAI is a free tool that finds subscriptions, bills, and fees in your bank statements. It runs in your browser; your statements are never uploaded.
      These guides are general information and aren't affiliated with the companies named. Company menus and policies change, so check the details on their site.
    </footer>
  </div>
</body>
</html>
`;
}

function cta(root) {
  return `
      <div class="cta">
        <h2>What else are you paying for?</h2>
        <p>It's easy to forget a charge or two. Drop in your bank or card statements and AuditAI lists every subscription, bill, and fee, with a script for each. Free, no sign-up, and your statements never leave your device.</p>
        <a class="btn primary" href="${root}">Find my forgotten subscriptions</a>
      </div>`;
}

function guidePage(p, pages) {
  const root = "../../";
  const body = p.type === "cancel" ? cancelBody(p) : p.type === "lower" ? lowerBody(p) : feeBody(p);
  const related = pages
    .filter((o) => o !== p && o.type === p.type && (p.type === "fee" || o.m.category === p.m.category))
    .slice(0, 8)
    .map((o) => `<li><a href="../${o.slug}/">${esc(o.linkText)}</a></li>`).join("");
  return layout({
    title: p.title,
    description: p.description,
    canonical: SITE + "guides/" + p.slug + "/",
    root,
    body: `    <main class="guide">
      <p class="crumbs"><a href="${root}">AuditAI</a> › <a href="../">Guides</a></p>
      <h1>${esc(p.heading)}</h1>
      <p class="small muted">Updated ${UPDATED}</p>
${body}
${cta(root)}
${related ? `      <h2>Related guides</h2>\n      <ul>${related}</ul>` : ""}
    </main>`
  });
}

function indexPage(pages) {
  const root = "../";
  const section = (type, heading, intro) => {
    const items = pages.filter((p) => p.type === type)
      .map((p) => `<li><a href="${p.slug}/">${esc(p.linkText)}</a></li>`).join("");
    return `      <h2>${heading}</h2>\n      <p class="muted">${intro}</p>\n      <ul class="guide-list">${items}</ul>`;
  };
  return layout({
    title: "How to Cancel Subscriptions, Lower Bills, and Get Fees Refunded",
    description: "Free step-by-step guides and scripts for cancelling subscriptions, lowering phone, internet and insurance bills, and getting bank fees refunded.",
    canonical: SITE + "guides/",
    root,
    body: `    <main class="guide">
      <p class="crumbs"><a href="${root}">AuditAI</a> › Guides</p>
      <h1>Cancel, lower, and get refunded: free guides</h1>
      <p>Step-by-step instructions and word-for-word scripts. Updated ${UPDATED}.</p>
${cta(root)}
${section("cancel", "Cancel a subscription", "Direct cancel pages and a script for when they make you call.")}
${section("lower", "Lower a bill", "Phone, internet, and insurance companies often cut prices for customers who ask.")}
${section("fee", "Get a fee refunded", "Banks refund many fees on the first ask.")}
    </main>`
  });
}

function sitemap(pages) {
  const urls = [SITE, SITE + "guides/"].concat(pages.map((p) => SITE + "guides/" + p.slug + "/"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
}

/* ---------- write ---------- */

function build(outDir) {
  const pages = buildPages();
  const guidesDir = path.join(outDir, "guides");
  fs.rmSync(guidesDir, { recursive: true, force: true });
  for (const p of pages) {
    const dir = path.join(guidesDir, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), guidePage(p, pages));
  }
  fs.writeFileSync(path.join(guidesDir, "index.html"), indexPage(pages));
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(pages));
  return pages;
}

module.exports = { build, buildPages };

if (require.main === module) {
  const i = process.argv.indexOf("--out");
  const out = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, "..");
  const pages = build(out);
  console.log("Wrote " + pages.length + " guide pages, guides/index.html and sitemap.xml to " + out);
}

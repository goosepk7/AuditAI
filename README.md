# AuditAI

Find the subscriptions, bills, and fees quietly draining your bank account.

Upload 2–3 months of bank or credit card statements (CSV or PDF). AuditAI finds every
recurring charge, shows what it costs per year, flags price increases and overlapping
services, and gives you a ready-to-read script to **cancel** it, **negotiate** it down, or
get a fee **refunded**. Pick what you want to do and download a checklist with all the scripts.

**Private by design:** everything runs in your browser. Statements are never uploaded,
stored, or tracked. There is no server.

## Use it

Open the hosted site (see "Put it online" below), drop in your statements, and follow the
three steps on the page. No account or sign-up. A **Try sample data** button shows what a
result looks like.

## What it finds

- **Subscriptions** – streaming, music, apps, cloud storage, memberships, gyms, news, and
  more (dozens of popular services recognized by name), plus any other charge that repeats on a
  steady schedule at a steady price.
- **Bills you can lower** – phone, internet/TV, insurance, home security.
- **Fees** – overdraft/NSF, monthly account fees, ATM, foreign transaction, late fees,
  annual card fees, interest charges.
- **Insights** – overlapping services (e.g. three streaming apps), price hikes, small
  forgotten charges.

Everyday spending (groceries, gas, coffee, Amazon orders), transfers between your own
accounts, card payments, and paychecks are ignored.

## Supported files

- **CSV** exports from most US banks and card issuers (Chase, Bank of America, Wells Fargo,
  Capital One, Citi, Amex, Discover, credit unions…). Columns are detected automatically,
  including files with no header row, separate Debit/Credit columns, and either sign
  convention.
- **PDF** statements that contain real text (not scanned images). Uses a bundled copy of
  [pdf.js](https://mozilla.github.io/pdf.js/) that runs locally.

## Put it online (free, GitHub Pages)

1. Merge this code into the `main` branch.
2. In the repository on GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**, pick
   **`main`** and **`/ (root)`**, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

GitHub Pages is free for public repositories. For a private repository it needs a paid
GitHub plan. The code contains no secrets or personal data, so making the repository
public is safe.

## Run it locally

Any static file server works:

```sh
npm start            # serves on http://localhost:8000
```

## Tests

```sh
npm test
```

## Project layout

```
index.html          the page
css/styles.css      styles (light + dark mode)
js/analyzer.js      statement parsing and recurring-charge detection
js/merchants.js     known services, cancel links, fee patterns
js/scripts.js       cancel / negotiate / refund scripts
js/app.js           page logic
vendor/pdfjs/       pdf.js 3.11.174 (Apache-2.0)
samples/            made-up example statements
tests/              unit tests (node --test)
```

Estimates come from the charges in your files; double-check before acting. Not
financial advice.

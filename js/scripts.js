/*
 * Ready-to-use scripts for cancelling, negotiating, and getting fees refunded.
 */
(function (root) {
  "use strict";

  function money(n) { return "$" + Number(n).toFixed(2); }

  function cadenceWord(item) {
    return { weekly: "week", biweekly: "two weeks", monthly: "month", bimonthly: "two months", quarterly: "quarter", semiannual: "six months", annual: "year" }[item.cadenceId] || "month";
  }

  function cancel(item) {
    var per = cadenceWord(item);
    var where = item.cancelUrl
      ? "Fastest way: cancel online at " + item.cancelUrl + "\nIf that page asks you to call or chat, use the script below."
      : "Look for \"Cancel\", \"Membership\" or \"Billing\" in your account settings. If you can't find it, call or chat using the script below.";
    var apple = /Apple|App Store|iCloud/.test(item.name)
      ? "\n\nTip: charges from Apple are managed on your iPhone: Settings > [your name] > Subscriptions."
      : /Google Play/.test(item.name)
      ? "\n\nTip: Google Play subscriptions are managed in the Play Store app: Profile > Payments & subscriptions > Subscriptions."
      : "";
    return (
      "HOW TO CANCEL " + item.name.toUpperCase() + "\n" + where + apple + "\n\n" +
      "PHONE OR CHAT SCRIPT\n" +
      "\"Hi, I'd like to cancel my " + item.name + " subscription, effective today. " +
      "I'm being charged " + money(item.lastAmount) + " a " + per + ". " +
      "Please don't transfer me to another offer; I've decided to cancel. " +
      "Can you confirm the cancellation and send me a confirmation number or email?\"\n\n" +
      "If they offer a discount instead: \"Thanks, but please go ahead and cancel.\" " +
      "(Or, if the discount is worth it to you, ask them to put it in writing.)\n\n" +
      "AFTER YOU CANCEL\n" +
      "• Save the confirmation email or number.\n" +
      "• Check your next statement. If they charge you again, dispute it with your bank or card company and mention the confirmation."
    );
  }

  function negotiate(item) {
    var per = cadenceWord(item);
    var target = item.lastAmount * 0.75;
    var competitor = {
      "Phone": "other carriers (Mint, Visible, or a prepaid plan) offer unlimited plans for $15 to $30 a line",
      "Internet & TV": "other internet providers in my area are offering new customers a lower price",
      "Insurance": "I've gotten quotes from other insurers for similar coverage at a lower price",
      "Home services": "other monitoring companies charge less for the same service"
    }[item.category] || "I've found lower prices from competitors";
    return (
      "HOW TO LOWER YOUR " + item.name.toUpperCase() + " BILL\n" +
      "Call the customer service number on your bill. When the menu asks why you're calling, say \"cancel service\". " +
      "That usually reaches the retention team, who are allowed to give discounts.\n\n" +
      "SCRIPT\n" +
      "\"Hi, I've been a customer for a while and I'm currently paying " + money(item.lastAmount) + " a " + per + ". " +
      "That's more than I want to spend, and " + competitor + ". " +
      "I'd like to stay, but I need my bill closer to " + money(target) + ". " +
      "What promotions or loyalty discounts can you apply to my account today?\"\n\n" +
      "IF THEY SAY NO\n" +
      "• \"Is there a cheaper plan that still covers what I actually use?\"\n" +
      "• \"Can you check for any autopay, paperless, bundle, or loyalty discounts?\"\n" +
      "• \"Could you transfer me to the retention or loyalty department?\"\n" +
      "• If nothing works: \"Okay, I'll think about switching,\" and call back in a few days. A different rep often says yes.\n\n" +
      (item.category === "Insurance"
        ? "INSURANCE TIP\nGet two or three online quotes first (takes about 10 minutes each). Ask about raising your deductible, bundling home and auto, and low-mileage or safe-driver discounts.\n\n"
        : "") +
      "BEFORE YOU HANG UP\n" +
      "• Ask for the new monthly price, how long it lasts, and whether there's a contract.\n" +
      "• Write down the rep's name and the date."
    );
  }

  function refund(item) {
    var amount = item.lastAmount || item.total;
    return (
      "HOW TO GET THIS FEE REFUNDED\n" +
      "Call the number on the back of your card or use your bank's chat. Fee refunds are often granted on the first ask, especially if you rarely get them.\n\n" +
      "SCRIPT\n" +
      "\"Hi, I noticed a " + item.name.toLowerCase() + " of " + money(amount) + " on my account on " +
      formatDate(item.lastDate) + ". I've been a customer for a while and this isn't typical for me. " +
      "Could you please refund it as a courtesy?\"\n\n" +
      "IF THEY SAY NO\n" +
      "• \"I understand. Could you refund half of it?\"\n" +
      "• \"Is there anything on my account that would make me eligible, like setting up direct deposit or alerts?\"\n\n" +
      "STOP IT HAPPENING AGAIN\n" + preventTip(item.name)
    );
  }

  function preventTip(name) {
    if (/Overdraft/.test(name)) return "• Turn on low-balance alerts and ask the bank to decline transactions instead of charging overdraft fees (\"opt out of overdraft coverage\").";
    if (/Monthly account/.test(name)) return "• Ask what waives the monthly fee (minimum balance or direct deposit), or switch to a free checking account. Many online banks and credit unions charge nothing.";
    if (/ATM/.test(name)) return "• Use your bank's ATM locator app, or get cash back at a grocery store checkout for free.";
    if (/Foreign/.test(name)) return "• Use a card with no foreign transaction fees when traveling or buying from overseas sites.";
    if (/Late/.test(name)) return "• Turn on autopay for at least the minimum payment.";
    if (/annual fee/i.test(name)) return "• Ask to switch (\"product change\") to a no-annual-fee card from the same bank. This keeps your credit history.";
    if (/Interest/.test(name)) return "• Ask for a lower APR, and consider moving the balance to a 0% balance-transfer card.";
    return "• Ask the bank what account settings or account type would avoid this fee.";
  }

  function formatDate(d) {
    if (!d) return "a recent date";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function forItem(item, action) {
    if (action === "negotiate") return negotiate(item);
    if (action === "refund") return refund(item);
    return cancel(item);
  }

  var api = { cancel: cancel, negotiate: negotiate, refund: refund, forItem: forItem };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AuditScripts = api;
})(typeof self !== "undefined" ? self : this);

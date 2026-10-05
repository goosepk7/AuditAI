/*
 * Known merchants: recognizes common subscriptions, bills, and bank fees so
 * the audit can label them, link to the cancel page, and pick the right script.
 *
 * kind:
 *   "subscription" – something you can usually cancel online
 *   "bill"         – a service you need but can often negotiate (phone, internet, insurance)
 *   "fee"          – a bank or card fee you can often get refunded or avoid
 */
(function (root) {
  "use strict";

  var M = [
    // Streaming video
    ["NETFLIX", "Netflix", "Streaming", "subscription", "https://www.netflix.com/cancelplan"],
    ["HULU", "Hulu", "Streaming", "subscription", "https://secure.hulu.com/account"],
    ["DISNEY ?PLUS|DISNEYPLUS|DISNEY\\+", "Disney+", "Streaming", "subscription", "https://www.disneyplus.com/account"],
    ["HBO ?MAX|\\bMAX\\.COM|WARNER ?BROS", "Max", "Streaming", "subscription", "https://www.max.com/account"],
    ["PARAMOUNT", "Paramount+", "Streaming", "subscription", "https://www.paramountplus.com/account/"],
    ["PEACOCK", "Peacock", "Streaming", "subscription", "https://www.peacocktv.com/account"],
    ["APPLE ?TV", "Apple TV+", "Streaming", "subscription", "https://support.apple.com/en-us/118428"],
    ["YOUTUBE ?TV", "YouTube TV", "Streaming", "subscription", "https://tv.youtube.com/settings/membership"],
    ["YOUTUBE ?PREMIUM|GOOGLE \\*YOUTUBE", "YouTube Premium", "Streaming", "subscription", "https://www.youtube.com/paid_memberships"],
    ["SLING", "Sling TV", "Streaming", "subscription", "https://www.sling.com/account"],
    ["FUBO", "Fubo", "Streaming", "subscription", "https://www.fubo.tv/account"],
    ["STARZ", "Starz", "Streaming", "subscription", "https://www.starz.com/account"],
    ["CRUNCHYROLL", "Crunchyroll", "Streaming", "subscription", "https://www.crunchyroll.com/account/membership"],
    ["ESPN", "ESPN+", "Streaming", "subscription", "https://www.espn.com/watch/account"],
    ["PRIME ?VIDEO", "Prime Video channel", "Streaming", "subscription", "https://www.amazon.com/gp/video/settings/channels"],

    // Music & audio
    ["SPOTIFY", "Spotify", "Music & audio", "subscription", "https://www.spotify.com/account/subscription/"],
    ["APPLE ?MUSIC", "Apple Music", "Music & audio", "subscription", "https://support.apple.com/en-us/118428"],
    ["PANDORA", "Pandora", "Music & audio", "subscription", "https://www.pandora.com/settings/subscription"],
    ["SIRIUS|SIRIUSXM", "SiriusXM", "Music & audio", "subscription", "https://www.siriusxm.com/account"],
    ["AUDIBLE", "Audible", "Music & audio", "subscription", "https://www.audible.com/account/overview"],
    ["TIDAL", "Tidal", "Music & audio", "subscription", "https://account.tidal.com/subscription"],

    // Apps, software, cloud
    ["APPLE\\.COM/BILL|APPLE COM BILL|ITUNES", "Apple (App Store / iCloud)", "Apps & cloud", "subscription", "https://support.apple.com/en-us/118428"],
    ["GOOGLE ?STORAGE|GOOGLE ?ONE|GOOGLE \\*GOOGLE ONE", "Google One", "Apps & cloud", "subscription", "https://one.google.com/storage/management"],
    ["GOOGLE ?\\*?PLAY|GOOGLE \\*", "Google Play", "Apps & cloud", "subscription", "https://play.google.com/store/account/subscriptions"],
    ["MICROSOFT|MSFT|XBOX", "Microsoft / Xbox", "Apps & cloud", "subscription", "https://account.microsoft.com/services"],
    ["ADOBE", "Adobe", "Apps & cloud", "subscription", "https://account.adobe.com/plans"],
    ["DROPBOX", "Dropbox", "Apps & cloud", "subscription", "https://www.dropbox.com/account/plan"],
    ["NORTON|NORTONLIFELOCK|GEN DIGITAL", "Norton", "Apps & cloud", "subscription", "https://my.norton.com/extspa/subscriptions"],
    ["MCAFEE", "McAfee", "Apps & cloud", "subscription", "https://home.mcafee.com/myaccount"],
    ["OPENAI|CHATGPT", "ChatGPT", "Apps & cloud", "subscription", "https://chatgpt.com/#settings/Subscription"],
    ["ANTHROPIC|CLAUDE\\.AI", "Claude", "Apps & cloud", "subscription", "https://claude.ai/settings/billing"],
    ["CANVA", "Canva", "Apps & cloud", "subscription", "https://www.canva.com/settings/billing-and-plans"],
    ["GRAMMARLY", "Grammarly", "Apps & cloud", "subscription", "https://account.grammarly.com/subscription"],
    ["LINKEDIN", "LinkedIn Premium", "Apps & cloud", "subscription", "https://www.linkedin.com/premium/manage"],
    ["NORDVPN|EXPRESSVPN|SURFSHARK", "VPN", "Apps & cloud", "subscription", null],
    ["PLAYSTATION|SONY ?PLAYSTATION|PSN", "PlayStation Plus", "Gaming", "subscription", "https://www.playstation.com/acct/management"],
    ["NINTENDO", "Nintendo Switch Online", "Gaming", "subscription", "https://accounts.nintendo.com/shop/subscription"],

    // Shopping & delivery memberships
    ["AMAZON ?PRIME|AMZN ?PRIME|PRIME ?MEMBERSHIP", "Amazon Prime", "Memberships", "subscription", "https://www.amazon.com/mc/yourmembershipsandsubscriptions"],
    ["WALMART ?\\+|WALMART ?PLUS|WMT ?PLUS", "Walmart+", "Memberships", "subscription", "https://www.walmart.com/plus/account"],
    ["COSTCO ?(MEMBER|MBR|ANNUAL|RENEW)", "Costco membership", "Memberships", "subscription", null],
    ["DOORDASH ?DASHPASS|DASHPASS", "DoorDash DashPass", "Memberships", "subscription", "https://www.doordash.com/consumer/membership/"],
    ["UBER ?ONE", "Uber One", "Memberships", "subscription", "https://account.uber.com/"],
    ["INSTACART", "Instacart+", "Memberships", "subscription", "https://www.instacart.com/store/account/instacart-plus"],
    ["GRUBHUB ?\\+|GRUBHUB ?PLUS", "Grubhub+", "Memberships", "subscription", null],
    ["HELLOFRESH|HELLO FRESH", "HelloFresh", "Memberships", "subscription", "https://www.hellofresh.com/account-settings/plan-settings"],
    ["BLUE ?APRON|FACTOR ?75|FACTOR\\b(?! ?Y)|HOME ?CHEF", "Meal kit", "Memberships", "subscription", null],
    ["CHEWY", "Chewy Autoship", "Memberships", "subscription", "https://www.chewy.com/app/account/autoship"],
    ["IPSY|BIRCHBOX|FABFITFUN|BARKBOX|DOLLAR SHAVE", "Subscription box", "Memberships", "subscription", null],

    // News & learning
    ["NYTIMES|NY ?TIMES|NEW ?YORK ?TIMES", "New York Times", "News & learning", "subscription", "https://myaccount.nytimes.com/seg/subscription"],
    ["WSJ|WALL ?ST(REET)? ?JOURNAL|DOW ?JONES", "Wall Street Journal", "News & learning", "subscription", null],
    ["WASHPOST|WASHINGTON ?POST", "Washington Post", "News & learning", "subscription", null],
    ["MEDIUM", "Medium", "News & learning", "subscription", "https://medium.com/me/settings/membership"],
    ["SUBSTACK", "Substack", "News & learning", "subscription", "https://substack.com/account"],
    ["PATREON", "Patreon", "News & learning", "subscription", "https://www.patreon.com/settings/memberships"],
    ["DUOLINGO", "Duolingo", "News & learning", "subscription", null],
    ["MASTERCLASS", "MasterClass", "News & learning", "subscription", null],
    ["COURSERA|SKILLSHARE|UDEMY", "Online courses", "News & learning", "subscription", null],

    // Health & fitness
    ["PLANET ?FITNESS|PF ?CLUB", "Planet Fitness", "Fitness", "subscription", null],
    ["LA ?FITNESS|FITNESS ?19|ANYTIME ?FITNESS|24 ?HOUR ?FITNESS|GOLDS ?GYM|CRUNCH ?FITNESS|EQUINOX|LIFETIME ?FITNESS|YMCA|ORANGETHEORY", "Gym membership", "Fitness", "subscription", null],
    ["PELOTON", "Peloton", "Fitness", "subscription", "https://members.onepeloton.com/preferences/subscriptions"],
    ["CALM\\b|CALM\\.COM", "Calm", "Fitness", "subscription", null],
    ["HEADSPACE", "Headspace", "Fitness", "subscription", null],
    ["NOOM", "Noom", "Fitness", "subscription", null],
    ["WW ?INTERNATIONAL|WEIGHTWATCHERS|WEIGHT ?WATCHERS", "WW (Weight Watchers)", "Fitness", "subscription", null],
    ["STRAVA|FITBIT ?PREMIUM|MYFITNESSPAL", "Fitness app", "Fitness", "subscription", null],

    // Dating
    ["TINDER|BUMBLE|HINGE|MATCH\\.COM|MATCH ?GROUP", "Dating app", "Dating", "subscription", null],

    // Bills you can negotiate
    ["VERIZON|VZW", "Verizon", "Phone", "bill", null],
    ["AT ?& ?T|\\bATT\\b", "AT&T", "Phone", "bill", null],
    ["T-?MOBILE|TMOBILE", "T-Mobile", "Phone", "bill", null],
    ["CRICKET|BOOST ?MOBILE|METRO ?BY|MINT ?MOBILE|VISIBLE|US ?CELLULAR|STRAIGHT ?TALK", "Mobile carrier", "Phone", "bill", null],
    ["COMCAST|XFINITY", "Xfinity", "Internet & TV", "bill", null],
    ["SPECTRUM|CHARTER", "Spectrum", "Internet & TV", "bill", null],
    ["COX ?COMM", "Cox", "Internet & TV", "bill", null],
    ["OPTIMUM|ALTICE", "Optimum", "Internet & TV", "bill", null],
    ["CENTURYLINK|LUMEN|QUANTUM ?FIBER", "CenturyLink", "Internet & TV", "bill", null],
    ["FRONTIER", "Frontier", "Internet & TV", "bill", null],
    ["DIRECTV|DISH ?NETWORK|DISH\\b", "Satellite TV", "Internet & TV", "bill", null],
    ["GEICO", "GEICO", "Insurance", "bill", null],
    ["PROGRESSIVE", "Progressive", "Insurance", "bill", null],
    ["STATE ?FARM", "State Farm", "Insurance", "bill", null],
    ["ALLSTATE", "Allstate", "Insurance", "bill", null],
    ["LIBERTY ?MUTUAL", "Liberty Mutual", "Insurance", "bill", null],
    ["FARMERS ?INS", "Farmers", "Insurance", "bill", null],
    ["USAA", "USAA", "Insurance", "bill", null],
    ["NATIONWIDE", "Nationwide", "Insurance", "bill", null],
    ["LEMONADE", "Lemonade", "Insurance", "bill", null],
    ["\\bADT\\b|VIVINT|SIMPLISAFE|RING ?PROTECT", "Home security", "Home services", "bill", null],

    // Fees
    ["OVERDRAFT|\\bOD ?FEE|NSF|INSUFFICIENT ?FUNDS|RETURNED ?ITEM", "Overdraft / NSF fee", "Bank fees", "fee", null],
    ["MONTHLY ?(SERVICE|MAINTENANCE)|MAINTENANCE ?FEE|SERVICE ?CHARGE|ACCOUNT ?FEE", "Monthly account fee", "Bank fees", "fee", null],
    ["ATM ?(FEE|SURCHARGE|WITHDRAWAL ?FEE)|NON-?NETWORK ?ATM|OUT.OF.NETWORK", "ATM fee", "Bank fees", "fee", null],
    ["FOREIGN ?TRANS(ACTION)?|INTL ?TRANS(ACTION)? ?FEE|INTERNATIONAL ?TRANS", "Foreign transaction fee", "Bank fees", "fee", null],
    ["LATE ?(PAYMENT ?)?FEE|LATE ?CHARGE", "Late fee", "Bank fees", "fee", null],
    ["ANNUAL ?(MEMBERSHIP ?)?FEE|ANNUAL ?CARD ?FEE", "Card annual fee", "Bank fees", "fee", null],
    ["INTEREST ?CHARGE|PURCHASE ?INTEREST|FINANCE ?CHARGE|INTEREST ?CHARGED", "Interest charge", "Bank fees", "fee", null],
    ["PAPER ?STATEMENT|STATEMENT ?FEE|WIRE ?FEE|TRANSFER ?FEE|CASH ?ADVANCE ?FEE", "Bank service fee", "Bank fees", "fee", null]
  ];

  var compiled = M.map(function (m) {
    return {
      re: new RegExp(m[0]),
      name: m[1],
      category: m[2],
      kind: m[3],
      cancelUrl: m[4]
    };
  });

  /** Returns the known-merchant record matching an uppercase description, or null. */
  function lookupMerchant(upperDesc) {
    for (var i = 0; i < compiled.length; i++) {
      if (compiled[i].re.test(upperDesc)) return compiled[i];
    }
    return null;
  }

  var api = { lookupMerchant: lookupMerchant, MERCHANTS: compiled, KNOWN_MERCHANT_COUNT: compiled.length };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AuditMerchants = api;
})(typeof self !== "undefined" ? self : this);

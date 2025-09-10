// src/lib/countryNameToCode.js
// Zet een landnaam (NL/EN), alias of ISO-code om naar ISO-2 in lowercase (bijv. "nl", "us").
// - Accent- en spatie-insensitive (Côte d’Ivoire == cote d ivoire)
// - Herkent veel NL/EN aliassen (Holland, Verenigd Koninkrijk, VK, etc.)
// - Herkent ISO-2 (gewoon normaliseren) en ISO-3 (via mapping)

function stripDiacritics(str) {
  return String(str)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const ISO3_TO_ISO2 = {
  // EU + veelvoorkomend
  nld:"nl", deu:"de", fra:"fr", gbr:"gb", irl:"ie", esp:"es", ita:"it", prt:"pt",
  swe:"se", nor:"no", fin:"fi", dnk:"dk", pol:"pl", usa:"us", can:"ca", che:"ch",
  aut:"at", cze:"cz", grc:"gr", tur:"tr", lux:"lu", isl:"is", hun:"hu", rou:"ro",
  bgr:"bg", hrv:"hr", svn:"si", svk:"sk", lva:"lv", ltu:"lt", est:"ee", ukr:"ua",
  rus:"ru", nld:"nl", bel:"be",

  // Wereldwijd (selectie)
  arg:"ar", bra:"br", mex:"mx", col:"co", per:"pe", chl:"cl", ven:"ve", ury:"uy",
  bol:"bo", pry:"py",
  aus:"au", nzl:"nz", jpn:"jp", kor:"kr", prk:"kp", chn:"cn", hkg:"hk", twn:"tw",
  ind:"in", idn:"id", tha:"th", vnm:"vn", phl:"ph", mys:"my", sgp:"sg",
  zaf:"za", egy:"eg", mar:"ma", dza:"dz", tun:"tn", nga:"ng", gha:"gh", ken:"ke",
  eth:"et", tza:"tz", ugx:"ug", civ:"ci", gnb:"gw",
  are:"ae", sau:"sa", qat:"qa", kwt:"kw", irq:"iq", irn:"ir", isr:"il", lbn:"lb",
  jor:"jo",
  arm:"am", aze:"az", geo:"ge", kaz:"kz", kgz:"kg", tkm:"tm", uzb:"uz",
};

const NAME_TO_ISO2 = {
  // 🇳🇱 + 🇬🇧 aliassen (lowercase, accent/quote-insensitive)
  // Nederland
  "nederland":"nl","the netherlands":"nl","netherlands":"nl","holland":"nl",

  // België
  "belgie":"be","belgië":"be","belgium":"be",

  // Duitsland
  "duitsland":"de","germany":"de",

  // Frankrijk
  "frankrijk":"fr","france":"fr",

  // Verenigd Koninkrijk (VK)
  "verenigd koninkrijk":"gb","verenigd koninkrijk (vk)":"gb","vk":"gb",
  "united kingdom":"gb","great britain":"gb","uk":"gb","engeland":"gb","england":"gb",

  // Ierland
  "ierland":"ie","ireland":"ie",

  // Spanje
  "spanje":"es","spain":"es",

  // Italië
  "italie":"it","italië":"it","italy":"it",

  // Portugal
  "portugal":"pt",

  // Scandinavië
  "zweden":"se","sweden":"se",
  "noorwegen":"no","norway":"no",
  "finland":"fi",

  // Denemarken
  "denemarken":"dk","denmark":"dk",

  // Polen
  "polen":"pl","poland":"pl",

  // VS/Canada
  "verenigde staten":"us","verenigde staten van amerika":"us","united states":"us","usa":"us","u.s.a.":"us",
  "canada":"ca",

  // Zwitserland/Oostenrijk
  "zwitserland":"ch","switzerland":"ch",
  "oostenrijk":"at","austria":"at",

  // Tsjechië
  "tsjechie":"cz","tsjechië":"cz","czech republic":"cz","czechia":"cz",

  // Griekenland
  "griekenland":"gr","greece":"gr","hellas":"gr","el":"gr",

  // Turkije
  "turkije":"tr","türkiye":"tr","turkey":"tr",

  // Benelux + periferie
  "luxemburg":"lu","luxembourg":"lu",
  "ijsland":"is","iceland":"is",
  "hongarije":"hu","hungary":"hu",
  "roemenie":"ro","roemenië":"ro","romania":"ro",
  "bulgarije":"bg","bulgaria":"bg",
  "kroatie":"hr","kroatië":"hr","croatia":"hr",
  "slovenie":"si","slovenië":"si","slovenia":"si",
  "slowakije":"sk","slovakia":"sk",
  "letland":"lv","latvia":"lv",
  "litouwen":"lt","lithuania":"lt",
  "estland":"ee","estonia":"ee",

  // Balkan/Zuidoost
  "servie":"rs","servië":"rs","serbia":"rs",
  "bosnie en herzegovina":"ba","bosnië en herzegovina":"ba","bosnia and herzegovina":"ba",
  "noord macedonie":"mk","noord-macedonie":"mk","north macedonia":"mk",
  "albanie":"al","albanië":"al","albania":"al",
  "montenegro":"me",

  // Oost-Europa
  "oekraine":"ua","oekraïne":"ua","ukraine":"ua",
  "rusland":"ru","russia":"ru","russian federation":"ru",

  // Azië
  "china":"cn",
  "japan":"jp",
  "india":"in",
  "indonesie":"id","indonesië":"id","indonesia":"id",
  "viet nam":"vn","vietnam":"vn",
  "korea, republic of":"kr","zuid-korea":"kr","south korea":"kr",
  "korea, democratic people's republic of":"kp","noord-korea":"kp","north korea":"kp",
  "taiwan":"tw","taiwan, province of china":"tw",
  "hong kong":"hk",
  "thailand":"th",
  "filipijnen":"ph","philippines":"ph",
  "maleisie":"my","maleisië":"my","malaysia":"my",
  "singapore":"sg",

  // Oceanië
  "australie":"au","australië":"au","australia":"au",
  "nieuw zeeland":"nz","nieuw-zeeland":"nz","new zealand":"nz",

  // Afrika (selectie)
  "zuid-afrika":"za","zuid afrika":"za","south africa":"za",
  "egypte":"eg","egypt":"eg",
  "marokko":"ma","morocco":"ma",
  "algerije":"dz","algeria":"dz",
  "nigeria":"ng","ghana":"gh","kenia":"ke","kenya":"ke","ethiopie":"et","ethiopië":"et","ethiopia":"et",
  "tanzania":"tz",
  "ivoorkust":"ci","cote d ivoire":"ci","côte d’ivoire":"ci","cote d’ivoire":"ci","côte d'ivoire":"ci","cote d'ivoire":"ci","ivory coast":"ci",

  // Midden-Oosten (selectie)
  "verenigde arabische emiraten":"ae","united arab emirates":"ae",
  "saudi-arabie":"sa","saudi arabie":"sa","saudi-arabië":"sa","saudi arabia":"sa",
  "qatar":"qa","kuwait":"kw",
  "irak":"iq","iraq":"iq","iran":"ir",
  "israel":"il","israël":"il","israel":"il",
  "libanon":"lb","lebanon":"lb","jordanie":"jo","jordanië":"jo","jordan":"jo",

  // Overig EU/Europa
  "schotland":"gb","scotland":"gb","wales":"gb",
  "faeröer":"fo","faeroer":"fo","faroe islands":"fo",

  // Specials/gebieden die je in B2B tegenkomt
  "curacao":"cw","curaçao":"cw",
  "reunion":"re","réunion":"re",
  "sint maarten (dutch part)":"sx",
  "guernsey":"gg","jersey":"je","isle of man":"im",
  "aland":"ax","åland":"ax","aland islands":"ax","åland islands":"ax",
};

// Publieke API
export function countryNameToCode(name) {
  if (!name) return null;

  // 0) normalize input
  const raw = String(name).trim();

  // 1) ISO-2? → normaliseren
  if (/^[A-Za-z]{2}$/.test(raw)) {
    // UK → GB, EL → GR etc. (FlagCDN/ISO2 compat)
    let c = raw.toLowerCase();
    if (c === "uk") c = "gb";
    if (c === "el") c = "gr";
    return c;
  }

  // 2) ISO-3? → naar ISO-2
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const iso3 = raw.toLowerCase();
    if (ISO3_TO_ISO2[iso3]) return ISO3_TO_ISO2[iso3];
  }

  // 3) Naam (NL/EN), accent-insensitive + spaties normaliseren
  const key = stripDiacritics(raw)
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9\s\-'&().]/g, " ") // rare chars weg
    .replace(/\s+/g, " ")
    .trim();

  // Directe hit?
  if (NAME_TO_ISO2[key]) return NAME_TO_ISO2[key];

  // Extra slimme aliases (korte varianten)
  // - “u.s.” / “u.s.a.” → us
  if (/^u\.?s\.?a?\.?$/.test(key)) return "us";
  // - “u.k.” → gb
  if (/^u\.?k\.?$/.test(key)) return "gb";

  // Geen match
  return null;
}

export default countryNameToCode;

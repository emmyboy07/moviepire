import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

function animeLog(stage: string, data?: any): void {
  saveResponse(stage, data, "anime").catch(() => {});
}

async function saveResponse(stage: string, data: any, endpoint?: string): Promise<void> {
  try {
    const filePath = path.join(process.cwd(), "response.txt");
    const timestamp = new Date().toISOString();
    const endpointInfo = endpoint ? ` - ${endpoint}` : "";
    const content = `\n========== [${timestamp}] ${stage}${endpointInfo} ==========\n${JSON.stringify(data, null, 2)}\n`;
    await fs.appendFile(filePath, content, "utf8");
  } catch (error) {
    // silently fail, can't log errors while logging
  }
}

const TMDB_API_KEY = process.env.TMDB_API_KEY ?? "1e2d76e7c45818ed61645cb647981e5c";

function cleanTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s*\[.*?\]\s*/g, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// MovieBox often drops the creator-attribution prefix TMDB keeps, e.g. TMDB's
// "Tyler Perry's Zatima" is listed there as just "Zatima S1-S4" - strip a
// leading "X's " so the title comparison below can still line them up.
function stripPossessivePrefix(t: string): string {
  return t.replace(/^.+?'s\s+/i, "");
}

function defaultString(value: unknown, fallback: string): string {
  const str = String(value ?? "").trim();
  return str || fallback;
}

async function tmdbInfo(type: "movie" | "tv", id: number): Promise<any> {
  const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}`;
  const res = await fetch(url);
  const text = await res.text();
  try {
    return res.ok ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", eng: "English", ar: "Arabic", ara: "Arabic", arb: "Arabic",
  es: "Spanish", spa: "Spanish", fr: "French", fra: "French", fre: "French",
  de: "German", deu: "German", ger: "German", it: "Italian", ita: "Italian",
  pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",
  zh: "Chinese", zho: "Chinese", chi: "Chinese", ja: "Japanese", jpn: "Japanese",
  ko: "Korean", kor: "Korean", vi: "Vietnamese", vie: "Vietnamese",
  th: "Thai", tha: "Thai", id: "Indonesian", ind: "Indonesian", in_id: "Indonesian",
  tr: "Turkish", tur: "Turkish", hi: "Hindi", hin: "Hindi", bn: "Bengali",
  fil: "Filipino", ha: "Hausa", ms: "Malay", pa: "Punjabi", sw: "Swahili", ur: "Urdu",
};

function normalizeLanguageCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return (
    raw
      .toLowerCase()
      .split(/[_-]/)
      .shift()
      ?.replace(/[^a-z]/g, "") ?? ""
  );
}

function getFriendlyLanguageName(code: string | null | undefined): string {
  if (!code) return "Subtitle";
  const clean = code.trim().toLowerCase();
  return LANGUAGE_NAMES[clean] || clean.toUpperCase();
}

export interface QualityItem {
  id: string;
  resolution: string;
  url: string;
  size: number;
  format: string;
  language: string;
  languageLabel: string;
}

export interface SubtitleItem {
  url: string;
  language: string;
  lang: string;
  label: string;
}

export interface LanguageOption {
  code: string;
  label: string;
  subjectId: string;
  detailPath: string;
  original: boolean;
}

export interface MediaResult {
  title: string;
  year: string | null;
  subjectId: string;
  detailPath: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  genres?: string[];
  runtime?: number;
  qualities: QualityItem[];
  captions: SubtitleItem[];
  languages: LanguageOption[];
  seasons?: number[];
  episodes?: number[];
  totalEpisodes?: number;
}

// =============================================================================
// wefeed-h5api-bff backend, reached via themoviebox.org
//
// This is the actual backend behind MovieBox's "Watch Now" flow, reverse-engineered
// from the live site's network traffic. It replaces the old api3/api6.aoneroom.com
// HMAC-signed mobile gateway below for movies/TV/anime, since it's simpler, doesn't
// need device-credential spoofing, and returns qualities + subtitles + language
// variants + season/episode structure in two plain requests instead of ~7 signed ones.
//
// h5-api.aoneroom.com/netfilm.world (the original hosts for this same API) are
// blocked/unreliable from our deployment's IP - themoviebox.org (found via the
// moviebox.id -> themoviebox.org redirect chain) proxies the identical
// wefeed-h5api-bff paths on its own domain and isn't subject to that block.
// It also serves the same /web/searchResult HTML search page our search below
// scrapes, so both the search and the detail/download calls stay on one host.
// =============================================================================

const H5_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Mirrors of the same wefeed-h5api-bff backend - tried in order, wrapping
// around through all of them, whenever the currently-preferred one fails
// (rate-limited, errors, or unreachable). themoviebox.org is known to
// rate-limit our VPS's IP specifically (confirmed: 429 RESOURCE_EXHAUSTED from
// that IP while the same request succeeds from elsewhere); moviebox.ke's
// /detail endpoint returns an HTML fallback page instead of JSON (kept last -
// still useful for search, just not detail/play). moviebox.ph is currently
// the most reliable from our VPS.
const MOVIEBOX_DOMAINS = [
  "https://moviebox.ph",
  "https://moviebox.id",
  "https://themoviebox.org",
  "https://moviebox.ke",
];
let currentDomainIdx = 0;

function getCurrentDomain(): string {
  return MOVIEBOX_DOMAINS[currentDomainIdx];
}

// Tries a request against each domain, starting from whichever one is
// currently preferred and wrapping around through the full list, until
// `isValid` accepts one. Remembers the domain that worked so later calls in
// this process start there instead of re-probing failed ones every time.
async function fetchMovieBoxDomain<T>(
  label: string,
  buildUrl: (domain: string) => string,
  buildOptions: (domain: string) => RequestInit,
  isValid: (status: number, text: string) => boolean,
): Promise<{ text: string; status: number; domain: string } | null> {
  for (let i = 0; i < MOVIEBOX_DOMAINS.length; i++) {
    const idx = (currentDomainIdx + i) % MOVIEBOX_DOMAINS.length;
    const domain = MOVIEBOX_DOMAINS[idx];
    const url = buildUrl(domain);
    try {
      const res = await moviebox_fetch(url, buildOptions(domain));
      const text = await res.text();
      if (isValid(res.status, text)) {
        if (idx !== currentDomainIdx) {
          addApiTrace(`${label}: switched to ${domain} (previous domain failed)`);
        }
        currentDomainIdx = idx;
        return { text, status: res.status, domain };
      }
      addApiTrace(`${label}: ${domain} rejected (status ${res.status}) - trying next domain`);
    } catch (err: any) {
      addApiTrace(`${label}: ${domain} exception -> ${err.message || err} - trying next domain`);
    }
  }
  addApiTrace(`${label}: all ${MOVIEBOX_DOMAINS.length} domains failed`);
  return null;
}

// netfilm.world mirrors the same wefeed-h5api-bff backend and its own
// /subject/download resource pool is populated far more often than
// themoviebox.org's (confirmed with real captions on titles themoviebox.org
// reports hasResource:false for) - used for the download/captions call only.
const NETFILM_BASE_URL = "https://netfilm.world";

// Our deployment's own IP gets a 406 from themoviebox.org's internal search
// backend, regardless of headers/cookies sent - confirmed via a relay proxy
// running on a separate VPS (different provider/region) that reaches the same
// URL successfully. Route MovieBox calls through that relay instead of
// fetching themoviebox.org directly from this process.
//
// Two relay VPS's are load-balanced/failed-over across here: the original
// plain relay, and a second one (which additionally round-robins its own two
// local IPs and caches responses server-side - see
// cloudflare-worker/vps-proxy-lb.js in media-go-getter-main) - stacking IP
// diversity on top of IP diversity to spread load further and reduce how
// often any single IP gets rate-limited by themoviebox.org.
const MOVIEBOX_PROXIES: { url: string; token: string }[] = [
  { url: "http://162.35.176.37:8788/", token: "affe393e50a7ac66df6d7459216ce8d0c5796a2a9ad01f87" },
  { url: "http://162.35.181.162:8788/", token: "affe393e50a7ac66df6d7459216ce8d0c5796a2a9ad01f87" },
];
let currentProxyIdx = 0;

async function moviebox_fetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (url.includes("netfilm.world")) {
    if (options.headers instanceof Headers) {
      options.headers.set("X-Forwarded-For", "105.112.34.201");
      options.headers.set("X-Real-IP", "105.112.34.201");
      options.headers.set("CF-Connecting-IP", "105.112.34.201");
      options.headers.set("True-Client-IP", "105.112.34.201");
    } else {
      const rawHeaders = (options.headers || {}) as Record<string, string>;
      options.headers = {
        ...rawHeaders,
        "X-Forwarded-For": "105.112.34.201",
        "X-Real-IP": "105.112.34.201",
        "CF-Connecting-IP": "105.112.34.201",
        "True-Client-IP": "105.112.34.201",
      };
    }
  }

  let lastErr: unknown;
  for (let i = 0; i < MOVIEBOX_PROXIES.length; i++) {
    const idx = (currentProxyIdx + i) % MOVIEBOX_PROXIES.length;
    const proxy = MOVIEBOX_PROXIES[idx];
    const proxied = `${proxy.url}?url=${encodeURIComponent(url)}&token=${encodeURIComponent(proxy.token)}`;
    try {
      const res = await fetch(proxied, options);
      // 502 means the relay itself couldn't reach the target (e.g. both of
      // its own local IPs failed) - try the other relay. 429 means the
      // target rate-limited whichever IP(s) that relay used - also worth
      // trying the other relay's IP(s) before giving up. Anything else is a
      // real upstream response and should be passed through as-is.
      if (res.status !== 502 && res.status !== 429) {
        currentProxyIdx = idx;
        return res;
      }
      lastErr = new Error(`proxy ${proxy.url} returned ${res.status}`);
      if (i === MOVIEBOX_PROXIES.length - 1) return res; // out of proxies to try - return the last response anyway
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All MovieBox proxies failed");
}

// Diagnostics tracing
export let lastApiTrace: string[] = [];

export function addApiTrace(message: string): void {
  const timestamp = new Date().toISOString().substring(11, 19); // HH:MM:SS
  lastApiTrace.push(`[${timestamp}] ${message}`);
  if (lastApiTrace.length > 30) {
    lastApiTrace.shift();
  }
}

export function getApiTrace(): string[] {
  return lastApiTrace;
}

export function clearApiTrace(): void {
  lastApiTrace = [];
}

function getWeeedHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'accept': 'application/json',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'x-client-info': JSON.stringify({ timezone: 'Africa/Lagos' }),
    'x-source': 'h5',
    'cookie': [
      '_ga=GA1.1.2113914.1736365446',
      'account=6328836939160473392|0|H5|1744461404|',
      '_ym_uid=1744461405935706898',
      '_ym_d=1744461405',
      'i18n_lang=en',
      '_ga_LF2XQTEPMF=GS2.1.s1751456194$o64$g1$t1751456489$j37$l0$h0'
    ].join('; '),
    ...extraHeaders
  };
}

// Our original search mechanism: load the search results page and parse
// the rendered `a.card` entries with cheerio, instead of calling
// the wefeed-h5api-bff JSON search API directly. This page doesn't expose a
// subjectType filter or release year, so scoring/matching happens purely on
// title text here - the year cross-check that used to happen at this stage
// now happens once we've fetched a candidate's own detail page instead (see
// resolveBestSubject below), which is where the real releaseDate lives.
async function searchMovieBoxHtml(keyword: string): Promise<string | null> {
  addApiTrace(`searchMovieBoxHtml keyword: "${keyword}"`);
  const result = await fetchMovieBoxDomain(
    "searchMovieBoxHtml",
    (domain) => `${domain}/web/searchResult?keyword=${encodeURIComponent(keyword)}`,
    () => ({ headers: { "User-Agent": H5_USER_AGENT } }),
    (status, text) => status === 200 && text.length > 0,
  );
  if (!result) return null;
  return result.text;
}

interface HtmlSearchResult {
  title: string;
  rating: number;
  href: string;
  detailPath: string;
  matchScore: number;
}

function extractMovieBoxResults(html: string, targetTitle: string): HtmlSearchResult[] {
  const $ = cheerio.load(html);
  const cleanTarget = cleanTitle(targetTitle);
  const cleanTargetStripped = cleanTitle(stripPossessivePrefix(targetTitle));
  const results: HtmlSearchResult[] = [];
  const cardCount = $("a.card").length;

  $("a.card").each((_, element) => {
    try {
      const href = $(element).attr("href") || "";
      const title = $(element).find("h2.card-title").text().trim();
      const rating = $(element).find("span.rate").text().trim();

      // detailPath is the full slug (readable text + trailing hash), e.g.
      // "fast-x-SttcFY99GU3" from "/moviesDetail/fast-x-SttcFY99GU3" - this is
      // what the detail/download APIs actually need, not just the readable part.
      const detailMatch = href.match(/\/movies?detail\/([^/?#]+)/i);
      const detailPath = detailMatch ? detailMatch[1] : "";
      if (!detailPath) return;

      const cleanCurrentTitle = cleanTitle(title);
      const matchesTarget = cleanCurrentTitle.includes(cleanTarget) || cleanTarget.includes(cleanCurrentTitle);
      const matchesStripped =
        cleanTargetStripped !== cleanTarget &&
        (cleanCurrentTitle.includes(cleanTargetStripped) || cleanTargetStripped.includes(cleanCurrentTitle));
      if (!matchesTarget && !matchesStripped) return;

      results.push({
        title,
        rating: parseFloat(rating) || 0,
        href,
        detailPath,
        matchScore: Math.max(
          calculateMatchScore(cleanCurrentTitle, cleanTarget),
          matchesStripped ? calculateMatchScore(cleanCurrentTitle, cleanTargetStripped) : 0,
        ),
      });
    } catch (err: any) {
      // ignore malformed card
    }
  });

  // If the page rendered zero a.card elements at all (as opposed to some
  // cards that just didn't match the title), the HTML we got almost certainly
  // isn't the real search results - a bot-check/geo-block/consent page served
  // instead, which still answers 200 but has none of the expected markup.
  if (cardCount === 0) {
    addApiTrace(`extractMovieBoxResults: 0 a.card elements in ${html.length}-char page (likely blocked/challenge page, not real search results)`);
  } else {
    addApiTrace(`extractMovieBoxResults: ${cardCount} a.card elements, ${results.length} matched title "${targetTitle}"`);
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

// Walks the title-ranked HTML search results in order and fetches each
// candidate's own detail page (which has the real releaseDate, unlike the
// search results page) until one's year lines up with TMDB's - or, for
// series/anime, until one's title suffix actually names the requested season.
async function resolveBestSubject(
  results: HtmlSearchResult[],
  targetTitle: string,
  targetYear?: string | null,
  season?: number,
): Promise<{ item: HtmlSearchResult; detail: any; subjectId: string } | null> {
  const cleanTarget = cleanTitle(targetTitle);
  const cleanTargetStripped = cleanTitle(stripPossessivePrefix(targetTitle));
  const targetYearNum = targetYear ? parseInt(targetYear, 10) : NaN;
  const candidates = results.slice(0, 5);
  addApiTrace(`resolveBestSubject: checking ${candidates.length} of ${results.length} candidates for "${targetTitle}" (${targetYear ?? "no year"})`);

  // MovieBox splits multi-season shows into one subject per season (or per
  // season range) - e.g. "Wednesday S1" (2022) and "Wednesday S2" (2025) are
  // separate subjects, and S2's own release year has nothing to do with the
  // show's debut year. When requesting a season other than 1, first confirm a
  // season-1 candidate exists whose title+year actually matches the target -
  // that anchors us to the right show - and only then trust a later season's
  // own title/season match irrespective of ITS release year.
  let seasonOneAnchorConfirmed = false;
  if (season != null && season !== 1 && !Number.isNaN(targetYearNum)) {
    for (const candidate of candidates) {
      const range = extractSeasonRange(candidate.title);
      if (!range || !(1 >= range.start && 1 <= range.end)) continue;
      const anchorDetail = await getSubjectDetail(candidate.detailPath);
      const anchorSubject = anchorDetail?.subject;
      if (!anchorSubject) continue;
      const anchorYear = parseInt(String(anchorSubject.releaseDate ?? "").split("-")[0], 10);
      if (Number.isNaN(anchorYear)) continue;
      const anchorBaseTitle = cleanTitle(candidate.title.replace(/\s*S\d+(?:-S\d+)?\s*$/i, ""));
      const anchorIsExactTitle = anchorBaseTitle === cleanTarget || anchorBaseTitle === cleanTargetStripped;
      const anchorTolerance = anchorIsExactTitle ? 2 : 0;
      if (Math.abs(anchorYear - targetYearNum) <= anchorTolerance) {
        seasonOneAnchorConfirmed = true;
        addApiTrace(`resolveBestSubject: season 1 anchor confirmed via "${candidate.title}" (${anchorYear})`);
        break;
      }
    }
  }

  for (const candidate of candidates) {
    const detail = await getSubjectDetail(candidate.detailPath);
    const subject = detail?.subject;
    if (!subject?.subjectId) {
      addApiTrace(`resolveBestSubject: "${candidate.title}" (${candidate.detailPath}) - no subjectId from detail fetch, skipping`);
      continue;
    }

    // subjectType 2 is a real TV series; other values (1 = movie, 6 = short
    // clip/trailer, 7 = short drama, etc.) can still title-match a show name
    // exactly and pass the year check by luck, so a season-specific request
    // must reject anything that isn't actually a series.
    if (season != null && subject.subjectType !== 2) {
      addApiTrace(`resolveBestSubject: "${candidate.title}" rejected - subjectType ${subject.subjectType} is not a TV series`);
      continue;
    }

    const baseTitle = candidate.title.replace(/\s*S\d+(?:-S\d+)?\s*$/i, "");
    const cleanBaseTitle = cleanTitle(baseTitle);
    const isExactTitle = cleanBaseTitle === cleanTarget || cleanBaseTitle === cleanTargetStripped;

    // A requested season outside a candidate's range must reject outright
    // rather than falling through to the year check below.
    let seasonMatched = false;
    if (season != null) {
      const range = extractSeasonRange(candidate.title);
      if (range) {
        if (season >= range.start && season <= range.end) {
          seasonMatched = true;
        } else {
          addApiTrace(`resolveBestSubject: "${candidate.title}" rejected - season ${season} not in range S${range.start}-S${range.end}`);
          continue;
        }
      } else if (season !== 1) {
        // No "S{n}" suffix on this candidate's title - for any season other
        // than 1, require its own resource.seasons to explicitly confirm
        // coverage - missing/empty season data is treated as "does not cover
        // it", not as "unknown, so allow it through".
        const seasonsAvailable = mapSeasonsResource(subject.resource).seasons;
        if (!seasonsAvailable.includes(season)) {
          addApiTrace(`resolveBestSubject: "${candidate.title}" rejected - resource seasons [${seasonsAvailable.join(",")}] don't cover season ${season}`);
          continue;
        }
        seasonMatched = true;
      }
    }

    const bypassYearCheck = seasonMatched && (season === 1 || seasonOneAnchorConfirmed);

    if (!bypassYearCheck && !Number.isNaN(targetYearNum)) {
      const itemYear = parseInt(String(subject.releaseDate ?? "").split("-")[0], 10);
      if (!Number.isNaN(itemYear)) {
        const yearDiff = Math.abs(itemYear - targetYearNum);
        const tolerance = isExactTitle ? 2 : 0;
        if (yearDiff > tolerance) {
          addApiTrace(`resolveBestSubject: "${candidate.title}" rejected - year ${itemYear} vs target ${targetYearNum} (diff ${yearDiff} > tolerance ${tolerance})`);
          continue;
        }
      }
    }

    addApiTrace(`resolveBestSubject: accepted "${candidate.title}" (subjectId ${subject.subjectId})`);
    return { item: candidate, detail, subjectId: String(subject.subjectId) };
  }

  addApiTrace(`resolveBestSubject: no candidate passed - reporting not found`);
  return null;
}

// Matches the page the "Watch Now"/search-result link actually points to on
// this domain (its own /moviesDetail/{detailPath}?id={subjectId} page),
// used as the Referer for the API calls below.
function buildWatchUrl(
  domain: string,
  detailPath: string,
  subjectId: string,
  season?: number | string,
  episode?: number | string,
): string {
  const params = new URLSearchParams({
    id: subjectId,
    detailSe: season != null ? String(season) : "",
    detailEp: episode != null ? String(episode) : "",
  });
  return `${domain}/moviesDetail/${detailPath}?${params.toString()}`;
}

// /subject/play strictly checks the Referer against the actual watch-page path
// (/movies/{detailPath}, singular - no "Detail" suffix), unlike /detail and
// /subject/download which don't care. Sending the /moviesDetail/ referer from
// buildWatchUrl here silently returns hasResource:false/empty streams instead
// of an error.
function buildPlayReferer(
  domain: string,
  detailPath: string,
  subjectId: string,
  season?: number | string,
  episode?: number | string,
): string {
  const params = new URLSearchParams({
    id: subjectId,
    detailSe: season != null ? String(season) : "",
    detailEp: episode != null ? String(episode) : "",
  });
  return `${domain}/movies/${detailPath}?${params.toString()}`;
}

// netfilm.world's own watch-page path, used as Referer for its /subject/download
// calls - a real captured browser request against this exact path pattern
// (/spa/videoPlayPage/movies/{detailPath}) returned hasResource:true with
// captions, so matched here rather than reusing themoviebox.org's referer shape.
function buildNetfilmReferer(
  detailPath: string,
  subjectId: string,
  season?: number | string,
  episode?: number | string,
): string {
  const params = new URLSearchParams({
    id: subjectId,
    detailSe: season != null ? String(season) : "",
    detailEp: episode != null ? String(episode) : "",
    lang: "en",
    type: "/movie/detail",
  });
  return `${NETFILM_BASE_URL}/spa/videoPlayPage/movies/${detailPath}?${params.toString()}`;
}

// Returns { subject, resource, ... } - subject.dubs is the language/dub/sub list,
// resource.seasons is the season/episode-count structure for series.
async function getSubjectDetail(
  detailPath: string,
  subjectId?: string,
  season?: number | string,
  episode?: number | string,
): Promise<any | null> {
  addApiTrace(`getSubjectDetail detailPath: "${detailPath}"`);
  const result = await fetchMovieBoxDomain(
    "getSubjectDetail",
    (domain) => `${domain}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`,
    (domain) => ({
      headers: getWeeedHeaders({
        origin: domain,
        referer: buildWatchUrl(domain, detailPath, subjectId ?? "", season, episode),
      }),
    }),
    (status, text) => {
      if (status !== 200) return false;
      try {
        return JSON.parse(text)?.code === 0;
      } catch {
        return false;
      }
    },
  );
  if (!result) {
    addApiTrace(`getSubjectDetail failed on all domains`);
    return null;
  }
  addApiTrace(`getSubjectDetail success`);
  return JSON.parse(result.text).data;
}

// Playable MP4 links come from /subject/play, which the site's own player
// calls and reliably returns real streams. /subject/download is a separate,
// less-consistently-populated resource pool for the same content - often
// hasResource:false even for titles that stream fine - but when it IS
// populated, it's the only endpoint that also returns real subtitle files
// (.srt with signed URLs); /subject/play has no captions field at all.
// So both are queried and merged: streams primarily from /subject/play,
// falling back to /subject/download's own downloads if /play has nothing,
// and captions always from /subject/download.
async function getDownloadData(
  subjectId: string,
  detailPath: string,
  season?: number | string,
  episode?: number | string,
): Promise<{ downloads: any[]; captions: any[] } | null> {
  const params = new URLSearchParams({
    subjectId,
    se: season != null ? String(season) : "0",
    ep: episode != null ? String(episode) : "0",
    detailPath,
  });

  const downloadUrl = `${NETFILM_BASE_URL}/wefeed-h5api-bff/subject/download?${params.toString()}`;
  addApiTrace(`getDownloadData subjectId: "${subjectId}", se: ${season}, ep: ${episode}`);

  const fetchJson = async (label: string, url: string, referer: string): Promise<any | null> => {
    try {
      const res = await moviebox_fetch(url, { headers: getWeeedHeaders({ referer }) });
      addApiTrace(`getDownloadData ${label} status: ${res.status}`);
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch (parseErr) {
        await saveResponse(`getDownloadData ${label} - PARSE ERROR`, { url, referer, status: res.status, rawText: text.slice(0, 2000) }, "subject/download");
        throw parseErr;
      }
      await saveResponse(`getDownloadData ${label}`, { url, referer, status: res.status, body: json }, "subject/download");
      if (json?.code !== 0) {
        addApiTrace(`getDownloadData ${label} non-zero code -> ${json?.code}: ${json?.message}`);
        return null;
      }
      return json.data;
    } catch (err: any) {
      addApiTrace(`getDownloadData ${label} exception -> ${err.message || err}`);
      return null;
    }
  };

  const fetchPlayJson = async (): Promise<any | null> => {
    const label = "play";
    const result = await fetchMovieBoxDomain(
      `getDownloadData ${label}`,
      (domain) => `${domain}/wefeed-h5api-bff/subject/play?${params.toString()}`,
      (domain) => ({
        headers: getWeeedHeaders({ referer: buildPlayReferer(domain, detailPath, subjectId, season, episode) }),
      }),
      (status, text) => {
        if (status !== 200) return false;
        try {
          return JSON.parse(text)?.code === 0;
        } catch {
          return false;
        }
      },
    );
    if (!result) {
      addApiTrace(`getDownloadData ${label} failed on all domains`);
      return null;
    }
    const json = JSON.parse(result.text);
    await saveResponse(`getDownloadData ${label}`, { domain: result.domain, status: result.status, body: json }, "subject/download");
    return json.data;
  };

  const [playData, downloadData] = await Promise.all([
    fetchPlayJson(),
    fetchJson("download", downloadUrl, buildNetfilmReferer(detailPath, subjectId, season, episode)),
  ]);

  const streams: any[] = playData?.streams ?? [];
  const fromPlay = streams.map((s) => ({
    id: s.id,
    resolution: s.resolutions,
    url: s.url,
    size: s.size,
    format: s.format,
  }));
  const fromDownload: any[] = downloadData?.downloads ?? [];
  const seenUrls = new Set(fromPlay.map((d) => d.url));
  const downloads = [...fromPlay, ...fromDownload.filter((d) => !seenUrls.has(d.url))];
  const captions: any[] = downloadData?.captions ?? [];

  addApiTrace(`getDownloadData success -> found ${downloads.length} download links, ${captions.length} captions`);
  return { downloads, captions };
}

function mapDownloadsToQualities(downloads: any[], language: string, languageLabel: string): QualityItem[] {
  return (downloads ?? [])
    .map((d) => ({
      id: String(d.id ?? d.url ?? ""),
      resolution: String(d.resolution ?? "auto"),
      url: String(d.url ?? ""),
      size: Number(d.size ?? 0) || 0,
      format: String(d.format ?? "mp4"),
      language,
      languageLabel,
    }))
    .filter((q) => q.url);
}

function mapCaptionsToSubtitles(captions: any[]): SubtitleItem[] {
  return (captions ?? [])
    .map((c) => {
      const langCode = String(c.lan ?? c.lang ?? c.language ?? "en");
      const label = String(c.lanName ?? getFriendlyLanguageName(langCode));
      return {
        url: String(c.url ?? ""),
        language: langCode,
        lang: normalizeLanguageCode(langCode) || "en",
        label,
      };
    })
    .filter((c) => c.url);
}

function mapDubsToLanguages(dubs: any[]): LanguageOption[] {
  return (dubs ?? []).map((d) => ({
    code: defaultString(String(d.lanCode ?? "").toLowerCase(), "en"),
    label: defaultString(d.lanName, "Original"),
    subjectId: String(d.subjectId),
    detailPath: String(d.detailPath),
    original: !!d.original,
  }));
}

function mapSeasonsResource(resource: any): {
  seasons: number[];
  episodesBySeason: Record<number, number>;
  totalEpisodes?: number;
} {
  const seasons: number[] = [];
  const episodesBySeason: Record<number, number> = {};
  let totalEpisodes = 0;

  for (const s of resource?.seasons ?? []) {
    const se = Number(s?.se);
    if (Number.isNaN(se)) continue;
    seasons.push(se);
    const maxEp = Number(s?.maxEp) || 1;
    episodesBySeason[se] = maxEp;
    totalEpisodes += maxEp;
  }
  seasons.sort((a, b) => a - b);
  return { seasons, episodesBySeason, totalEpisodes: totalEpisodes || undefined };
}

// MovieBox splits a TV series into one "subject" per season (or per season range,
// e.g. "Breaking Bad S1", "Avatar: The Last Airbender S1-S2") that all otherwise
// share the same subjectId/detailPath. Plain title matching can't tell these apart,
// so when a season is requested, prefer the search result whose title suffix
// actually names that season.
function extractSeasonRange(title: string): { start: number; end: number } | null {
  const match = title.match(/S(\d+)(?:-S(\d+))?\s*$/i);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  return { start, end };
}

function calculateMatchScore(currentTitle: string, targetTitle: string): number {
  if (currentTitle === targetTitle) return 100;
  if (currentTitle.includes(targetTitle) || targetTitle.includes(currentTitle)) return 80;
  const words1 = currentTitle.split(/\s+/);
  const words2 = targetTitle.split(/\s+/);
  const commonWords = words1.filter((w) => words2.includes(w)).length;
  return (commonWords / Math.max(words1.length, words2.length)) * 70;
}

interface SubjectCore {
  subjectId: string;
  detailPath: string;
  qualities: QualityItem[];
  captions: SubtitleItem[];
  languages: LanguageOption[];
  seasons?: number[];
  episodes?: number[];
  totalEpisodes?: number;
}

// Fetches everything MovieBox-side for a matched search result: playable
// links + subtitles (from /subject/download) and language variants + season
// structure (from /detail), in parallel. If the caller already fetched the
// detail payload (resolveBestSubject does, to check the release year), pass
// it as `prefetchedDetail` to skip a redundant second fetch of the same page.
async function buildSubjectCore(
  item: any,
  season?: number,
  episode?: number,
  prefetchedDetail?: any,
): Promise<SubjectCore | null> {
  const subjectId = String(item.subjectId);
  const detailPath = String(item.detailPath);

  const [downloadData, detail] = await Promise.all([
    getDownloadData(subjectId, detailPath, season, episode),
    prefetchedDetail !== undefined ? Promise.resolve(prefetchedDetail) : getSubjectDetail(detailPath, subjectId, season, episode),
  ]);

  if (!downloadData) return null;

  const languages = mapDubsToLanguages(detail?.subject?.dubs ?? []);
  const originalLang =
    languages.find((l) => l.original) ??
    languages[0] ?? { code: "en", label: "Original", subjectId, detailPath, original: true };

  const qualities = mapDownloadsToQualities(downloadData.downloads, originalLang.code, originalLang.label);
  const captions = mapCaptionsToSubtitles(downloadData.captions);
  const { seasons, episodesBySeason, totalEpisodes } = mapSeasonsResource(detail?.resource);

  return {
    subjectId,
    detailPath,
    qualities,
    captions,
    languages,
    seasons: seasons.length ? seasons : undefined,
    episodes:
      season != null && episodesBySeason[season]
        ? Array.from({ length: episodesBySeason[season] }, (_, i) => i + 1)
        : undefined,
    totalEpisodes,
  };
}

export async function fetchMovieByTmdb(tmdbId: number): Promise<MediaResult | null> {
  const tmdb = await tmdbInfo("movie", tmdbId);
  if (!tmdb) return null;

  const title = tmdb.title ?? "";
  const year = (tmdb.release_date as string | undefined)?.split("-")[0] ?? null;
  // Search by title alone - disambiguation happens later via each candidate's
  // real releaseDate (see resolveBestSubject), so the year isn't needed here.
  const html = await searchMovieBoxHtml(title);
  if (!html) return null;

  const results = extractMovieBoxResults(html, title);
  if (!results.length) return null;

  const resolved = await resolveBestSubject(results, title, year);
  if (!resolved) return null;

  const core = await buildSubjectCore(
    { subjectId: resolved.subjectId, detailPath: resolved.item.detailPath },
    undefined,
    undefined,
    resolved.detail,
  );
  if (!core) return null;

  return {
    title,
    year,
    subjectId: core.subjectId,
    detailPath: core.detailPath,
    poster: tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : undefined,
    backdrop: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : undefined,
    overview: tmdb.overview,
    rating: typeof tmdb.vote_average === "number" ? tmdb.vote_average : undefined,
    genres: Array.isArray(tmdb.genres) ? tmdb.genres.map((g: any) => g.name).filter(Boolean) : [],
    runtime: typeof tmdb.runtime === "number" ? tmdb.runtime : undefined,
    qualities: core.qualities,
    captions: core.captions,
    languages: core.languages,
  };
}

export async function fetchTvByTmdb(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<MediaResult | null> {
  const tmdb = await tmdbInfo("tv", tmdbId);
  if (!tmdb) return null;

  const title = tmdb.name ?? "";
  const year = (tmdb.first_air_date as string | undefined)?.split("-")[0] ?? null;
  const html = await searchMovieBoxHtml(title);
  if (!html) return null;

  const results = extractMovieBoxResults(html, title);
  if (!results.length) return null;

  const resolved = await resolveBestSubject(results, title, year, season);
  if (!resolved) return null;

  const core = await buildSubjectCore(
    { subjectId: resolved.subjectId, detailPath: resolved.item.detailPath },
    season,
    episode,
    resolved.detail,
  );
  if (!core) return null;

  return {
    title,
    year,
    subjectId: core.subjectId,
    detailPath: core.detailPath,
    poster: tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : undefined,
    backdrop: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : undefined,
    overview: tmdb.overview,
    rating: typeof tmdb.vote_average === "number" ? tmdb.vote_average : undefined,
    genres: Array.isArray(tmdb.genres) ? tmdb.genres.map((g: any) => g.name).filter(Boolean) : [],
    runtime:
      Array.isArray(tmdb.episode_run_time) && tmdb.episode_run_time[0]
        ? tmdb.episode_run_time[0]
        : undefined,
    qualities: core.qualities,
    captions: core.captions,
    languages: core.languages,
    seasons: core.seasons,
    episodes: core.episodes,
    totalEpisodes: core.totalEpisodes,
  };
}

// Re-runs the download lookup for a specific language/dub variant (its own
// subjectId + detailPath, from a MediaResult's `languages` list), returning
// qualities and captions together so the caller can update both atomically -
// on failure it returns null and the caller should leave the previous
// qualities/captions untouched rather than clearing them.
export async function fetchLanguageQualities(
  languageSubjectId: string,
  languageDetailPath: string,
  season: number,
  episode: number,
  languageCode: string,
  languageLabel: string,
): Promise<{ qualities: QualityItem[]; captions: SubtitleItem[] } | null> {
  const downloadData = await getDownloadData(languageSubjectId, languageDetailPath, season, episode);
  if (!downloadData) return null;

  return {
    qualities: mapDownloadsToQualities(downloadData.downloads, languageCode, languageLabel),
    captions: mapCaptionsToSubtitles(downloadData.captions),
  };
}

// AniList GraphQL Metadata Lookup
async function fetchFromAniList(anilistId: number): Promise<any> {
  const query = `
    query ($id: Int) {
      Media (id: $id, type: ANIME) {
        id
        title { romaji english native }
        coverImage { extraLarge large medium color }
        bannerImage
        description
        seasonYear
        episodes
        genres
        averageScore
      }
    }
  `;

  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { id: anilistId } }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.Media ?? null;
  } catch {
    return null;
  }
}

export async function fetchAnimeByAnilist(anilistId: number, episode: number): Promise<MediaResult | null> {
  const animeMeta = await fetchFromAniList(anilistId);
  if (!animeMeta) return null;

  const title = animeMeta.title.english || animeMeta.title.romaji || animeMeta.title.native || "";
  const year = animeMeta.seasonYear ? String(animeMeta.seasonYear) : null;

  const html = await searchMovieBoxHtml(title);
  if (!html) return null;

  const results = extractMovieBoxResults(html, title);
  if (!results.length) return null;

  // AniList IDs represent a single season (season 1) in MovieBox's catalog
  const resolved = await resolveBestSubject(results, title, year, 1);
  if (!resolved) return null;

  const core = await buildSubjectCore(
    { subjectId: resolved.subjectId, detailPath: resolved.item.detailPath },
    1,
    episode,
    resolved.detail,
  );
  if (!core) return null;

  const totalEpisodes = animeMeta.episodes || core.totalEpisodes;

  return {
    title,
    year,
    subjectId: core.subjectId,
    detailPath: core.detailPath,
    poster: animeMeta.coverImage?.extraLarge || animeMeta.coverImage?.large || undefined,
    backdrop: animeMeta.bannerImage || undefined,
    overview: animeMeta.description ? animeMeta.description.replace(/<[^>]*>/g, "") : undefined,
    rating: animeMeta.averageScore ? animeMeta.averageScore / 10 : undefined,
    genres: Array.isArray(animeMeta.genres) ? animeMeta.genres : [],
    qualities: core.qualities,
    captions: core.captions,
    languages: core.languages,
    seasons: core.seasons ?? [1],
    episodes: core.episodes ?? [1],
    totalEpisodes,
  };
}

// =============================================================================
// Legacy api3/api6.aoneroom.com HMAC-signed mobile gateway.
//
// Kept only for short-drama, whose subjectType isn't confirmed to exist on the
// wefeed-h5api-bff search above (it returned zero results for every subjectType
// tried), and for generateServerJwt, which is a separate auth system scoped to
// this gateway - not interchangeable with the guest token above.
// =============================================================================

const GATEWAY_SECRET = process.env.GATEWAY_SECRET ?? "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const BOTTOM_TAB_URL = "https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/bottom-tab";
const BOTTOM_TAB_CLIENT_TOKEN =
  process.env.BOTTOM_TAB_CLIENT_TOKEN ?? "1782204604620,cea850d15d46b9b316c073ba0ad05f2f";
const SIGN_METHOD = "HmacMD5";

let cachedServerJwt: string | null = null;
let cachedServerJwtPromise: Promise<string> | null = null;

let cachedDevice = {
  deviceId: "",
  gaid: "",
  timestamp: 0,
};

function getDeviceCredentials() {
  const now = Date.now();
  if (!cachedDevice.deviceId || now - cachedDevice.timestamp > 43200000) {
    cachedDevice = {
      deviceId: crypto.randomBytes(16).toString("hex"),
      gaid: [
        crypto.randomBytes(4).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(2).toString("hex"),
        crypto.randomBytes(6).toString("hex"),
      ].join("-"),
      timestamp: now,
    };
  }
  return cachedDevice;
}

function normalizeQuery(qs: string): string {
  if (!qs) return "";
  const pairs: [string, string][] = [];
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = idx === -1 ? pair : pair.slice(0, idx);
    const val = idx === -1 ? "" : pair.slice(idx + 1);
    try {
      pairs.push([decodeURIComponent(key), decodeURIComponent(val)]);
    } catch {
      pairs.push([key, val]);
    }
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function bodyMd5(body: string): string {
  if (!body) return "";
  const buf = Buffer.from(body, "utf8");
  const chunk = buf.length > 102400 ? buf.subarray(0, 102400) : buf;
  return crypto.createHash("md5").update(chunk).digest("hex");
}

function buildCanonical(
  method: string,
  headers: Record<string, string>,
  body: string,
  fullUrl: string,
  ts: number,
): string {
  const u = new URL(fullUrl);
  const accept = headers["accept"] ?? "";
  const contentType = headers["content-type"] ?? "";
  let contentLength = headers["content-length"] ?? "";
  if (!contentLength && body) {
    contentLength = String(Buffer.byteLength(body, "utf8"));
  }
  if (method.toUpperCase() === "GET" && !body) contentLength = "";
  const md5 = bodyMd5(body);
  const normalizedQuery = normalizeQuery(u.search.replace(/^\?/, ""));
  const pathUrl = u.pathname + (normalizedQuery ? `?${normalizedQuery}` : "");
  return [method.toUpperCase(), accept, contentType, contentLength, String(ts), md5, pathUrl].join("\n");
}

function sign(secretB64: string, canonical: string): string {
  let key: Buffer;
  if (/^[A-Za-z0-9+/=]+$/.test(secretB64) && secretB64.length % 4 === 0) {
    try {
      key = Buffer.from(secretB64, "base64");
    } catch {
      key = Buffer.from(secretB64, "utf8");
    }
  } else {
    key = Buffer.from(secretB64, "utf8");
  }
  const h = crypto.createHmac("md5", key);
  h.update(canonical, "utf8");
  return h.digest("base64");
}

function makeXTr(method: string, url: string, headers: Record<string, string>, body: string): string {
  const ts = Date.now();
  const canonical = buildCanonical(method, headers, body, url, ts);
  return `${ts}|2|${sign(GATEWAY_SECRET, canonical)}`;
}

function bottomTabHeaders(): Record<string, string> {
  const device = getDeviceCredentials();
  return {
    accept: "*/*",
    "accept-encoding": "gzip, deflate, br",
    connection: "keep-alive",
    host: "api3.aoneroom.com",
    "user-agent":
      "com.community.mbox.in.geobypass/51042203 (Linux; U; Android 7.1.2; en_US; SM-G955N; Build/NRD90M.G955NKSU1AQDC; Cronet/104.0.5112.46)",
    "x-client-info": JSON.stringify({
      package_name: "com.community.mbox.in.geobypass",
      version_name: "3.0.14.0422.03",
      version_code: 51042203,
      os: "android",
      os_version: "7.1.2",
      device_id: device.deviceId,
      install_store: "gp",
      gaid: device.gaid,
      brand: "samsung",
      model: "SM-G955N",
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "US",
      timezone: "Africa/Brazzaville",
      sp_code: "20801",
      "X-Play-Mode": "2",
      "X-Family-Mode": "0",
    }),
    "x-client-status": "0",
    "x-client-token": BOTTOM_TAB_CLIENT_TOKEN,
    "x-family-mode": "0",
    "x-play-mode": "2",
  };
}

function formatAuthorizationToken(raw: string): string {
  return raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
}

async function fetchServerJwt(bottomTabUrl: string): Promise<string | null> {
  const method = "GET";
  const headers = bottomTabHeaders();
  headers["x-tr-signature"] = makeXTr(method, bottomTabUrl, headers, "");
  headers["x-tr-signature-method"] = SIGN_METHOD;

  const res = await fetch(bottomTabUrl, { method, headers });
  const xuser = res.headers.get("x-user") || res.headers.get("X-User") || null;
  if (!xuser) return null;

  try {
    const parsed = JSON.parse(xuser);
    if (parsed && parsed.token) return String(parsed.token);
  } catch {
    try {
      const reparsed = JSON.parse(decodeURIComponent(xuser));
      if (reparsed && reparsed.token) return String(reparsed.token);
    } catch {
      // ignore and return raw header
    }
  }
  return xuser;
}

function invalidateServerJwt(): void {
  cachedServerJwt = null;
  cachedServerJwtPromise = null;
}

async function getServerJwt(): Promise<string> {
  if (cachedServerJwt) return cachedServerJwt;
  if (cachedServerJwtPromise) return cachedServerJwtPromise;

  cachedServerJwtPromise = (async () => {
    const token = await fetchServerJwt(BOTTOM_TAB_URL);
    cachedServerJwtPromise = null;
    if (!token) {
      throw new Error("Unable to obtain fresh server JWT from bottom-tab endpoint");
    }
    cachedServerJwt = formatAuthorizationToken(token);
    return cachedServerJwt;
  })();

  return cachedServerJwtPromise;
}

export async function generateServerJwt(): Promise<string> {
  invalidateServerJwt();
  return getServerJwt();
}

function commonHeaders(authorizationToken: string): Record<string, string> {
  const device = getDeviceCredentials();
  return {
    accept: "*/*",
    authorization: authorizationToken,
    "accept-encoding": "gzip, deflate, br",
    connection: "keep-alive",
    "user-agent":
      "com.community.mbox.in.geobypass/51042203 (Linux; U; Android 7.1.2; en_US; SM-G955N; Build/NRD90M.G955NKSU1AQDC; Cronet/104.0.5112.46)",
    "x-client-info": JSON.stringify({
      package_name: "com.community.mbox.in.geobypass",
      version_name: "3.0.14.0422.03",
      version_code: 51042203,
      os: "android",
      os_version: "7.1.2",
      install_ch: "google-play",
      device_id: device.deviceId,
      install_store: "gp",
      gaid: device.gaid,
      brand: "samsung",
      model: "SM-G955N",
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "US",
      timezone: "Africa/Brazzaville",
      sp_code: "20801",
      "X-Play-Mode": "2",
      "X-Family-Mode": "0",
    }),
    "x-client-status": "0",
    "x-family-mode": "0",
    "x-play-mode": "2",
  };
}

async function gatewayRequest(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<any> {
  try {
    const authToken = await getServerJwt();
    const all: Record<string, string> = { ...commonHeaders(authToken), ...(opts.headers ?? {}) };
    if (opts.body && !all["content-type"]) {
      all["content-type"] = "application/json; charset=utf-8";
    }
    all["x-tr-signature"] = makeXTr(method, url, all, opts.body ?? "");
    all["x-tr-signature-method"] = SIGN_METHOD;

    let res = await fetch(url, {
      method,
      headers: all,
      body: method.toUpperCase() === "GET" ? undefined : opts.body,
    });

    if (res.status === 401 || res.status === 403) {
      invalidateServerJwt();
      const retryToken = await getServerJwt();
      all.authorization = retryToken;
      all["x-tr-signature"] = makeXTr(method, url, all, opts.body ?? "");
      res = await fetch(url, {
        method,
        headers: all,
        body: method.toUpperCase() === "GET" ? undefined : opts.body,
      });
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { code: -1, message: "parse error", raw: text };
    }
  } catch (error) {
    // Network failure (timeout, JWT bootstrap failed, etc). Degrade to a
    // non-zero code instead of letting this throw crash the whole SSR
    // request - callers already treat any `code !== 0` as "not found".
    animeLog("gatewayRequest network error", error);
    return { code: -1, message: error instanceof Error ? error.message : "network error" };
  }
}

async function gatewaySearch(keyword: string, page = 1, perPage = 10) {
  return gatewayRequest("POST", "https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2", {
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ page, perPage, keyword }),
  });
}

async function gatewayGetSubject(subjectId: string) {
  return gatewayRequest(
    "GET",
    `https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`,
  );
}

async function gatewayGetDubInfo(subjectId: string) {
  return gatewayRequest(
    "GET",
    `https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/dub-info?subjectId=${encodeURIComponent(subjectId)}`,
  );
}

async function gatewayGetResource(subjectId: string, query: Record<string, string>) {
  const params = { all: "0", page: "1", perPage: "5", ...query, subjectId };
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const response = await gatewayRequest(
    "GET",
    `https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/resource?${qs}`,
  );
  await saveResponse("Resource Endpoint Response", response, "resource");
  return response;
}

interface LegacySubjectInfo {
  subjectId: string;
  language: string;
  languageLabel: string;
}

function extractQualities(list: any[], defaultLanguage = "en", defaultLanguageLabel = "Original"): QualityItem[] {
  const groups = new Map<string, QualityItem>();
  for (const item of list ?? []) {
    if (!item || typeof item !== "object") continue;
    const url = item.url ?? item.resourceLink ?? item.resourcePath ?? item.link ?? "";
    if (!url) continue;
    const id = String(item.id ?? item.qualityId ?? item.resourceId ?? item.videoId ?? item.rid ?? "");
    const res = String(item.resolution ?? item.source ?? "");
    const lang = String(item._subjectLang ?? item.lang ?? item.language ?? "");
    const langLabel = String(
      item._subjectLangLabel ?? item.dubLanName ?? item.langName ?? item.lang ?? item.language ?? "",
    );
    const resolution = res ? `${res}` : "auto";
    const language = defaultString(lang, defaultLanguage);
    const languageLabel = defaultString(langLabel, defaultLanguageLabel);
    const quality: QualityItem = {
      id,
      resolution,
      url,
      size: Number(item.size ?? 0) || 0,
      format: String(item.format ?? "mp4"),
      language,
      languageLabel,
    };
    const key = `${resolution}|${language}`;
    const existing = groups.get(key);
    if (!existing || quality.size > existing.size) {
      groups.set(key, quality);
    }
  }
  const out = Array.from(groups.values());
  out.sort((a, b) => {
    const aNum = parseInt(a.resolution);
    const bNum = parseInt(b.resolution);
    if (!isNaN(aNum) && !isNaN(bNum)) return bNum - aNum;
    return b.resolution.localeCompare(a.resolution);
  });
  return out;
}

function parseDubInfoItems(data: unknown): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.list)) return obj.list as any[];
  if (Array.isArray(obj.dubList)) return obj.dubList as any[];
  if (Array.isArray(obj.dubs)) return obj.dubs as any[];
  if (Array.isArray(obj.data)) return obj.data as any[];
  return [];
}

function parseResourceItems(data: unknown): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  const items: any[] = [];
  const pushArray = (candidate: unknown) => {
    if (Array.isArray(candidate)) items.push(...(candidate as any[]));
  };
  pushArray(obj.list);
  pushArray(obj.data);
  pushArray(obj.resolutionList);
  if (Array.isArray(obj.resourceDetectors)) {
    for (const detector of obj.resourceDetectors as any[]) {
      if (!detector || typeof detector !== "object") continue;
      pushArray(detector.resolutionList);
      pushArray(detector.list);
      if ((detector as any).resourceLink || (detector as any).url) {
        items.push(detector);
      }
    }
  }
  return items;
}

async function fetchSubjectQualities(
  subject: LegacySubjectInfo,
  baseQuery: Record<string, string>,
  subjectDetails?: any,
): Promise<QualityItem[]> {
  const rawItems: any[] = [];
  const tag = (item: any) => ({ ...item, _subjectLang: subject.language, _subjectLangLabel: subject.languageLabel });

  const resolutions = ["360", "480", "720", "1080"];

  // These calls are all independent of each other (default resource list, dub
  // info, and one resource lookup per resolution) so fire them all in
  // parallel instead of awaiting one at a time.
  const [resourceResponse, dubResponse, ...resolutionResponses] = await Promise.all([
    gatewayGetResource(subject.subjectId, baseQuery),
    gatewayGetDubInfo(subject.subjectId).catch(() => null),
    ...resolutions.map((resolution) =>
      gatewayGetResource(subject.subjectId, { ...baseQuery, resolution }).catch(() => null),
    ),
  ]);

  const resourceItems = parseResourceItems(resourceResponse?.data ?? resourceResponse);
  if (resourceItems.length) rawItems.push(...resourceItems.map(tag));

  const dubItems = parseDubInfoItems(dubResponse?.data ?? dubResponse);
  if (dubItems.length) rawItems.push(...dubItems.map(tag));

  const seenRes = new Set<string>();
  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutionResponses[i];
    if (!res || res.code !== 0) continue;
    const list = res?.data?.list as any[] | undefined;
    if (!list) continue;
    for (const item of list) {
      const itemRes = String(item.resolution ?? "");
      if (itemRes && !seenRes.has(itemRes)) {
        seenRes.add(itemRes);
        rawItems.push(tag(item));
      }
    }
  }

  if (rawItems.length === 0 && subjectDetails) {
    const fallbackItems = parseResourceItems(subjectDetails);
    if (fallbackItems.length) rawItems.push(...fallbackItems.map(tag));
  }

  return extractQualities(rawItems, subject.language, subject.languageLabel);
}

// Short-drama-only: unlike movies/TV/anime, short drama still runs on the legacy
// api3/api6.aoneroom.com gateway, so its language variants are subjectIds on that
// system, not wefeed-h5api-bff ones. This mirrors what the exported
// fetchLanguageQualities used to do before it was repointed at the new backend -
// keep the two separate rather than routing short drama's ids into the wrong API.
export async function fetchShortDramaLanguageQualities(
  languageSubjectId: string,
  season: number,
  episode: number,
  languageCode: string,
  languageLabel: string,
): Promise<QualityItem[] | null> {
  const baseQuery: Record<string, string> = {
    all: "0",
    page: "1",
    perPage: "5",
    se: String(season),
    ep: String(episode),
    epFrom: String(episode),
    epTo: String(episode),
    startPosition: String(episode),
    endPosition: String(episode),
    pagerMode: "2",
  };

  try {
    const subjectData = await gatewayGetSubject(languageSubjectId);
    return await fetchSubjectQualities(
      { subjectId: languageSubjectId, language: languageCode, languageLabel },
      baseQuery,
      subjectData?.data ?? subjectData,
    );
  } catch {
    return null;
  }
}

function getSeasonList(data: any): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.seasonList)) return data.seasonList;
  if (Array.isArray(data.seasons)) return data.seasons;
  if (Array.isArray(data.list)) return data.list;
  const seasonData = data.season ?? data.data?.season ?? data.seasonData ?? data.data?.seasonData;
  if (seasonData && typeof seasonData === "object") {
    if (Array.isArray(seasonData.seasons)) return seasonData.seasons;
    if (Array.isArray(seasonData.seasonList)) return seasonData.seasonList;
    if (Array.isArray(seasonData.list)) return seasonData.list;
  }
  return [];
}

function normalizeSeasonInfo(data: any): { seasons: number[]; episodesBySeason: Record<number, number> } {
  const seasons: number[] = [];
  const episodesBySeason: Record<number, number> = {};
  const list = getSeasonList(data);
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const seasonNo = Number(
      item.seasonNo ?? item.season ?? item.se ?? item.seasonId ?? item.seasonNumber ?? item.seasonIndex ?? 0,
    );
    if (!seasonNo || seasons.includes(seasonNo)) continue;
    seasons.push(seasonNo);
    const count = Number(
      item.episodeCount ?? item.epCount ?? item.episodes ?? item.ep ?? item.maxEp ?? item.maxEpisode ?? 0,
    );
    episodesBySeason[seasonNo] = count > 0 ? count : 1;
  }
  seasons.sort((a, b) => a - b);
  return { seasons, episodesBySeason };
}

function normalizeShortDramaSubject(subject: any) {
  return {
    subjectId: String(subject.subjectId ?? subject.id ?? ""),
    title: String(subject.title ?? subject.name ?? "Unknown"),
    corner: String(subject.corner ?? ""),
    lang: String(subject.lang ?? subject.language ?? ""),
    poster: subject.cover?.url ?? subject.image ?? subject.poster ?? undefined,
    year: String(subject.releaseDate ?? subject.firstAired ?? "")?.split("-")[0] || undefined,
    overview: String(subject.description ?? subject.detail ?? ""),
  };
}

export async function fetchShortDramaSearch(title: string): Promise<
  Array<{
    subjectId: string;
    title: string;
    corner: string;
    lang: string;
    poster?: string;
    year?: string;
    overview?: string;
  }>
> {
  const search = await gatewaySearch(title);
  if (search?.code !== 0) return [];
  const subjects: any[] = [];
  for (const r of search?.data?.results ?? []) {
    if (Array.isArray(r.subjects)) subjects.push(...r.subjects);
  }
  return subjects
    .filter((s) => s?.subjectType === 7)
    .map(normalizeShortDramaSubject)
    .filter((s) => s.subjectId);
}

export async function fetchShortDramaEpisode(
  subjectId: string,
  season: number,
  episode: number,
): Promise<MediaResult | null> {
  const subjectData = await gatewayGetSubject(subjectId);
  const sub = subjectData?.data?.subject ?? subjectData?.data ?? {};

  const subjectInfos: LegacySubjectInfo[] = [];
  if (Array.isArray(sub.dubs) && sub.dubs.length > 0) {
    for (const dub of sub.dubs) {
      subjectInfos.push({
        subjectId: String(dub.subjectId),
        language: defaultString(dub.lanCode?.toLowerCase(), "original"),
        languageLabel: defaultString(dub.lanName, "Original"),
      });
    }
  } else {
    subjectInfos.push({ subjectId: String(subjectId), language: "original", languageLabel: "Original" });
  }

  const baseQuery: Record<string, string> = {
    all: "0",
    page: "1",
    perPage: "5",
    se: String(season),
    ep: String(episode),
    epFrom: String(episode),
    epTo: String(episode),
    startPosition: String(episode),
    endPosition: String(episode),
    pagerMode: "2",
  };

  const fetchedQualities = await Promise.all(
    subjectInfos.map((subject) => fetchSubjectQualities(subject, baseQuery, subjectData?.data ?? subjectData)),
  );
  const defaultQualities = fetchedQualities[0] ?? [];

  const { seasons, episodesBySeason } = normalizeSeasonInfo(sub);
  const languages: LanguageOption[] = subjectInfos.map((s, i) => ({
    code: s.language,
    label: s.languageLabel,
    subjectId: s.subjectId,
    detailPath: "",
    original: i === 0,
  }));

  const totalEpisodes = subjectData?.data?.resourceDetectors?.[0]?.totalEpisode || undefined;

  let finalSeasons = seasons;
  let finalEpisodesBySeason = episodesBySeason;
  if (!finalSeasons.length && totalEpisodes) {
    finalSeasons = [1];
    finalEpisodesBySeason = { 1: totalEpisodes };
  } else if (!finalSeasons.length) {
    finalSeasons = [1];
    finalEpisodesBySeason = { 1: 1 };
  }

  return {
    title: String(sub?.title ?? sub?.name ?? sub?.subjectName ?? "Short Drama"),
    year: String(sub?.releaseDate ?? sub?.firstAirDate ?? "")?.split("-")[0] || null,
    subjectId,
    detailPath: "",
    poster: sub?.cover?.url ?? sub?.image ?? undefined,
    backdrop: sub?.background?.url ?? sub?.backdrop ?? undefined,
    overview: String(sub?.description ?? sub?.detail ?? ""),
    rating: typeof sub?.rating === "number" ? sub.rating : undefined,
    genres: Array.isArray(sub?.genres) ? sub.genres.map((g: any) => g.name).filter(Boolean) : [],
    runtime: typeof sub?.runtime === "number" ? sub.runtime : undefined,
    qualities: defaultQualities,
    captions: [],
    languages,
    seasons: finalSeasons,
    episodes: finalSeasons.length ? Array.from({ length: finalEpisodesBySeason[season] ?? 1 }, (_, i) => i + 1) : [1],
    totalEpisodes,
  };
}

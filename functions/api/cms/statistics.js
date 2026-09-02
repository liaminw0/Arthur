import { CmsError, envValue, errorResponse, requireSession, response } from "./_http.js";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const INTERESTING_PAGES = new Set(["/", "/nieuwsbrief/", "/snippets/", "/over-mij/"]);

function providerError(errors) {
  const message = (errors || []).map(error => String(error?.message || "").trim()).find(Boolean);
  return message ? message.replace(/\s+/g, " ").slice(0, 400) : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function total(groups, field) {
  return (groups || []).reduce((sum, group) => sum + number(field === "count" ? group.count : group.sum?.[field]), 0);
}

function top(groups, dimension) {
  return (groups || []).map(group => ({ label: String(group.dimensions?.[dimension] || "Onbekend"), value: number(group.count) })).filter(item => item.value > 0).sort((left, right) => right.value - left.value).slice(0, 10);
}

function analyticsField(alias, hostname, since, until) {
  const filter = `filter: {datetime_geq: ${JSON.stringify(since)}, datetime_lt: ${JSON.stringify(until)}, clientRequestHTTPHost: ${JSON.stringify(hostname)}, requestSource: \"eyeball\", OR: [{clientRequestPath: \"/\"}, {clientRequestPath: \"/nieuwsbrief/\"}, {clientRequestPath: \"/snippets/\"}, {clientRequestPath: \"/over-mij/\"}, {clientRequestPath_like: \"/snippets/%\"}]}`;
  return `${alias}: httpRequestsAdaptiveGroups(limit: 1000, orderBy: [count_DESC], ${filter}) {
      count
      sum { visits edgeResponseBytes }
      dimensions { date clientRequestPath clientCountryName }
    }`;
}

export function analyticsBatchQuery(zoneId, hostname, ranges) {
  return `query { viewer { zones(filter: {zoneTag: ${JSON.stringify(zoneId)}}) {
    ${ranges.map((range, index) => analyticsField(`day${index}`, hostname, range.since, range.until)).join("\n    ")}
  } } }`;
}

export function analyticsQuery(zoneId, hostname, since, until) {
  return analyticsBatchQuery(zoneId, hostname, [{ since, until }]);
}

export function dailyRanges(since, until) {
  const ranges = [];
  const end = new Date(until).getTime();
  for (let start = new Date(since).getTime(); start < end; start += 86_400_000) {
    ranges.push({ since: new Date(start).toISOString(), until: new Date(Math.min(start + 86_400_000, end)).toISOString() });
  }
  return ranges;
}

export function isInterestingPage(path) {
  return INTERESTING_PAGES.has(path) || /^\/snippets\/[a-z0-9][a-z0-9-]*\/$/.test(path);
}

export function mergeAnalyticsZones(zones) {
  const totals = { count: 0, visits: 0, bandwidth: 0 };
  const daily = new Map();
  const pages = new Map();
  const countries = new Map();
  for (const zone of zones) {
    for (const group of zone?.pageStats || []) {
      const path = String(group.dimensions?.clientRequestPath || "");
      if (!isInterestingPage(path)) continue;
      const date = String(group.dimensions?.date || "");
      const current = daily.get(date) || { count: 0, visits: 0 };
      current.count += number(group.count);
      current.visits += number(group.sum?.visits);
      daily.set(date, current);
      totals.count += number(group.count);
      totals.visits += number(group.sum?.visits);
      totals.bandwidth += number(group.sum?.edgeResponseBytes);
      pages.set(path, (pages.get(path) || 0) + number(group.count));
      const country = String(group.dimensions?.clientCountryName || "Onbekend");
      countries.set(country, (countries.get(country) || 0) + number(group.count));
    }
  }
  return {
    totals: [{ count: totals.count, sum: { visits: totals.visits, edgeResponseBytes: totals.bandwidth } }],
    daily: [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({ count: values.count, sum: { visits: values.visits }, dimensions: { date } })),
    pages: [...pages].map(([path, count]) => ({ count, dimensions: { clientRequestPath: path } })),
    countries: [...countries].map(([country, count]) => ({ count, dimensions: { clientCountryName: country } })),
  };
}

async function fetchAnalyticsZones(token, zoneId, hostname, ranges) {
  const query = analyticsBatchQuery(zoneId, hostname, ranges);
  const result = await fetch(GRAPHQL_ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const range = { since: ranges[0].since, until: ranges.at(-1).until };
  if (!result.ok) {
    let message = "";
    try { message = providerError((await result.clone().json()).errors); } catch { /* Cloudflare did not return JSON */ }
    console.error("Cloudflare Analytics HTTP error", { status: result.status, message, ...range });
    throw new CmsError(`Cloudflare-statistieken konden niet worden opgehaald (HTTP ${result.status})${message ? `: ${message}` : "."}`, 424, "analytics_error");
  }
  const data = await result.json();
  if (data.errors?.length) {
    const message = providerError(data.errors);
    console.error("Cloudflare Analytics error", { messages: data.errors.map(error => error.message), ...range });
    throw new CmsError(`Cloudflare heeft de statistiekenquery geweigerd${message ? `: ${message}` : "."}`, 424, "analytics_query_error");
  }
  const zone = data.data?.viewer?.zones?.[0];
  if (!zone) throw new CmsError("Cloudflare heeft geen statistieken voor deze zone teruggegeven.", 404, "analytics_not_found");
  return ranges.map((_, index) => ({ pageStats: zone[`day${index}`] || [] }));
}

async function fetchDailyZones(token, zoneId, hostname, ranges) {
  const batches = [];
  for (let index = 0; index < ranges.length; index += 5) batches.push(ranges.slice(index, index + 5));
  return (await Promise.all(batches.map(batch => fetchAnalyticsZones(token, zoneId, hostname, batch)))).flat();
}

export function normalizeStatistics(zone, period, since, until) {
  const totals = zone?.totals || [];
  const dailyValues = new Map((zone?.daily || []).map(group => [String(group.dimensions?.date || ""), { visits: number(group.sum?.visits), requests: number(group.count) }]));
  const daily = [];
  const date = new Date(`${since.slice(0, 10)}T00:00:00Z`);
  for (let index = 0; index < period; index += 1) {
    const key = date.toISOString().slice(0, 10);
    daily.push({ date: key, ...(dailyValues.get(key) || { visits: 0, requests: 0 }) });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return {
    period, since, until,
    totals: { visits: total(totals, "visits"), requests: total(totals, "count"), bandwidth: total(totals, "edgeResponseBytes") },
    daily,
    pages: top(zone?.pages, "clientRequestPath").filter(item => !item.label.startsWith("/cdn-cgi/")),
    countries: top(zone?.countries, "clientCountryName"),
  };
}

export async function onRequestGet(context) {
  try {
    await requireSession(context);
    const period = 7;
    const untilDate = new Date();
    const sinceDate = new Date(untilDate);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - period + 1);
    sinceDate.setUTCHours(0, 0, 0, 0);
    const since = sinceDate.toISOString();
    const until = untilDate.toISOString();
    const token = envValue(context.env, "CLOUDFLARE_ANALYTICS_TOKEN");
    const zoneId = envValue(context.env, "CLOUDFLARE_ZONE_ID");
    const hostname = String(context.env.CLOUDFLARE_SITE_HOST || "art-hov.blog");
    const zone = mergeAnalyticsZones(await fetchDailyZones(token, zoneId, hostname, dailyRanges(since, until)));
    return response({ ok: true, statistics: normalizeStatistics(zone, period, since, until) });
  } catch (error) { return errorResponse(error); }
}

import { CmsError, envValue, errorResponse, requireSession, response } from "./_http.js";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function total(groups, field) {
  return (groups || []).reduce((sum, group) => sum + number(field === "count" ? group.count : group.sum?.[field]), 0);
}

function top(groups, dimension) {
  return (groups || []).map(group => ({ label: String(group.dimensions?.[dimension] || "Onbekend"), value: number(group.count) })).filter(item => item.value > 0);
}

function analyticsQuery(zoneId, hostname, since, until) {
  const filter = `filter: {datetime_geq: ${JSON.stringify(since)}, datetime_lt: ${JSON.stringify(until)}, clientRequestHTTPHost: ${JSON.stringify(hostname)}, requestSource: \"eyeball\"}`;
  const pageFilter = `filter: {datetime_geq: ${JSON.stringify(since)}, datetime_lt: ${JSON.stringify(until)}, clientRequestHTTPHost: ${JSON.stringify(hostname)}, requestSource: \"eyeball\", edgeResponseContentTypeName: \"html\"}`;
  return `query { viewer { zones(filter: {zoneTag: ${JSON.stringify(zoneId)}}) {
    totals: httpRequestsAdaptiveGroups(limit: 1, ${filter}) { count sum { visits edgeResponseBytes } }
    daily: httpRequestsAdaptiveGroups(limit: 31, orderBy: [datetimeDay_ASC], ${filter}) { count sum { visits } dimensions { datetimeDay } }
    pages: httpRequestsAdaptiveGroups(limit: 10, orderBy: [count_DESC], ${pageFilter}) { count dimensions { clientRequestPath } }
    countries: httpRequestsAdaptiveGroups(limit: 10, orderBy: [count_DESC], ${filter}) { count dimensions { clientCountryName } }
  } } }`;
}

export function normalizeStatistics(zone, period, since, until) {
  const totals = zone?.totals || [];
  const dailyValues = new Map((zone?.daily || []).map(group => [String(group.dimensions?.datetimeDay || ""), { visits: number(group.sum?.visits), requests: number(group.count) }]));
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
    const requestedPeriod = Number(new URL(context.request.url).searchParams.get("days"));
    const period = requestedPeriod === 7 ? 7 : 30;
    const untilDate = new Date();
    const sinceDate = new Date(untilDate);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - period + 1);
    sinceDate.setUTCHours(0, 0, 0, 0);
    const since = sinceDate.toISOString();
    const until = untilDate.toISOString();
    const token = envValue(context.env, "CLOUDFLARE_ANALYTICS_TOKEN");
    const zoneId = envValue(context.env, "CLOUDFLARE_ZONE_ID");
    const hostname = String(context.env.CLOUDFLARE_SITE_HOST || "art-hov.blog");
    const result = await fetch(GRAPHQL_ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: analyticsQuery(zoneId, hostname, since, until) }) });
    if (!result.ok) throw new CmsError("Cloudflare-statistieken konden niet worden opgehaald.", 502, "analytics_error");
    const data = await result.json();
    if (data.errors?.length) {
      console.error("Cloudflare Analytics error", data.errors.map(error => error.message));
      throw new CmsError("Cloudflare heeft de statistiekenquery geweigerd. Controleer het token en de zone-ID.", 502, "analytics_query_error");
    }
    const zone = data.data?.viewer?.zones?.[0];
    if (!zone) throw new CmsError("Cloudflare heeft geen statistieken voor deze zone teruggegeven.", 404, "analytics_not_found");
    return response({ ok: true, statistics: normalizeStatistics(zone, period, since, until) });
  } catch (error) { return errorResponse(error); }
}

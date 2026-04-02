import { logger } from "./logger";
import { config } from "./config";

// ── Feed health tracking ──────────────────────────────────────────────────────
export interface FeedHealthEntry {
  feedName: string;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  status: "ok" | "failing" | "never_attempted";
}

const feedHealthMap = new Map<string, FeedHealthEntry>();

function markSuccess(feedName: string): void {
  const prev = feedHealthMap.get(feedName);
  feedHealthMap.set(feedName, {
    feedName,
    lastAttempt: new Date().toISOString(),
    lastSuccess: new Date().toISOString(),
    lastFailure: prev?.lastFailure ?? null,
    lastError: null,
    consecutiveFailures: 0,
    status: "ok",
  });
}

function markFailure(feedName: string, err: unknown): void {
  const prev = feedHealthMap.get(feedName);
  feedHealthMap.set(feedName, {
    feedName,
    lastAttempt: new Date().toISOString(),
    lastSuccess: prev?.lastSuccess ?? null,
    lastFailure: new Date().toISOString(),
    lastError: err instanceof Error ? err.message : String(err),
    consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
    status: "failing",
  });
}

export function getFeedHealth(): FeedHealthEntry[] {
  return Array.from(feedHealthMap.values()).sort((a, b) => a.feedName.localeCompare(b.feedName));
}

// ── HTML entity decode (titles from RSS can contain numeric / named entities) ─
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export interface RawArticle {
  title: string;
  source: string;
  publishedAt: Date;
  url: string;
  rawContent: string | null;
}

// ── DataSourceProvider interface ──────────────────────────────────────────────
// Modular design: swap in BloombergProvider, CreditfluxProvider, etc. later
export interface DataSourceProvider {
  name: string;
  fetchArticles(): Promise<RawArticle[]>;
}

// ── Shared credit keyword lists ───────────────────────────────────────────────
const NEWSAPI_KEYWORDS = [
  "credit markets", "leveraged loans", "high yield bonds",
  "credit rating downgrade", "bond default", "corporate debt",
  "CLO", "credit spread", "junk bonds", "loan syndication",
  "bankruptcy", "debt restructuring", "fixed income", "bond yields",
];

const RSS_CREDIT_KEYWORDS = [
  ...NEWSAPI_KEYWORDS,
  "bonds", "yield", "default", "debt", "rating", "downgrade", "spread",
  "credit", "interest rate", "Federal Reserve", "Fed", "treasury", "loan",
  "refinancing", "maturity", "coupon", "covenant", "distressed",
  "investment grade", "speculative", "Moody", "Fitch", "S&P",
  // Part 9: Expanded keyword list
  "maturity wall", "liquidity crunch", "debt load", "leverage ratio",
  "interest coverage", "restructuring", "amend and extend",
  "near default", "debt restructuring", "distressed exchange",
  "creditor", "chapter 11", "insolvency", "bankruptcy",
  "credit spread", "CDS", "leveraged buyout", "LBO",
];

// ── RSS Provider ──────────────────────────────────────────────────────────────
export class RSSProvider implements DataSourceProvider {
  name = "RSS";

  private readonly feeds = [
    // ── Original feeds ─────────────────────────────────────────────────────
    { url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", source: "Wall Street Journal" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", source: "New York Times" },
    { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
    { url: "https://www.investing.com/rss/news_25.rss", source: "Investing.com" },
    { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", source: "CNBC" },
    // ── New feeds (Part 1 expansion) ────────────────────────────────────────
    // MarketWatch additional categories
    { url: "https://feeds.content.dowjones.io/public/rss/mw_bonds", source: "MarketWatch Bonds" },
    { url: "https://feeds.content.dowjones.io/public/rss/mw_realestate", source: "MarketWatch Real Estate" },
    { url: "https://feeds.content.dowjones.io/public/rss/mw_personalfinance", source: "MarketWatch Finance" },
    // CNBC additional channels
    { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", source: "CNBC Finance" },
    { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", source: "CNBC Economy" },
    // Yahoo Finance
    { url: "https://finance.yahoo.com/rss/", source: "Yahoo Finance" },
    // Reuters
    { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters Business" },
    { url: "https://feeds.reuters.com/reuters/companyNews", source: "Reuters Companies" },
    // Barron's
    { url: "https://www.barrons.com/xml/rss/3_7614.xml", source: "Barron's" },
    // Seeking Alpha (public feed)
    { url: "https://seekingalpha.com/feed.xml", source: "Seeking Alpha" },
    // Financial Times
    { url: "https://www.ft.com/rss/home/uk", source: "Financial Times" },
    // WSJ additional
    { url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", source: "WSJ World" },
    { url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", source: "WSJ Business" },
  ];

  async fetchArticles(): Promise<RawArticle[]> {
    const articles: RawArticle[] = [];

    for (const feed of this.feeds) {
      try {
        const response = await fetch(feed.url, {
          headers: { "User-Agent": "CreditIntelligenceDashboard/2.0" },
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) continue;

        const text = await response.text();
        const items = text.match(/<item[\s\S]*?<\/item>/g) ?? [];

        for (const item of items.slice(0, 25)) {
          const titleMatch = item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/);
          const linkMatch = item.match(/<link[^>]*>([\s\S]*?)<\/link>|<link[^>]*href="([^"]+)"/);
          const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
          const descMatch = item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/);

          const title = decodeHtmlEntities((titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim());
          const link = (linkMatch?.[1] ?? linkMatch?.[2] ?? "").trim();
          const pubDate = (dateMatch?.[1] ?? "").trim();
          const description = decodeHtmlEntities(
            (descMatch?.[1] ?? descMatch?.[2] ?? "").trim().replace(/<[^>]+>/g, "").trim()
          );

          if (!title || !link) continue;

          const isCreditRelated = RSS_CREDIT_KEYWORDS.some(
            (kw) =>
              title.toLowerCase().includes(kw.toLowerCase()) ||
              description.toLowerCase().includes(kw.toLowerCase())
          );
          if (!isCreditRelated) continue;

          articles.push({
            title,
            source: feed.source,
            publishedAt: pubDate ? new Date(pubDate) : new Date(),
            url: link,
            rawContent: description || null,
          });
        }
        markSuccess(feed.source);
      } catch (err) {
        logger.warn({ err, feed: feed.source }, "RSS feed fetch failed");
        markFailure(feed.source, err);
      }
    }

    return articles;
  }
}

// ── NewsAPI Provider ──────────────────────────────────────────────────────────
export class NewsAPIProvider implements DataSourceProvider {
  name = "NewsAPI";
  private readonly apiKey = config.newsApiKey;
  private readonly baseUrl = "https://newsapi.org/v2/everything";

  async fetchArticles(): Promise<RawArticle[]> {
    if (!this.apiKey) {
      logger.warn("NEWS_API_KEY not set, skipping NewsAPI fetch");
      return [];
    }

    const articles: RawArticle[] = [];

    for (const keyword of NEWSAPI_KEYWORDS.slice(0, 5)) {
      try {
        const params = new URLSearchParams({
          q: keyword, language: "en", sortBy: "publishedAt",
          pageSize: "10", apiKey: this.apiKey,
        });
        const response = await fetch(`${this.baseUrl}?${params}`);
        if (!response.ok) {
          logger.warn({ keyword, status: response.status }, "NewsAPI request failed");
          markFailure("NewsAPI", `HTTP ${response.status}`);
          continue;
        }

        const data = (await response.json()) as {
          articles?: Array<{
            title: string; source?: { name?: string };
            publishedAt: string; url: string;
            content?: string; description?: string;
          }>;
        };

        for (const article of data.articles ?? []) {
          if (!article.title || article.title === "[Removed]" || !article.url) continue;
          articles.push({
            title: article.title,
            source: article.source?.name ?? "NewsAPI",
            publishedAt: new Date(article.publishedAt),
            url: article.url,
            rawContent: article.content ?? article.description ?? null,
          });
        }
        markSuccess("NewsAPI");
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        logger.error({ err, keyword }, "NewsAPI fetch error");
        markFailure("NewsAPI", err);
      }
    }

    return articles;
  }
}

// ── Provider registry ─────────────────────────────────────────────────────────
// Add BloombergProvider, CreditfluxProvider, WSJProvider here in future
export const dataProviders: DataSourceProvider[] = [
  new RSSProvider(),
  new NewsAPIProvider(),
];

export async function fetchAllArticles(): Promise<RawArticle[]> {
  const results = await Promise.allSettled(
    dataProviders.map((p) => p.fetchArticles())
  );

  const articles: RawArticle[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      articles.push(...result.value);
      logger.info({ provider: dataProviders[i].name, count: result.value.length }, "Provider fetched articles");
    } else {
      logger.error({ provider: dataProviders[i].name, err: result.reason }, "Provider failed");
    }
  }

  // Deduplicate by URL within this batch
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

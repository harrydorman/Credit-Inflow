import { logger } from "./logger";
import { config } from "./config";

const NEWS_API_KEY = config.newsApiKey;
const NEWS_API_URL = "https://newsapi.org/v2/everything";

const CREDIT_KEYWORDS = [
  "credit markets",
  "leveraged loans",
  "high yield bonds",
  "credit rating downgrade",
  "bond default",
  "corporate debt",
  "CLO",
  "credit spread",
  "junk bonds",
  "loan syndication",
  "bankruptcy",
  "debt restructuring",
  "fixed income",
  "bond yields",
];

const RSS_CREDIT_KEYWORDS = [
  ...CREDIT_KEYWORDS,
  "bonds",
  "yield",
  "default",
  "debt",
  "rating",
  "downgrade",
  "spread",
  "credit",
  "interest rate",
  "Federal Reserve",
  "Fed",
  "treasury",
  "loan",
  "refinancing",
  "maturity",
  "coupon",
  "covenant",
  "distressed",
  "investment grade",
  "speculative",
  "Moody",
  "Fitch",
  "S&P",
];

export interface RawArticle {
  title: string;
  source: string;
  publishedAt: Date;
  url: string;
  rawContent: string | null;
}

export async function fetchNewsApiArticles(): Promise<RawArticle[]> {
  if (!NEWS_API_KEY) {
    logger.warn("NEWS_API_KEY not set, skipping NewsAPI fetch");
    return [];
  }

  const articles: RawArticle[] = [];

  for (const keyword of CREDIT_KEYWORDS.slice(0, 5)) {
    try {
      const params = new URLSearchParams({
        q: keyword,
        language: "en",
        sortBy: "publishedAt",
        pageSize: "10",
        apiKey: NEWS_API_KEY,
      });

      const response = await fetch(`${NEWS_API_URL}?${params}`);
      if (!response.ok) {
        logger.warn({ keyword, status: response.status }, "NewsAPI request failed");
        continue;
      }

      const data = (await response.json()) as {
        articles?: Array<{
          title: string;
          source?: { name?: string };
          publishedAt: string;
          url: string;
          content?: string;
          description?: string;
        }>;
      };

      for (const article of data.articles ?? []) {
        if (!article.title || article.title === "[Removed]") continue;
        if (!article.url) continue;

        articles.push({
          title: article.title,
          source: article.source?.name ?? "Unknown",
          publishedAt: new Date(article.publishedAt),
          url: article.url,
          rawContent: article.content ?? article.description ?? null,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (err) {
      logger.error({ err, keyword }, "Error fetching from NewsAPI");
    }
  }

  return articles;
}

export async function fetchRssArticles(): Promise<RawArticle[]> {
  const RSS_FEEDS = [
    {
      url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
      source: "Wall Street Journal",
    },
    {
      url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      source: "New York Times",
    },
    {
      url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      source: "MarketWatch",
    },
    {
      url: "https://www.investing.com/rss/news_25.rss",
      source: "Investing.com",
    },
    {
      url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
      source: "CNBC",
    },
  ];

  const articles: RawArticle[] = [];

  for (const feed of RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "CreditIntelligenceDashboard/1.0" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      const items = text.match(/<item[\s\S]*?<\/item>/g) ?? [];

      for (const item of items.slice(0, 10)) {
        const titleMatch = item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link[^>]*>([\s\S]*?)<\/link>|<link[^>]*href="([^"]+)"/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const descMatch = item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/);

        const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim();
        const link = (linkMatch?.[1] ?? linkMatch?.[2] ?? "").trim();
        const pubDate = (dateMatch?.[1] ?? "").trim();
        const description = (descMatch?.[1] ?? descMatch?.[2] ?? "").trim();

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
    } catch (err) {
      logger.warn({ err, feed: feed.source }, "RSS feed fetch failed");
    }
  }

  return articles;
}

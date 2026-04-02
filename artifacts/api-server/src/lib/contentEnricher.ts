const FETCH_TIMEOUT_MS = 4000;
const MIN_USEFUL_CONTENT_CHARS = 300;
const MAX_CONTENT_CHARS = 3000;

const FETCHABLE_SOURCES = new Set([
  "cnbc",
  "yahoo",
  "marketwatch",
  "reuters",
  "investing.com",
  "businesswire",
  "prnewswire",
  "globenewswire",
  "seekingalpha",
]);

const SKIP_SOURCES = new Set([
  "wsj",
  "ft.com",
  "financialtimes",
  "barrons",
  "bloomberg",
]);

function isFetchable(url: string, source: string): boolean {
  const lowerUrl = url.toLowerCase();
  const lowerSource = source.toLowerCase();
  if (SKIP_SOURCES.has(lowerSource) || [...SKIP_SOURCES].some((s) => lowerSource.includes(s) || lowerUrl.includes(s))) {
    return false;
  }
  if (lowerUrl.startsWith("http")) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractArticleText(html: string): string {
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<div[^>]*(?:class|id)="[^"]*(?:article|story|content|body|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const raw = articleMatch ? articleMatch[1] : html;
  return stripHtml(raw).slice(0, MAX_CONTENT_CHARS);
}

function computeDepthScore(content: string, sourceType: string): number {
  const length = content.length;
  if (sourceType === "api_fulltext") return 90;
  if (sourceType === "expanded_article") {
    if (length >= 2000) return 80;
    if (length >= 1000) return 65;
    if (length >= 500) return 50;
    return 35;
  }
  if (length >= 400) return 30;
  if (length >= 200) return 20;
  return 10;
}

export interface EnrichedContent {
  rawContent: string;
  contentSourceType: "rss_snippet" | "expanded_article" | "api_fulltext";
  contentDepthScore: number;
}

export async function enrichContent(
  url: string,
  source: string,
  snippetContent: string,
  forceAttempt = false
): Promise<EnrichedContent> {
  const snippet = snippetContent ?? "";

  if (!forceAttempt && !isFetchable(url, source)) {
    return {
      rawContent: snippet,
      contentSourceType: "rss_snippet",
      contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
    };
  }

  if (snippet.length >= MIN_USEFUL_CONTENT_CHARS + 200) {
    return {
      rawContent: snippet,
      contentSourceType: "rss_snippet",
      contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CreditBot/1.0; +https://replit.app)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        rawContent: snippet,
        contentSourceType: "rss_snippet",
        contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return {
        rawContent: snippet,
        contentSourceType: "rss_snippet",
        contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
      };
    }

    const html = await response.text();
    const extracted = extractArticleText(html);

    if (extracted.length < snippet.length + MIN_USEFUL_CONTENT_CHARS) {
      return {
        rawContent: snippet,
        contentSourceType: "rss_snippet",
        contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
      };
    }

    return {
      rawContent: extracted,
      contentSourceType: "expanded_article",
      contentDepthScore: computeDepthScore(extracted, "expanded_article"),
    };
  } catch {
    return {
      rawContent: snippet,
      contentSourceType: "rss_snippet",
      contentDepthScore: computeDepthScore(snippet, "rss_snippet"),
    };
  }
}

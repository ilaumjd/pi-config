import Firecrawl from "@mendable/firecrawl-js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { readEnv } from "../lib/env";

function createClient() {
  const apiKey = readEnv("FIRECRAWL_API_KEY");
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY in environment or ~/.pi/agent/.env");
  }

  return new Firecrawl({ apiKey });
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search Web",
    description: "Search the web with Firecrawl. Returns web/news/image results, and can optionally include markdown content for each web result.",
    promptSnippet: "Search the web with Firecrawl for current information.",
    promptGuidelines: [
      "Use search when the user asks for current web information, discovery, or sources beyond the local workspace.",
      "Use scrape after search when you need the full markdown content of a specific page.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The web search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results to return. Defaults to 5.", minimum: 1, maximum: 20 })),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      scrapeResults: Type.Optional(Type.Boolean({ description: "Whether to scrape result pages and include markdown. Defaults to false." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({
          content: [{ type: "text", text: `Searching Firecrawl for: ${params.query}` }],
          details: undefined,
        });

        const client = createClient();
        const result = await client.search(params.query, {
          limit: params.limit ?? 5,
          sources: [params.source ?? "web"],
          scrapeOptions: params.scrapeResults ? { formats: ["markdown"], timeout: 30000 } : undefined,
          timeout: 30000,
        });

        if (signal?.aborted) throw new Error("Search cancelled");

        return {
          content: [{ type: "text", text: stringify(result) }],
          details: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Firecrawl search failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "scrape",
    label: "Scrape Page",
    description: "Grab the content of a single page with Firecrawl and return agent-consumable markdown.",
    promptSnippet: "Fetch a URL's page content as markdown with Firecrawl.",
    promptGuidelines: [
      "Use scrape when you need the full readable markdown content of a known URL.",
      "Prefer scrape over bash/fetch for web pages because scrape returns cleaned markdown suitable for agent context.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch." }),
      onlyMainContent: Type.Optional(Type.Boolean({ description: "Only return the main page content. Defaults to true." })),
      waitFor: Type.Optional(Type.Number({ description: "Milliseconds to wait before capturing content, useful for JS-heavy pages." })),
      timeout: Type.Optional(Type.Number({ description: "Request timeout in milliseconds. Defaults to 30000." })),
      includeMetadata: Type.Optional(Type.Boolean({ description: "Append page metadata to the markdown output. Defaults to false. Full metadata is always available in details." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({
          content: [{ type: "text", text: `Scraping page with Firecrawl: ${params.url}` }],
          details: undefined,
        });

        const client = createClient();
        const document = await client.scrapeUrl(params.url, {
          formats: ["markdown"],
          onlyMainContent: params.onlyMainContent ?? true,
          waitFor: params.waitFor,
          timeout: params.timeout ?? 30000,
        });

        if (signal?.aborted) throw new Error("Scrape cancelled");

        const metadata = params.includeMetadata && document.metadata ? `\n\nMetadata:\n${stringify(document.metadata)}` : "";
        const markdown = document.markdown?.trim() || "No markdown content returned.";

        return {
          content: [{ type: "text", text: `${markdown}${metadata}` }],
          details: document,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Firecrawl scrape failed: ${asErrorMessage(error)}` }],
          details: { error: asErrorMessage(error) },
          isError: true,
        };
      }
    },
  });
}

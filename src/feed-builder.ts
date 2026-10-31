import type { PluginSettings, FeedItem } from "./types.js";

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function buildRssFeed(settings: PluginSettings, items: FeedItem[]): Response {
	const now = new Date().toUTCString();
	let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xml += `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n`;
	xml += `<channel>\n`;
	xml += `  <title>${escapeXml(settings.customFeedTitle)}</title>\n`;
	xml += `  <description>Aggregated RSS Feed</description>\n`;
	xml += `  <lastBuildDate>${now}</lastBuildDate>\n`;
	xml += `  <generator>EmDash RSS Aggregator</generator>\n`;

	for (const item of items) {
		xml += `  <item>\n`;
		xml += `    <title>${escapeXml(item.title)}</title>\n`;
		xml += `    <link>${escapeXml(item.url)}</link>\n`;
		xml += `    <guid isPermaLink="false">${escapeXml(item.guid)}</guid>\n`;
		if (item.content || item.excerpt) {
			xml += `    <description><![CDATA[${item.excerpt || item.content || ""}]]></description>\n`;
		}
		if (item.author?.name) {
			xml += `    <author>${escapeXml(item.author.email || "")} (${escapeXml(item.author.name)})</author>\n`;
		}
		xml += `    <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>\n`;
		if (item.sourceName) {
			xml += `    <source url="${escapeXml(item.sourceUrl || "")}">${escapeXml(item.sourceName)}</source>\n`;
		}
		if (item.enclosure) {
			xml += `    <enclosure url="${escapeXml(item.enclosure.url)}" type="${escapeXml(item.enclosure.type || "")}" length="${item.enclosure.length || 0}" />\n`;
		}
		if (item.categories) {
			for (const cat of item.categories) {
				xml += `    <category>${escapeXml(cat)}</category>\n`;
			}
		}
		xml += `  </item>\n`;
	}

	xml += `</channel>\n</rss>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=900",
		},
	});
}

export function buildAtomFeed(settings: PluginSettings, items: FeedItem[]): Response {
	const now = new Date().toISOString();
	let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xml += `<feed xmlns="http://www.w3.org/2005/Atom">\n`;
	xml += `  <title>${escapeXml(settings.customFeedTitle)}</title>\n`;
	xml += `  <updated>${now}</updated>\n`;
	xml += `  <id>urn:emdash:rss-aggregator:feed</id>\n`;
	xml += `  <generator>EmDash RSS Aggregator</generator>\n`;

	for (const item of items) {
		xml += `  <entry>\n`;
		xml += `    <title>${escapeXml(item.title)}</title>\n`;
		xml += `    <link href="${escapeXml(item.url)}" />\n`;
		xml += `    <id>${escapeXml(item.guid)}</id>\n`;
		xml += `    <updated>${item.publishedAt}</updated>\n`;
		if (item.content || item.excerpt) {
			xml += `    <summary type="html"><![CDATA[${item.excerpt || item.content || ""}]]></summary>\n`;
		}
		if (item.author?.name) {
			xml += `    <author><name>${escapeXml(item.author.name)}</name>`;
			if (item.author.email) xml += `<email>${escapeXml(item.author.email)}</email>`;
			xml += `</author>\n`;
		}
		if (item.categories) {
			for (const cat of item.categories) {
				xml += `    <category term="${escapeXml(cat)}" />\n`;
			}
		}
		xml += `  </entry>\n`;
	}

	xml += `</feed>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/atom+xml; charset=utf-8",
			"Cache-Control": "public, max-age=900",
		},
	});
}

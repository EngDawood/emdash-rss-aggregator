/**
 * @dawod/emdash-rss-aggregator
 *
 * Full-Text RSS extractor. For feeds that only ship an excerpt, this fetches
 * the source article page and extracts the main article HTML — a "readability
 * lite" implementation built entirely from regex/string ops.
 *
 * Cloudflare Workers runtime: no Node.js APIs, no DOMParser. Uses fetch/Response,
 * regex and standard string ops only. NEVER throws to the caller — on any
 * failure (no http capability, fetch error, non-OK response, non-HTML response,
 * or too-weak extraction) it returns `null` so the caller keeps the feed content.
 */

import type { PluginContext } from "emdash";
import type { PluginSettings } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────

/** Minimum plain-text length for an extraction to be considered useful. */
const MIN_TEXT_LENGTH = 200;

// ── Helpers ────────────────────────────────────────────────────────────

/** Strip all tags from an HTML fragment and collapse whitespace. */
function plainText(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Plain-text length of an HTML fragment. */
function textLength(html: string): number {
	return plainText(html).length;
}

/** Extract the inner HTML of the first `<body>…</body>`, else the whole doc. */
function extractBody(html: string): string {
	const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	return match ? match[1] : html;
}

/** Remove scripts, styles, structural chrome, and comments from a fragment. */
function stripNoise(html: string): string {
	let out = html;
	const blockTags = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe"];
	for (const tag of blockTags) {
		out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
	}
	// HTML comments.
	out = out.replace(/<!--[\s\S]*?-->/g, " ");
	return out;
}

/** Collect all blocks for a given tag (non-greedy, dot-matches-newline). */
function collectBlocks(html: string, tag: string): string[] {
	const blocks: string[] = [];
	const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
	let match: RegExpExecArray | null;
	while ((match = re.exec(html)) !== null) {
		blocks.push(match[0]);
	}
	return blocks;
}

/** Collect every `<p>…</p>` block in a fragment. */
function collectParagraphs(html: string): string[] {
	return collectBlocks(html, "p");
}

/** Sum of plain-text length across all `<p>` paragraphs inside a fragment. */
function paragraphTextLength(html: string): number {
	let total = 0;
	for (const p of collectParagraphs(html)) {
		total += textLength(p);
	}
	return total;
}

/**
 * Choose the best content candidate from the cleaned body.
 * Prefers `<article>`; falls back to the richest `<div>`/`<section>`; then to
 * the concatenation of every `<p>` in the body.
 */
function selectCandidate(cleanBody: string): string {
	// 1. Prefer <article> — pick the one with the most plain text.
	const articles = collectBlocks(cleanBody, "article");
	if (articles.length > 0) {
		let best = articles[0];
		let bestLen = textLength(best);
		for (const block of articles) {
			const len = textLength(block);
			if (len > bestLen) {
				best = block;
				bestLen = len;
			}
		}
		return best;
	}

	// 2. Fall back to the <div>/<section> with the most paragraph text.
	// Note: a non-greedy regex won't perfectly handle nested divs — that's
	// acceptable; we additionally consider "all <p> in body" to bias toward
	// larger containers.
	const containers = [...collectBlocks(cleanBody, "div"), ...collectBlocks(cleanBody, "section")];
	let best = "";
	let bestLen = 0;
	for (const block of containers) {
		const len = paragraphTextLength(block);
		if (len > bestLen) {
			best = block;
			bestLen = len;
		}
	}

	// 3. Concatenation of all paragraphs in the body as a fallback candidate.
	const allParagraphs = collectParagraphs(cleanBody).join("\n");
	if (textLength(allParagraphs) > bestLen) {
		return allParagraphs;
	}

	return best || allParagraphs;
}

/** Light sanitize: drop event handlers, inline styles, residual script/style, collapse whitespace. */
function sanitize(html: string): string {
	let out = html;
	// Strip inline event handler attributes (onclick="…", etc.).
	out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
	out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
	// Strip style="…" / style='…' attributes.
	out = out.replace(/\sstyle\s*=\s*"[^"]*"/gi, "");
	out = out.replace(/\sstyle\s*=\s*'[^']*'/gi, "");
	// Defensive: strip any script/style blocks again.
	out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
	out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
	// Collapse excessive whitespace between tags.
	out = out.replace(/>\s+</g, "> <").replace(/\s{2,}/g, " ").trim();
	return out;
}

// ── Public contract ────────────────────────────────────────────────────

/**
 * Fetches the article page at `url` and extracts the main article HTML.
 * Returns the cleaned HTML, or `null` on any failure or too-weak extraction.
 */
export async function fetchFullText(
	ctx: PluginContext,
	settings: PluginSettings,
	url: string,
): Promise<string | null> {
	if (!ctx.http?.fetch || !url) {
		return null;
	}

	try {
		const response = await ctx.http.fetch(url, {
			headers: { "User-Agent": settings.userAgent || "EmDash RSS Aggregator/1.0" },
			signal: AbortSignal.timeout(settings.fetchTimeout || 30000),
		});

		if (!response.ok) {
			return null;
		}

		const contentType = response.headers.get("Content-Type");
		if (contentType && !contentType.toLowerCase().includes("html")) {
			return null;
		}

		const html = await response.text();

		// 1. Narrow to <body>, then strip noise blocks.
		const cleanBody = stripNoise(extractBody(html));

		// 2. Pick the richest content candidate.
		const candidate = selectCandidate(cleanBody);
		if (!candidate) {
			return null;
		}

		// 3. Light sanitize.
		const cleaned = sanitize(candidate);

		// 4. Reject extractions that are too weak.
		if (textLength(cleaned) < MIN_TEXT_LENGTH) {
			return null;
		}

		return cleaned;
	} catch (err) {
		ctx.log.warn("Full-text fetch failed", { url, error: String(err) });
		return null;
	}
}

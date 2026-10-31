/**
 * @dawod/emdash-rss-aggregator
 *
 * Pure field mapper for custom RSS→content field mapping (premium: Custom Mapping).
 *
 * Maps arbitrary RSS/XML fields from a parsed feed item into custom content
 * fields, per user-configured mapping rules. Cloudflare Workers safe — uses
 * regex/string operations only (no DOMParser, no Node APIs, no npm deps).
 *
 * All functions are pure and never throw: on any extraction failure the
 * offending mapping is simply skipped.
 */

import type { FieldMapping, ParsedItem } from "./types.js";

/** Regex-escape special characters in a tag/attribute name. */
function escaped(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip CDATA wrappers, decode basic HTML entities, and trim. */
function cleanText(value: string): string {
	let out = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
	out = out
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
	return out.trim();
}

/** Read an attribute value off the first matching tag in the raw XML. */
function extractAttribute(raw: string, tag: string, attr: string): string {
	const tagRe = new RegExp(
		"<(?:[a-zA-Z0-9_-]+:)?" + escaped(tag) + "(?:\\s+[^>]*?)?/?>",
		"i",
	);
	const tagMatch = tagRe.exec(raw);
	if (!tagMatch) return "";
	const attrRe = new RegExp(
		"\\b" + escaped(attr) + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')",
		"i",
	);
	const attrMatch = attrRe.exec(tagMatch[0]);
	if (!attrMatch) return "";
	return attrMatch[1] ?? attrMatch[2] ?? "";
}

/** Read the inner text of the first matching tag in the raw XML. */
function extractTagText(raw: string, tag: string): string {
	const re = new RegExp(
		"<(?:[a-zA-Z0-9_-]+:)?" +
			escaped(tag) +
			"(?:\\s+[^>]*?)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?" +
			escaped(tag) +
			">",
		"i",
	);
	const match = re.exec(raw);
	if (!match) return "";
	return cleanText(match[1] ?? "");
}

/** Convenience fallback to known ParsedItem props by field name (case-insensitive). */
function extractKnownProp(item: ParsedItem, rssField: string): string {
	switch (rssField.toLowerCase()) {
		case "title":
			return item.title ?? "";
		case "link":
		case "url":
			return item.link ?? "";
		case "guid":
		case "id":
			return item.guid ?? "";
		case "description":
		case "summary":
			return item.description ?? "";
		case "content":
			return item.content ?? "";
		case "author":
		case "creator":
			return item.author?.name ?? "";
		case "pubdate":
		case "date":
		case "published":
			return item.pubDate ?? "";
		case "category":
		case "categories":
			return item.categories?.join(", ") ?? "";
		case "comments":
			return item.commentsUrl ?? "";
		case "enclosure":
			return item.enclosure?.url ?? "";
		case "thumbnail":
		case "media:thumbnail":
			return item.mediaThumbnail ?? "";
		default:
			return "";
	}
}

/** Resolve a mapping's rssField to a raw string value, or "" if unresolved. */
function resolveValue(item: ParsedItem, rssField: string): string {
	const raw = item.raw ?? "";

	// 1. Attribute syntax: tag@attr
	if (rssField.includes("@")) {
		const atIndex = rssField.indexOf("@");
		const tag = rssField.slice(0, atIndex);
		const attr = rssField.slice(atIndex + 1);
		if (!tag || !attr) return "";
		return extractAttribute(raw, tag, attr);
	}

	// 2. Raw tag text extraction.
	const fromRaw = extractTagText(raw, rssField);
	if (fromRaw) return fromRaw;

	// 3. Known-prop fallback.
	return extractKnownProp(item, rssField);
}

/** Reduce a string to plain text: strip tags, collapse whitespace, trim. */
function toPlainText(value: string): string {
	return value
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Apply a transform to a resolved string value. */
function applyTransform(value: string, mapping: FieldMapping): string {
	switch (mapping.transform) {
		case "strip-html":
			return toPlainText(value);
		case "truncate": {
			const plain = toPlainText(value);
			const limit =
				typeof mapping.truncateLength === "number" && mapping.truncateLength > 0
					? mapping.truncateLength
					: 100;
			if (plain.length <= limit) return plain;
			return plain.slice(0, limit) + "…";
		}
		case "date": {
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			return date.toISOString();
		}
		case "lowercase":
			return value.toLowerCase();
		case "uppercase":
			return value.toUpperCase();
		case "none":
		case undefined:
		default:
			return value;
	}
}

/**
 * Apply user-configured field mapping rules to a parsed feed item.
 *
 * Returns a record of `{ [targetField]: value }` for every mapping that
 * resolved to a non-empty value. Returns `{}` when there are no mappings.
 */
export function applyFieldMappings(
	mappings: FieldMapping[] | undefined,
	item: ParsedItem,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (!mappings || mappings.length === 0) return result;

	for (const mapping of mappings) {
		if (!mapping || !mapping.rssField || !mapping.targetField) continue;

		const resolved = resolveValue(item, mapping.rssField);
		if (!resolved) continue;

		const value = applyTransform(resolved, mapping);
		if (value === "") continue;

		result[mapping.targetField] = value;
	}

	return result;
}

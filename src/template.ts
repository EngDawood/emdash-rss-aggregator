/**
 * Pure template utility functions for the RSS Aggregator plugin.
 * No Node APIs — safe for Cloudflare Workers runtime.
 */

/**
 * Convert an arbitrary string into a URL-safe slug:
 * lowercase, replace runs of non-alphanumeric characters with a single dash,
 * and trim leading/trailing dashes.  Empty input returns "".
 */
export function slugify(input: string): string {
	if (!input) return "";
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Replace `{token}` placeholders in `template` with values from `tokens`.
 *
 * - Token names are trimmed before lookup (e.g. `{ key }` → looks up `"key"`).
 * - Dotted / space-containing names are supported (`{output.My Agent}`).
 * - Unknown tokens are LEFT INTACT in the output (not blanked).
 */
export function resolveTemplate(template: string, tokens: Record<string, string>): string {
	return template.replace(/\{([^}]+)\}/g, (match, raw: string) => {
		const key = raw.trim();
		return Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match;
	});
}

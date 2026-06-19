/**
 * Shared utilities and formatters for the RSS Aggregator admin UI.
 */

/**
 * Formats an ISO date string into a human-readable relative time string.
 * E.g., '2 hours ago', 'just now', '3 days ago'.
 */
export function formatRelativeTime(isoDate: string): string {
	const date = new Date(isoDate);
	const now = Date.now();
	const diffMs = now - date.getTime();

	if (diffMs < 0) {
		return 'just now';
	}

	const seconds = Math.floor(diffMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const weeks = Math.floor(days / 7);
	const months = Math.floor(days / 30);

	if (seconds < 60) return 'just now';
	if (minutes === 1) return '1 minute ago';
	if (minutes < 60) return `${minutes} minutes ago`;
	if (hours === 1) return '1 hour ago';
	if (hours < 24) return `${hours} hours ago`;
	if (days === 1) return '1 day ago';
	if (days < 7) return `${days} days ago`;
	if (weeks === 1) return '1 week ago';
	if (weeks < 5) return `${weeks} weeks ago`;
	if (months === 1) return '1 month ago';
	if (months < 12) return `${months} months ago`;

	const years = Math.floor(months / 12);
	if (years === 1) return '1 year ago';
	return `${years} years ago`;
}

/**
 * Formats an ISO date string into a readable date.
 * E.g., 'Jun 20, 2026'.
 */
export function formatDate(isoDate: string): string {
	const date = new Date(isoDate);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

/**
 * Truncates text to the given max length, appending '…' if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength).trimEnd() + '…';
}

/**
 * Maps a status string to a Badge variant.
 */
export function getStatusVariant(
	status: string,
): 'default' | 'success' | 'warning' | 'error' | 'info' {
	switch (status) {
		case 'active':
		case 'success':
			return 'success';
		case 'paused':
		case 'partial':
			return 'warning';
		case 'error':
			return 'error';
		case 'draft':
			return 'info';
		default:
			return 'default';
	}
}

/**
 * Generates a unique ID using crypto.randomUUID with a Math.random fallback.
 */
export function generateId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Fallback: pseudo-random UUID v4
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

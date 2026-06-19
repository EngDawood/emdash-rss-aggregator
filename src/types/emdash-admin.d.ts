/**
 * Ambient type declarations for `@emdash-cms/admin` peer dependency.
 */

declare module "@emdash-cms/admin" {
	import type { ComponentType, ReactNode } from "react";

	/** Hook to call plugin API routes. Auto-prefixes plugin ID. */
	export function usePluginAPI(): {
		get<T = unknown>(route: string): Promise<T>;
		post<T = unknown>(route: string, body?: unknown): Promise<T>;
		put<T = unknown>(route: string, body?: unknown): Promise<T>;
		delete<T = unknown>(route: string): Promise<T>;
	};

	// Pre-built admin UI components
	export const Card: ComponentType<{
		title?: string;
		children: ReactNode;
		className?: string;
		actions?: ReactNode;
	}>;

	export const Button: ComponentType<{
		onClick?: () => void;
		disabled?: boolean;
		variant?: "primary" | "secondary" | "danger" | "ghost";
		size?: "sm" | "md" | "lg";
		loading?: boolean;
		children: ReactNode;
		className?: string;
		type?: "button" | "submit";
	}>;

	export const Input: ComponentType<{
		label?: string;
		value: string;
		onChange: (value: string) => void;
		placeholder?: string;
		type?: string;
		disabled?: boolean;
		error?: string;
		description?: string;
		className?: string;
	}>;

	export const Select: ComponentType<{
		label?: string;
		value: string;
		onChange: (value: string) => void;
		options: Array<{ label: string; value: string }>;
		disabled?: boolean;
		className?: string;
	}>;

	export const Toggle: ComponentType<{
		label?: string;
		checked: boolean;
		onChange: (checked: boolean) => void;
		disabled?: boolean;
		description?: string;
	}>;

	export const Table: ComponentType<{
		columns: Array<{
			key: string;
			label: string;
			render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
			sortable?: boolean;
			width?: string;
		}>;
		data: Array<Record<string, unknown>>;
		loading?: boolean;
		emptyMessage?: string;
		onRowClick?: (row: Record<string, unknown>) => void;
		className?: string;
	}>;

	export const Loading: ComponentType<{
		size?: "sm" | "md" | "lg";
		className?: string;
	}>;

	export const Alert: ComponentType<{
		variant?: "info" | "success" | "warning" | "error";
		title?: string;
		children: ReactNode;
		className?: string;
		dismissible?: boolean;
		onDismiss?: () => void;
	}>;

	export const Badge: ComponentType<{
		variant?: "default" | "success" | "warning" | "error" | "info";
		children: ReactNode;
		className?: string;
	}>;

	export const Tabs: ComponentType<{
		tabs: Array<{ id: string; label: string; content: ReactNode }>;
		defaultTab?: string;
		className?: string;
	}>;

	export const Modal: ComponentType<{
		open: boolean;
		onClose: () => void;
		title?: string;
		children: ReactNode;
		className?: string;
		size?: "sm" | "md" | "lg";
	}>;

	export const NumberInput: ComponentType<{
		label?: string;
		value: number;
		onChange: (value: number) => void;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
		description?: string;
	}>;

	export const TextArea: ComponentType<{
		label?: string;
		value: string;
		onChange: (value: string) => void;
		placeholder?: string;
		rows?: number;
		disabled?: boolean;
		description?: string;
	}>;

	export const ConfirmDialog: ComponentType<{
		open: boolean;
		onConfirm: () => void;
		onCancel: () => void;
		title: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: "danger" | "default";
	}>;

	export const EmptyState: ComponentType<{
		icon?: string;
		title: string;
		description?: string;
		action?: ReactNode;
	}>;

	export const PageHeader: ComponentType<{
		title: string;
		description?: string;
		actions?: ReactNode;
	}>;

	export const Stat: ComponentType<{
		label: string;
		value: string | number;
		trend?: string;
		trendDirection?: "up" | "down" | "neutral";
		className?: string;
	}>;

	export const StatGroup: ComponentType<{
		children: ReactNode;
		className?: string;
	}>;

	export const Pagination: ComponentType<{
		hasMore: boolean;
		onLoadMore: () => void;
		loading?: boolean;
	}>;
}

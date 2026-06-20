/**
 * Minimal UI primitives for the RSS Aggregator admin.
 * Replaces the missing @emdash-cms/admin component exports.
 */
import React, { useState, useCallback } from "react";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";

const API = "/_emdash/api/plugins/rss-aggregator";

// ── API Hook ─────────────────────────────────────────────────────────────────

export function usePluginAPI() {
	return {
		get: useCallback(async <T,>(route: string): Promise<T> => {
			const [path, qs] = route.split("?");
			const url = qs ? `${API}/${path}?${qs}` : `${API}/${path}`;
			const res = await apiFetch(url);
			return parseApiResponse<T>(res, `Failed to fetch ${route}`);
		}, []),
		post: useCallback(async <T,>(route: string, body?: unknown): Promise<T> => {
			const res = await apiFetch(`${API}/${route}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			return parseApiResponse<T>(res, `Failed to post to ${route}`);
		}, []),
	};
}

// ── Primitives ────────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: {
	title: string;
	description?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
			<div>
				<h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>{title}</h1>
				{description && <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#666" }}>{description}</p>}
			</div>
			{actions && <div style={{ display: "flex", gap: "8px" }}>{actions}</div>}
		</div>
	);
}

const BUTTON_STYLES: Record<string, React.CSSProperties> = {
	primary: { background: "#2563eb", color: "#fff", border: "none" },
	secondary: { background: "#f3f4f6", color: "#111", border: "1px solid #d1d5db" },
	danger: { background: "#dc2626", color: "#fff", border: "none" },
	ghost: { background: "transparent", color: "#374151", border: "1px solid #d1d5db" },
};

const BUTTON_SIZE: Record<string, React.CSSProperties> = {
	sm: { padding: "4px 10px", fontSize: "12px" },
	md: { padding: "7px 14px", fontSize: "14px" },
};

export function Button({ variant = "primary", size = "md", onClick, type = "button", loading, disabled, children }: {
	variant?: "primary" | "secondary" | "danger" | "ghost";
	size?: "sm" | "md";
	onClick?: () => void;
	type?: "button" | "submit";
	loading?: boolean;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={loading || disabled}
			style={{
				...(BUTTON_STYLES[variant] ?? BUTTON_STYLES.primary),
				...(BUTTON_SIZE[size] ?? BUTTON_SIZE.md),
				borderRadius: "6px",
				cursor: loading || disabled ? "not-allowed" : "pointer",
				opacity: loading || disabled ? 0.6 : 1,
				fontWeight: 500,
			}}
		>
			{loading ? "…" : children}
		</button>
	);
}

const BADGE_STYLES: Record<string, React.CSSProperties> = {
	default: { background: "#f3f4f6", color: "#374151" },
	success: { background: "#d1fae5", color: "#065f46" },
	warning: { background: "#fef3c7", color: "#92400e" },
	error: { background: "#fee2e2", color: "#991b1b" },
	info: { background: "#dbeafe", color: "#1e40af" },
};

export function Badge({ variant = "default", children }: {
	variant?: "default" | "success" | "warning" | "error" | "info";
	children: React.ReactNode;
}) {
	return (
		<span style={{
			...(BADGE_STYLES[variant] ?? BADGE_STYLES.default),
			display: "inline-block",
			padding: "2px 8px",
			borderRadius: "12px",
			fontSize: "11px",
			fontWeight: 600,
		}}>
			{children}
		</span>
	);
}

export function Alert({ variant = "info", title, children }: {
	variant?: "info" | "success" | "warning" | "error";
	title?: string;
	children?: React.ReactNode;
}) {
	const colors: Record<string, { bg: string; border: string; text: string }> = {
		info: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af" },
		success: { bg: "#f0fdf4", border: "#86efac", text: "#166534" },
		warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" },
		error: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" },
	};
	const c = colors[variant] ?? colors.info;
	return (
		<div style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: "6px", padding: "12px 16px" }}>
			{title && <strong style={{ display: "block", marginBottom: children ? "4px" : 0 }}>{title}</strong>}
			{children}
		</div>
	);
}

export function Loading({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
	const sz = size === "lg" ? 40 : size === "md" ? 28 : 18;
	return (
		<div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px" }}>
			<div style={{
				width: sz, height: sz,
				border: "3px solid #e5e7eb",
				borderTopColor: "#2563eb",
				borderRadius: "50%",
				animation: "spin 0.8s linear infinite",
			}} />
			<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
		</div>
	);
}

export function Card({ title, className, children }: {
	title?: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={className} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
			{title && <h3 style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: 600 }}>{title}</h3>}
			{children}
		</div>
	);
}

export function Stat({ label, value }: { label: string; value: string | number }) {
	return (
		<div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px 20px" }}>
			<div style={{ fontSize: "26px", fontWeight: 700 }}>{value}</div>
			<div style={{ fontSize: "13px", color: "#6b7280", marginTop: "2px" }}>{label}</div>
		</div>
	);
}

export function StatGroup({ children }: { children: React.ReactNode }) {
	return <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>{children}</div>;
}

// ── Form Components ────────────────────────────────────────────────────────────

function FieldLabel({ label, description }: { label?: string; description?: string }) {
	if (!label) return null;
	return (
		<div style={{ marginBottom: "4px" }}>
			<label style={{ fontSize: "13px", fontWeight: 600 }}>{label}</label>
			{description && <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "1px" }}>{description}</div>}
		</div>
	);
}

const INPUT_BASE: React.CSSProperties = {
	width: "100%", boxSizing: "border-box",
	padding: "7px 10px", fontSize: "14px",
	border: "1px solid #d1d5db", borderRadius: "6px",
	background: "#fff", color: "#111",
};

export function Input({ label, value, onChange, placeholder, description, type = "text" }: {
	label?: string;
	value: string;
	onChange: (val: string) => void;
	placeholder?: string;
	description?: string;
	type?: string;
}) {
	return (
		<div>
			<FieldLabel label={label} description={description} />
			<input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={INPUT_BASE} />
		</div>
	);
}

export function TextArea({ label, value, onChange, rows = 4, placeholder }: {
	label?: string;
	value: string;
	onChange: (val: string) => void;
	rows?: number;
	placeholder?: string;
}) {
	return (
		<div>
			<FieldLabel label={label} />
			<textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_BASE, resize: "vertical" }} />
		</div>
	);
}

export function NumberInput({ label, value, onChange, min, max, description }: {
	label?: string;
	value: number;
	onChange: (val: number) => void;
	min?: number;
	max?: number;
	description?: string;
}) {
	return (
		<div>
			<FieldLabel label={label} description={description} />
			<input
				type="number" value={value} min={min} max={max}
				onChange={(e) => onChange(Number(e.target.value))}
				style={INPUT_BASE}
			/>
		</div>
	);
}

export function Select({ label, value, onChange, options }: {
	label?: string;
	value: string;
	onChange: (val: string) => void;
	options: Array<{ label: string; value: string }>;
}) {
	return (
		<div>
			<FieldLabel label={label} />
			<select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_BASE, cursor: "pointer" }}>
				{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
			</select>
		</div>
	);
}

export function Toggle({ label, checked, onChange, description }: {
	label?: string;
	checked: boolean;
	onChange: (val: boolean) => void;
	description?: string;
}) {
	return (
		<label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: "2px" }} />
			{label && (
				<div>
					<span style={{ fontSize: "13px", fontWeight: 500 }}>{label}</span>
					{description && <div style={{ fontSize: "11px", color: "#6b7280" }}>{description}</div>}
				</div>
			)}
		</label>
	);
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function Table({ columns, data, emptyMessage, loading }: {
	columns: Array<{ key: string; label: string; width?: string; render?: (val: any, row: any) => React.ReactNode }>;
	data: Record<string, any>[];
	emptyMessage?: string;
	loading?: boolean;
}) {
	if (loading) return <Loading />;
	return (
		<div style={{ overflowX: "auto" }}>
			<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
				<thead>
					<tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
						{columns.map((col) => (
							<th key={col.key} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#6b7280", width: col.width }}>
								{col.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{data.length === 0 ? (
						<tr>
							<td colSpan={columns.length} style={{ padding: "24px", textAlign: "center", color: "#9ca3af" }}>
								{emptyMessage ?? "No data."}
							</td>
						</tr>
					) : data.map((row, i) => (
						<tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
							{columns.map((col) => (
								<td key={col.key} style={{ padding: "10px 12px", verticalAlign: "middle" }}>
									{col.render ? col.render(row[col.key], row) : row[col.key] ?? "—"}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function Pagination({ hasMore, onLoadMore, loading }: {
	hasMore: boolean;
	onLoadMore: () => void;
	loading?: boolean;
}) {
	if (!hasMore) return null;
	return <Button variant="secondary" onClick={onLoadMore} loading={loading}>Load more</Button>;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, size = "md", children }: {
	open: boolean;
	onClose: () => void;
	title: string;
	size?: "sm" | "md" | "lg";
	children?: React.ReactNode;
}) {
	if (!open) return null;
	const widths = { sm: 400, md: 560, lg: 760 };
	return (
		<div
			style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div style={{ background: "#fff", borderRadius: "10px", padding: "24px", width: "90%", maxWidth: widths[size], maxHeight: "90vh", overflowY: "auto" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
					<h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{title}</h2>
					<button onClick={onClose} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280" }}>✕</button>
				</div>
				{children}
			</div>
		</div>
	);
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", variant = "danger", onConfirm, onCancel }: {
	open: boolean;
	title: string;
	description: string | React.ReactNode;
	confirmLabel?: string;
	variant?: "danger" | "primary";
	onConfirm: () => void;
	onCancel: () => void;
}) {
	if (!open) return null;
	return (
		<Modal open={open} onClose={onCancel} title={title} size="sm">
			<p style={{ fontSize: "14px", color: "#374151", margin: "0 0 20px" }}>{description}</p>
			<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
				<Button variant="secondary" onClick={onCancel}>Cancel</Button>
				<Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
			</div>
		</Modal>
	);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function Tabs({ tabs, defaultTab }: {
	tabs: Array<{ id: string; label: string; content: React.ReactNode }>;
	defaultTab?: string;
}) {
	const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");
	const current = tabs.find((t) => t.id === active);
	return (
		<div>
			<div style={{ display: "flex", gap: "2px", borderBottom: "1px solid #e5e7eb", marginBottom: "16px" }}>
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActive(tab.id)}
						style={{
							padding: "8px 14px", fontSize: "13px", fontWeight: 500, border: "none",
							background: "none", cursor: "pointer",
							color: active === tab.id ? "#2563eb" : "#6b7280",
							borderBottom: active === tab.id ? "2px solid #2563eb" : "2px solid transparent",
						}}
					>
						{tab.label}
					</button>
				))}
			</div>
			{current?.content}
		</div>
	);
}

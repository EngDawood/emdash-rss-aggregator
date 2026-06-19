import React, { useState, useEffect } from "react";
import {
	usePluginAPI,
	PageHeader,
	Button,
	Table,
	Badge,
	Card,
	Select,
	Pagination,
	Alert,
	Loading,
	ConfirmDialog,
} from "@emdash-cms/admin";
import type { ImportLog, Source } from "../types";
import { formatRelativeTime, getStatusVariant } from "./shared";

export const LogsPage: React.FC = () => {
	const api = usePluginAPI();
	const [logs, setLogs] = useState<Array<{ id: string } & ImportLog>>([]);
	const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
	const [loading, setLoading] = useState(true);
	const [loadingLogs, setLoadingLogs] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Filters & Pagination
	const [selectedSource, setSelectedSource] = useState<string>("");
	const [selectedStatus, setSelectedStatus] = useState<string>("");
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [hasMore, setHasMore] = useState(false);

	// Auto-refresh interval
	const [autoRefresh, setAutoRefresh] = useState(false);

	// Confirm clear logs states
	const [isClearOpen, setIsClearOpen] = useState(false);
	const [clearing, setClearing] = useState(false);

	const loadInitialData = async () => {
		try {
			setLoading(true);
			const sourcesData = await api.get<{ items: Array<{ id: string } & Source> }>("sources");
			setSources(sourcesData.items.map((s) => ({ id: s.id, name: s.name })));

			await fetchLogs("", "", undefined, true);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load log page data");
		} finally {
			setLoading(false);
		}
	};

	const fetchLogs = async (sourceId: string, status: string, cursorVal?: string, reset: boolean = false) => {
		setLoadingLogs(true);
		try {
			let url = "logs?limit=30";
			if (sourceId) url += `&sourceId=${encodeURIComponent(sourceId)}`;
			if (status) url += `&status=${encodeURIComponent(status)}`;
			if (cursorVal) url += `&cursor=${encodeURIComponent(cursorVal)}`;

			const data = await api.get<{
				items: Array<{ id: string } & ImportLog>;
				cursor?: string;
				hasMore: boolean;
			}>(url);

			if (reset) {
				setLogs(data.items);
			} else {
				setLogs((prev) => [...prev, ...data.items]);
			}
			setCursor(data.cursor);
			setHasMore(data.hasMore);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load import logs");
		} finally {
			setLoadingLogs(false);
		}
	};

	useEffect(() => {
		loadInitialData();
	}, []);

	// Handle auto-refresh
	useEffect(() => {
		if (!autoRefresh) return;
		const interval = setInterval(() => {
			fetchLogs(selectedSource, selectedStatus, undefined, true);
		}, 10000); // refresh every 10 seconds
		return () => clearInterval(interval);
	}, [autoRefresh, selectedSource, selectedStatus]);

	const handleSourceChange = (sourceId: string) => {
		setSelectedSource(sourceId);
		fetchLogs(sourceId, selectedStatus, undefined, true);
	};

	const handleStatusChange = (status: string) => {
		setSelectedStatus(status);
		fetchLogs(selectedSource, status, undefined, true);
	};

	const handleLoadMore = () => {
		if (hasMore && cursor) {
			fetchLogs(selectedSource, selectedStatus, cursor, false);
		}
	};

	const handleClearLogs = async () => {
		setClearing(true);
		try {
			const body = selectedSource ? { sourceId: selectedSource } : {};
			const res = await api.post<{ success: boolean; deleted: number }>("logs/clear", body);
			alert(`Successfully deleted ${res.deleted} logs.`);
			setIsClearOpen(false);
			fetchLogs(selectedSource, selectedStatus, undefined, true);
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to clear logs");
		} finally {
			setClearing(false);
		}
	};

	const columns = [
		{
			key: "sourceName",
			label: "Source",
			render: (val: any, row: any) => (
				<div>
					<div style={{ fontWeight: 600 }}>{val as string}</div>
					{row.feedTitle && row.feedTitle !== val && (
						<div style={{ fontSize: "11px", color: "#666" }}>Feed Title: {row.feedTitle}</div>
					)}
				</div>
			),
		},
		{
			key: "status",
			label: "Status",
			width: "120px",
			render: (val: any, row: any) => (
				<div>
					<Badge variant={getStatusVariant(val as string)}>{val as string}</Badge>
					{row.error && (
						<div style={{ fontSize: "10px", color: "red", marginTop: "2px" }} title={row.error}>
							{row.error}
						</div>
					)}
				</div>
			),
		},
		{
			key: "itemsFound",
			label: "Found",
		},
		{
			key: "itemsImported",
			label: "Imported",
		},
		{
			key: "itemsUpdated",
			label: "Updated",
		},
		{
			key: "itemsSkipped",
			label: "Skipped",
		},
		{
			key: "itemsRejected",
			label: "Rejected",
		},
		{
			key: "duration",
			label: "Duration",
			render: (val: any) => {
				const ms = val as number;
				if (ms < 1000) return <span>{ms}ms</span>;
				return <span>{(ms / 1000).toFixed(2)}s</span>;
			},
		},
		{
			key: "createdAt",
			label: "Time",
			render: (val: any) => <span>{formatRelativeTime(val as string)}</span>,
		},
	];

	if (loading) return <Loading size="lg" />;

	const sourceOptions = [{ label: "All Sources", value: "" }].concat(
		sources.map((s) => ({ label: s.name, value: s.id }))
	);

	const statusOptions = [
		{ label: "All Statuses", value: "" },
		{ label: "Success", value: "success" },
		{ label: "Partial", value: "partial" },
		{ label: "Error", value: "error" },
	];

	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="Import Logs"
				description="Audit feed import jobs, execution times, success rates, and fetch errors."
				actions={
					<div style={{ display: "flex", gap: "10px" }}>
						<Button variant="ghost" onClick={() => setAutoRefresh(!autoRefresh)}>
							{autoRefresh ? "Stop Auto-refresh" : "Auto-refresh (10s)"}
						</Button>
						<Button variant="secondary" onClick={() => fetchLogs(selectedSource, selectedStatus, undefined, true)}>
							Refresh
						</Button>
						<Button variant="danger" onClick={() => setIsClearOpen(true)}>
							Clear Log History
						</Button>
					</div>
				}
			/>

			{error && <Alert variant="error" title="Error">{error}</Alert>}

			<Card>
				<div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
					<div style={{ width: "240px" }}>
						<Select
							label="Filter by Source"
							value={selectedSource}
							onChange={handleSourceChange}
							options={sourceOptions}
						/>
					</div>
					<div style={{ width: "160px" }}>
						<Select
							label="Filter by Status"
							value={selectedStatus}
							onChange={handleStatusChange}
							options={statusOptions}
						/>
					</div>
				</div>

				<Table
					columns={columns}
					data={logs as any}
					emptyMessage="No import logs found matching the filter."
					loading={loadingLogs}
				/>

				{hasMore && (
					<div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
						<Pagination hasMore={hasMore} onLoadMore={handleLoadMore} loading={loadingLogs} />
					</div>
				)}
			</Card>

			{/* Clear Logs Confirm */}
			<ConfirmDialog
				open={isClearOpen}
				title="Clear Import Logs?"
				description={
					selectedSource
						? "This will delete all logs specifically for the selected feed source. This action cannot be undone."
						: "This will delete all feed import logs across all sources. This action cannot be undone."
				}
				confirmLabel="Clear Logs"
				variant="danger"
				onConfirm={handleClearLogs}
				onCancel={() => setIsClearOpen(false)}
			/>
		</div>
	);
};

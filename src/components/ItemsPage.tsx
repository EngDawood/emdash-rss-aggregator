import React, { useState, useEffect } from "react";
import {
	usePluginAPI,
	PageHeader,
	Button,
	Table,
	Badge,
	Card,
	Select,
	Stat,
	StatGroup,
	Pagination,
	Alert,
	Loading,
	Modal,
	Input,
	ConfirmDialog,
} from "@emdash-cms/admin";
import type { FeedItem, Source, PluginStats } from "../types";
import { formatRelativeTime, truncateText } from "./shared";

export const ItemsPage: React.FC = () => {
	const api = usePluginAPI();
	const [items, setItems] = useState<Array<{ id: string } & FeedItem>>([]);
	const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
	const [stats, setStats] = useState<PluginStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingItems, setLoadingItems] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Pagination & filters
	const [selectedSource, setSelectedSource] = useState<string>("");
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [hasMore, setHasMore] = useState(false);
	const [totalItems, setTotalItems] = useState(0);

	// Rejection states
	const [rejectingItem, setRejectingItem] = useState<{ id: string; title: string } | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	const [isRejectLoading, setIsRejectLoading] = useState(false);

	// Delete state
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const loadInitialData = async () => {
		try {
			setLoading(true);
			// Fetch sources for dropdown filter
			const sourcesData = await api.get<{ items: Array<{ id: string } & Source> }>("sources");
			setSources(sourcesData.items.map((s) => ({ id: s.id, name: s.name })));

			// Fetch stats
			const statsData = await api.get<PluginStats>("stats");
			setStats(statsData);

			// Fetch items
			await fetchItems("", undefined, true);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load initial data");
		} finally {
			setLoading(false);
		}
	};

	const fetchItems = async (sourceId: string, cursorVal?: string, reset: boolean = false) => {
		setLoadingItems(true);
		try {
			let url = "items?limit=25";
			if (sourceId) url += `&sourceId=${encodeURIComponent(sourceId)}`;
			if (cursorVal) url += `&cursor=${encodeURIComponent(cursorVal)}`;

			const data = await api.get<{
				items: Array<{ id: string } & FeedItem>;
				cursor?: string;
				hasMore: boolean;
				total: number;
			}>(url);

			if (reset) {
				setItems(data.items);
			} else {
				setItems((prev) => [...prev, ...data.items]);
			}
			setCursor(data.cursor);
			setHasMore(data.hasMore);
			setTotalItems(data.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load feed items");
		} finally {
			setLoadingItems(false);
		}
	};

	useEffect(() => {
		loadInitialData();
	}, []);

	const handleSourceChange = (sourceId: string) => {
		setSelectedSource(sourceId);
		fetchItems(sourceId, undefined, true);
	};

	const handleLoadMore = () => {
		if (hasMore && cursor) {
			fetchItems(selectedSource, cursor, false);
		}
	};

	const handleOpenReject = (item: { id: string; title: string }) => {
		setRejectingItem(item);
		setRejectReason("Irrelevant/Off-topic");
	};

	const handleRejectSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!rejectingItem) return;

		setIsRejectLoading(true);
		try {
			await api.post("items/reject", {
				id: rejectingItem.id,
				reason: rejectReason,
			});
			// Remove item from view
			setItems((prev) => prev.filter((i) => i.id !== rejectingItem.id));
			setTotalItems((prev) => prev - 1);
			setRejectingItem(null);
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to reject item");
		} finally {
			setIsRejectLoading(false);
		}
	};

	const handleDelete = async () => {
		if (!deletingId) return;
		try {
			await api.post("items/delete", { ids: [deletingId] });
			setItems((prev) => prev.filter((i) => i.id !== deletingId));
			setTotalItems((prev) => prev - 1);
			setDeletingId(null);
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete item");
		}
	};

	const columns = [
		{
			key: "title",
			label: "Title",
			render: (_: any, row: any) => (
				<div>
					<a
						href={row.url}
						target="_blank"
						rel="noreferrer"
						style={{ fontWeight: 600, color: "#111", textDecoration: "none" }}
					>
						{row.title}
					</a>
					<div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
						Guid: {truncateText(row.guid, 50)}
					</div>
				</div>
			),
		},
		{
			key: "sourceName",
			label: "Source",
			render: (val: any) => <span style={{ fontSize: "13px" }}>{val as string}</span>,
		},
		{
			key: "author",
			label: "Author",
			render: (val: any) => <span style={{ fontSize: "13px" }}>{(val as any)?.name || "Unknown"}</span>,
		},
		{
			key: "publishedAt",
			label: "Published",
			render: (val: any) => <span style={{ fontSize: "13px" }}>{formatRelativeTime(val as string)}</span>,
		},
		{
			key: "mediaType",
			label: "Type",
			render: (val: any) => (
				<Badge
					variant={
						val === "video"
							? "info"
							: val === "audio" || val === "podcast"
								? "success"
								: "default"
					}
				>
					{val as string}
				</Badge>
			),
		},
		{
			key: "actions",
			label: "Actions",
			width: "220px",
			render: (_: any, row: any) => (
				<div style={{ display: "flex", gap: "6px" }}>
					<Button variant="secondary" size="sm" onClick={() => window.open(row.url, "_blank")}>
						Visit Link
					</Button>
					<Button variant="ghost" size="sm" onClick={() => handleOpenReject({ id: row.id, title: row.title })}>
						Reject
					</Button>
					<Button variant="danger" size="sm" onClick={() => setDeletingId(row.id)}>
						Delete
					</Button>
				</div>
			),
		},
	];

	if (loading) return <Loading size="lg" />;

	const sourceOptions = [{ label: "All Sources", value: "" }].concat(
		sources.map((s) => ({ label: s.name, value: s.id }))
	);

	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="Imported Items"
				description="View, audit, reject or delete imported feed items."
			/>

			{error && <Alert variant="error" title="Error">{error}</Alert>}

			<div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
				<div style={{ flex: 1 }}>
					<StatGroup>
						<Stat label="Total Imported Items" value={stats?.totalItems ?? totalItems} />
						<Stat label="Imported Today" value={stats?.itemsToday ?? 0} />
					</StatGroup>
				</div>
				<div style={{ width: "240px" }}>
					<Select
						label="Filter by Source"
						value={selectedSource}
						onChange={handleSourceChange}
						options={sourceOptions}
					/>
				</div>
			</div>

			<Card>
				<Table
					columns={columns}
					data={items as any}
					emptyMessage="No imported feed items found."
					loading={loadingItems}
				/>
				{hasMore && (
					<div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
						<Pagination hasMore={hasMore} onLoadMore={handleLoadMore} loading={loadingItems} />
					</div>
				)}
			</Card>

			{/* Reject Modal */}
			<Modal
				open={rejectingItem !== null}
				onClose={() => setRejectingItem(null)}
				title="Reject Feed Item"
				size="md"
			>
				{rejectingItem && (
					<form onSubmit={handleRejectSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
						<p style={{ fontSize: "14px", margin: 0 }}>
							Are you sure you want to reject <strong>{rejectingItem.title}</strong>?
							This will remove the item and block its GUID from being imported in the future.
						</p>
						<Input
							label="Reason for rejection"
							value={rejectReason}
							onChange={setRejectReason}
							placeholder="E.g., Off-topic, Duplicate, Spam"
						/>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
							<Button variant="secondary" onClick={() => setRejectingItem(null)}>
								Cancel
							</Button>
							<Button variant="danger" type="submit" loading={isRejectLoading}>
								Reject and Block
							</Button>
						</div>
					</form>
				)}
			</Modal>

			{/* Delete confirm dialog */}
			<ConfirmDialog
				open={deletingId !== null}
				title="Delete Feed Item?"
				description="This will permanently delete this feed item from both the plugin database and CMS content entries. It can be re-imported on the next feed fetch."
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeletingId(null)}
			/>
		</div>
	);
};

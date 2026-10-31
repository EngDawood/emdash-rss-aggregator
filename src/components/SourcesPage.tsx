import React, { useState, useEffect } from "react";
import {
	usePluginAPI,
	PageHeader,
	Button,
	Table,
	Badge,
	Modal,
	Input,
	Select,
	Toggle,
	NumberInput,
	TextArea,
	ConfirmDialog,
	Card,
	Stat,
	StatGroup,
	Tabs,
	Alert,
	Loading,
} from "./ui";
import type { Source, SourceStatus, Model, Agent, OutputProfile } from "../types";
import { formatRelativeTime, getStatusVariant, truncateText } from "./shared";

const FIXED_KINDS = ["summary", "rewrite", "translate"];

export const SourcesPage: React.FC = () => {
	const api = usePluginAPI();
	const [sources, setSources] = useState<Array<{ id: string } & Source>>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Modal states
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingSource, setEditingSource] = useState<({ id: string } & Source) | null>(null);

	// Confirm Dialog states
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [sourceToDelete, setSourceToDelete] = useState<string | null>(null);

	// Action loading states
	const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

	// Form fields state
	const [formFields, setFormFields] = useState<Partial<Source>>({});

	// Preview states
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewData, setPreviewData] = useState<any>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);

	const handlePreviewFeed = async (url?: string) => {
		if (!url) return;
		setPreviewLoading(true);
		setPreviewError(null);
		setPreviewData(null);
		setIsPreviewOpen(true);
		try {
			const res = await api.post<any>("sources/preview", { url });
			if (res.success) {
				setPreviewData(res);
			} else {
				setPreviewError("Failed to parse feed");
			}
		} catch (err) {
			setPreviewError(err instanceof Error ? err.message : "Failed to load feed preview");
		} finally {
			setPreviewLoading(false);
		}
	};

	// AI pipeline option lists (for the AI & Output tab)
	const [models, setModels] = useState<Array<{ id: string } & Model>>([]);
	const [agents, setAgents] = useState<Array<{ id: string } & Agent>>([]);
	const [profiles, setProfiles] = useState<Array<{ id: string } & OutputProfile>>([]);

	const fetchSources = async () => {
		try {
			setLoading(true);
			const data = await api.get<{ items: Array<{ id: string } & Source> }>("sources");
			setSources(data.items);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load sources");
		} finally {
			setLoading(false);
		}
	};

	const fetchAiOptions = async () => {
		try {
			const [m, a, p] = await Promise.all([
				api.get<{ items: Array<{ id: string } & Model> }>("models"),
				api.get<{ items: Array<{ id: string } & Agent> }>("agents"),
				api.get<{ items: Array<{ id: string } & OutputProfile> }>("output-profiles"),
			]);
			setModels(m.items);
			setAgents(a.items);
			setProfiles(p.items);
		} catch {
			/* AI options are optional; ignore load failures */
		}
	};

	useEffect(() => {
		fetchSources();
		fetchAiOptions();
	}, []);

	// Toggle an agent in the selection, enforcing at most one per fixed kind.
	const toggleAgent = (agent: { id: string } & Agent) => {
		setFormFields((prev) => {
			const current = prev.aiAgentIds || [];
			if (current.includes(agent.id)) {
				return { ...prev, aiAgentIds: current.filter((x) => x !== agent.id) };
			}
			let next = current;
			if (FIXED_KINDS.includes(agent.kind)) {
				const sameKindIds = agents.filter((a) => a.kind === agent.kind).map((a) => a.id);
				next = current.filter((x) => !sameKindIds.includes(x));
			}
			return { ...prev, aiAgentIds: [...next, agent.id] };
		});
	};

	const handleOpenAdd = () => {
		setEditingSource(null);
		setFormFields({
			name: "",
			url: "",
			siteUrl: "",
			tag: "",
			importLimit: 50,
			importOrder: "desc",
			ageLimit: 0,
			ageLimitUnit: "days",
			uniqueBy: "guid",
			reconcileStrategy: "preserve",
			trimContent: false,
			contentMaxWords: 150,
			enableFullText: false,
			aiModelId: undefined,
			aiAgentIds: [],
			slug: "",
			outputProfileId: undefined,
			keywordFilterEnabled: false,
			keywordFilterMode: "include",
			keywords: [],
			keywordMatchIn: ["title"],
			authorHandling: "from-feed",
			fallbackAuthor: "",
			overrideAuthor: "",
			assignFeaturedImage: true,
			featuredImageSource: "first-in-content",
			openInNewTab: true,
			nofollow: true,
			canonicalLink: false,
			fetchInterval: 60,
		});
		setIsModalOpen(true);
	};

	const handleOpenEdit = (source: { id: string } & Source) => {
		setEditingSource(source);
		setFormFields({ ...source });
		setIsModalOpen(true);
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!formFields.name || !formFields.url) {
			alert("Name and Feed URL are required.");
			return;
		}

		try {
			if (editingSource) {
				await api.post("sources/update", {
					id: editingSource.id,
					...formFields,
				});
			} else {
				await api.post("sources/create", formFields);
			}
			setIsModalOpen(false);
			fetchSources();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to save feed source");
		}
	};

	const handleToggleStatus = async (source: { id: string } & Source) => {
		const newStatus: SourceStatus = source.status === "paused" ? "active" : "paused";
		try {
			await api.post("sources/update", {
				id: source.id,
				status: newStatus,
			});
			fetchSources();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to toggle status");
		}
	};

	const handleFetchNow = async (id: string) => {
		setActionLoading((prev) => ({ ...prev, [id]: true }));
		try {
			await api.post("sources/fetch-now", { id });
			alert("Feed fetched and imported successfully.");
			fetchSources();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to fetch feed");
		} finally {
			setActionLoading((prev) => ({ ...prev, [id]: false }));
		}
	};

	const handleConfirmDelete = (id: string) => {
		setSourceToDelete(id);
		setIsDeleteOpen(true);
	};

	const handleDelete = async () => {
		if (!sourceToDelete) return;
		try {
			await api.post("sources/delete", { id: sourceToDelete });
			setIsDeleteOpen(false);
			fetchSources();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete feed source");
		}
	};

	const handleUpdateField = (key: keyof Source, value: any) => {
		setFormFields((prev) => ({ ...prev, [key]: value }));
	};

	// Stats calculation
	const totalSources = sources.length;
	const activeSources = sources.filter((s) => s.status === "active").length;
	const pausedSources = sources.filter((s) => s.status === "paused").length;
	const errorSources = sources.filter((s) => s.status === "error").length;

	const columns = [
		{
			key: "name",
			label: "Name",
			render: (_: any, row: any) => (
				<div>
					<div style={{ fontWeight: 600 }}>{row.name}</div>
					{row.tag && (
						<span style={{ fontSize: "11px", background: "#eee", padding: "2px 6px", borderRadius: "4px" }}>
							Tag: {row.tag}
						</span>
					)}
				</div>
			),
		},
		{
			key: "url",
			label: "Feed URL",
			render: (val: any) => (
				<a href={val as string} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "#555" }}>
					{truncateText(val as string, 40)}
				</a>
			),
		},
		{
			key: "status",
			label: "Status",
			render: (val: any, row: any) => (
				<div>
					<Badge variant={getStatusVariant(val as string)}>{val as string}</Badge>
					{row.lastError && (
						<div style={{ fontSize: "10px", color: "red", marginTop: "2px" }} title={row.lastError}>
							{truncateText(row.lastError, 25)}
						</div>
					)}
				</div>
			),
		},
		{
			key: "itemCount",
			label: "Items",
			render: (val: any) => <span>{val ?? 0}</span>,
		},
		{
			key: "fetchInterval",
			label: "Interval",
			render: (val: any) => <span>{val} mins</span>,
		},
		{
			key: "lastFetchedAt",
			label: "Last Fetched",
			render: (val: any) => <span>{val ? formatRelativeTime(val as string) : "Never"}</span>,
		},
		{
			key: "actions",
			label: "Actions",
			width: "260px",
			render: (_: any, row: any) => (
				<div style={{ display: "flex", gap: "6px" }}>
					<Button
						variant="secondary"
						size="sm"
						loading={actionLoading[row.id]}
						onClick={() => handleFetchNow(row.id)}
					>
						Fetch Now
					</Button>
					<Button variant="secondary" size="sm" onClick={() => handleOpenEdit(row as any)}>
						Edit
					</Button>
					<Button variant="ghost" size="sm" onClick={() => handleToggleStatus(row as any)}>
						{row.status === "paused" ? "Resume" : "Pause"}
					</Button>
					<Button variant="danger" size="sm" onClick={() => handleConfirmDelete(row.id)}>
						Delete
					</Button>
				</div>
			),
		},
	];

	const formTabs = [
		{
			id: "general",
			label: "General",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Input
						label="Name"
						value={formFields.name || ""}
						onChange={(val) => handleUpdateField("name", val)}
						placeholder="E.g., TechCrunch Feed"
					/>
					<div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
						<div style={{ flex: 1 }}>
							<Input
								label="Feed URL"
								value={formFields.url || ""}
								onChange={(val) => handleUpdateField("url", val)}
								placeholder="https://example.com/feed"
							/>
						</div>
						<Button
							variant="secondary"
							onClick={() => handlePreviewFeed(formFields.url)}
							disabled={!formFields.url}
						>
							Preview
						</Button>
					</div>
					<Input
						label="Site Link (Optional)"
						value={formFields.siteUrl || ""}
						onChange={(val) => handleUpdateField("siteUrl", val)}
						placeholder="https://example.com"
					/>
					<Input
						label="Tag / Folder"
						value={formFields.tag || ""}
						onChange={(val) => handleUpdateField("tag", val)}
						placeholder="E.g., technology"
					/>
					<NumberInput
						label="Fetch Interval (Minutes)"
						value={formFields.fetchInterval || 60}
						onChange={(val) => handleUpdateField("fetchInterval", val)}
						min={5}
						max={1440}
					/>
				</div>
			),
		},
		{
			id: "import",
			label: "Import & Deduplication",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<NumberInput
						label="Import Limit (Max items to keep)"
						value={formFields.importLimit || 50}
						onChange={(val) => handleUpdateField("importLimit", val)}
						min={0}
						max={1000}
					/>
					<Select
						label="Import Order"
						value={formFields.importOrder || "desc"}
						onChange={(val) => handleUpdateField("importOrder", val)}
						options={[
							{ label: "Newest first", value: "desc" },
							{ label: "Oldest first", value: "asc" },
						]}
					/>
					<div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
						<div style={{ flex: 1 }}>
							<NumberInput
								label="Age Limit (0 to disable)"
								value={formFields.ageLimit || 0}
								onChange={(val) => handleUpdateField("ageLimit", val)}
								min={0}
							/>
						</div>
						<div style={{ width: "120px" }}>
							<Select
								label="Unit"
								value={formFields.ageLimitUnit || "days"}
								onChange={(val) => handleUpdateField("ageLimitUnit", val)}
								options={[
									{ label: "Hours", value: "hours" },
									{ label: "Days", value: "days" },
								]}
							/>
						</div>
					</div>
					<Select
						label="Unique By"
						value={formFields.uniqueBy || "guid"}
						onChange={(val) => handleUpdateField("uniqueBy", val)}
						options={[
							{ label: "GUID (Standard)", value: "guid" },
							{ label: "Title (Fallback)", value: "title" },
						]}
					/>
					<Select
						label="Reconciliation Strategy"
						value={formFields.reconcileStrategy || "preserve"}
						onChange={(val) => handleUpdateField("reconcileStrategy", val)}
						options={[
							{ label: "Keep existing items (Preserve)", value: "preserve" },
							{ label: "Update existing items (Overwrite)", value: "overwrite" },
						]}
					/>
				</div>
			),
		},
		{
			id: "content",
			label: "Content & Images",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Toggle
						label="Trim Content excerpt"
						checked={formFields.trimContent || false}
						onChange={(val) => handleUpdateField("trimContent", val)}
						description="Truncate full content to a specific word count"
					/>
					{formFields.trimContent && (
						<NumberInput
							label="Max Content Words"
							value={formFields.contentMaxWords || 150}
							onChange={(val) => handleUpdateField("contentMaxWords", val)}
							min={10}
							max={1000}
						/>
					)}
					<Toggle
						label="Assign Featured Image"
						checked={formFields.assignFeaturedImage || false}
						onChange={(val) => handleUpdateField("assignFeaturedImage", val)}
						description="Extract and assign images to imported feed items"
					/>
					{formFields.assignFeaturedImage && (
						<Select
							label="Featured Image Source"
							value={formFields.featuredImageSource || "first-in-content"}
							onChange={(val) => handleUpdateField("featuredImageSource", val)}
							options={[
								{ label: "First img tag in content", value: "first-in-content" },
								{ label: "Enclosure tag", value: "enclosure" },
								{ label: "Media RSS Thumbnail", value: "media-thumbnail" },
							]}
						/>
					)}
					<Toggle
						label="Enable Full-text Import"
						checked={formFields.enableFullText || false}
						onChange={(val) => handleUpdateField("enableFullText", val)}
						description="Attempt to fetch full article body from original site"
					/>
				</div>
			),
		},
		{
			id: "authors",
			label: "Authors & Links",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Select
						label="Author Handling"
						value={formFields.authorHandling || "from-feed"}
						onChange={(val) => handleUpdateField("authorHandling", val)}
						options={[
							{ label: "Keep from feed (Default)", value: "from-feed" },
							{ label: "Use fallback if empty", value: "fallback" },
							{ label: "Override always", value: "override" },
						]}
					/>
					{formFields.authorHandling === "fallback" && (
						<Input
							label="Fallback Author"
							value={formFields.fallbackAuthor || ""}
							onChange={(val) => handleUpdateField("fallbackAuthor", val)}
						/>
					)}
					{formFields.authorHandling === "override" && (
						<Input
							label="Override Author"
							value={formFields.overrideAuthor || ""}
							onChange={(val) => handleUpdateField("overrideAuthor", val)}
						/>
					)}
					<Toggle
						label="Open links in new tab"
						checked={formFields.openInNewTab || false}
						onChange={(val) => handleUpdateField("openInNewTab", val)}
					/>
					<Toggle
						label="Add rel='nofollow'"
						checked={formFields.nofollow || false}
						onChange={(val) => handleUpdateField("nofollow", val)}
					/>
					<Toggle
						label="Add rel='canonical' tag"
						checked={formFields.canonicalLink || false}
						onChange={(val) => handleUpdateField("canonicalLink", val)}
					/>
				</div>
			),
		},
		{
			id: "filters",
			label: "Filters",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Toggle
						label="Enable Keyword Filtering"
						checked={formFields.keywordFilterEnabled || false}
						onChange={(val) => handleUpdateField("keywordFilterEnabled", val)}
					/>
					{formFields.keywordFilterEnabled && (
						<>
							<Select
								label="Filter Mode"
								value={formFields.keywordFilterMode || "include"}
								onChange={(val) => handleUpdateField("keywordFilterMode", val)}
								options={[
									{ label: "Only import items matching keywords", value: "include" },
									{ label: "Exclude items matching keywords", value: "exclude" },
								]}
							/>
							<TextArea
								label="Keywords (comma separated)"
								value={formFields.keywords?.join(", ") || ""}
								onChange={(val) =>
									handleUpdateField(
										"keywords",
										val.split(",").map((k) => k.trim())
									)
								}
								placeholder="tech, gadgets, startup"
							/>
						</>
					)}
				</div>
			),
		},
		{
			id: "ai",
			label: "AI & Output",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Select
						label="AI Model"
						value={formFields.aiModelId || ""}
						onChange={(val) => handleUpdateField("aiModelId", val || undefined)}
						options={[
							{ label: "— none —", value: "" },
							...models
								.filter((m) => m.verifiedAt)
								.map((m) => ({ label: m.name, value: m.id })),
						]}
					/>
					<div>
						<label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
							Agents
						</label>
						<div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "6px" }}>
							At most one summary / rewrite / translate agent; custom agents stack freely.
						</div>
						<div style={{ border: "1px solid #d1d5db", padding: "10px", borderRadius: "6px", maxHeight: "180px", overflowY: "auto" }}>
							{agents.map((a) => (
								<label key={a.id} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0", cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={(formFields.aiAgentIds || []).includes(a.id)}
										onChange={() => toggleAgent(a)}
									/>
									<span style={{ fontSize: "13px" }}>{a.name}</span>
									<Badge variant="info">{a.kind}</Badge>
								</label>
							))}
							{agents.length === 0 && (
								<span style={{ fontSize: "13px", color: "#888" }}>No agents yet — create them on the AI page.</span>
							)}
						</div>
					</div>
					<Select
						label="Output Profile"
						value={formFields.outputProfileId || ""}
						onChange={(val) => handleUpdateField("outputProfileId", val || undefined)}
						options={[
							{ label: "— none (keep internal) —", value: "" },
							...profiles.map((p) => ({ label: p.name, value: p.id })),
						]}
					/>
					<Input
						label="Source slug (prefix / category)"
						value={formFields.slug || ""}
						onChange={(val) => handleUpdateField("slug", val)}
						description="Used by the {sourceSlug} token and as the published post's category."
					/>
				</div>
			),
		},
	];

	if (loading) return <Loading size="lg" />;

	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="Feed Sources"
				description="Manage RSS and Atom feed sources imported into the CMS."
				actions={<Button variant="primary" onClick={handleOpenAdd}>Add Source</Button>}
			/>

			{error && <Alert variant="error" title="Load Error">{error}</Alert>}

			<StatGroup>
				<Stat label="Total Sources" value={totalSources} />
				<Stat label="Active" value={activeSources} />
				<Stat label="Paused" value={pausedSources} />
				<Stat label="Errors" value={errorSources} />
			</StatGroup>

			<Card>
				<Table
					columns={columns}
					data={sources as any}
					emptyMessage="No feed sources found. Click 'Add Source' to create one."
				/>
			</Card>

			{/* Add/Edit Modal */}
			<Modal
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={editingSource ? "Edit Feed Source" : "Add Feed Source"}
				size="lg"
			>
				<form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
					<Tabs tabs={formTabs} defaultTab="general" />
					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
						<Button variant="secondary" onClick={() => setIsModalOpen(false)}>
							Cancel
						</Button>
						<Button variant="primary" type="submit">
							Save Source
						</Button>
					</div>
				</form>
			</Modal>

			{/* Delete Confirm */}
			<ConfirmDialog
				open={isDeleteOpen}
				title="Delete Feed Source?"
				description="This will permanently delete the feed source and all its imported items and logs. This action cannot be undone."
				confirmLabel="Delete Permanently"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setIsDeleteOpen(false)}
			/>

			{/* Preview Modal */}
			<Modal
				open={isPreviewOpen}
				onClose={() => setIsPreviewOpen(false)}
				title="Feed Preview"
				size="lg"
			>
				{previewLoading && <Loading />}
				{previewError && <Alert variant="error" title="Preview Error">{previewError}</Alert>}
				{previewData && (
					<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
						<div style={{ padding: "12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: "6px", border: "1px solid var(--color-border, #eee)" }}>
							<h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--color-text, #111)" }}>
								{previewData.feed.title}
							</h3>
							{previewData.feed.description && (
								<p style={{ margin: "0 0 8px", fontSize: "13px", color: "var(--color-text-secondary, #666)" }}>
									{previewData.feed.description}
								</p>
							)}
							<div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "var(--color-muted, #888)", flexWrap: "wrap" }}>
								<span>Format: <strong style={{ color: "var(--color-text, #111)" }}>{previewData.feed.format}</strong></span>
								<span>Items: <strong style={{ color: "var(--color-text, #111)" }}>{previewData.feed.itemCount}</strong></span>
								<span>Link: <a href={previewData.feed.link} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent, #2563eb)", textDecoration: "underline" }}>{previewData.feed.link}</a></span>
							</div>
						</div>

						<h4 style={{ margin: "8px 0 0", fontSize: "14px", fontWeight: 600 }}>Latest Items Preview (Max 10)</h4>
						
						<Table
							columns={[
								{
									key: "title",
									label: "Title",
									render: (_, row: any) => {
										const cleanDesc = row.description ? row.description.replace(/<[^>]+>/g, "") : "";
										return (
											<div>
												<a href={row.link} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--color-accent, #2563eb)", textDecoration: "none" }}>
													{row.title}
												</a>
												{cleanDesc && (
													<div style={{ fontSize: "12px", color: "var(--color-text-secondary, #666)", marginTop: "4px" }}>
														{truncateText(cleanDesc, 120)}
													</div>
												)}
											</div>
										);
									}
								},
								{
									key: "pubDate",
									label: "Published Date",
									width: "180px",
									render: (val: any) => <span style={{ fontSize: "12px" }}>{val ? new Date(val).toLocaleString() : "N/A"}</span>
								},
								{
									key: "author",
									label: "Author",
									width: "120px",
									render: (val: any) => <span style={{ fontSize: "12px" }}>{val?.name || "N/A"}</span>
								}
							]}
							data={previewData.items}
							emptyMessage="No items found in this feed preview."
						/>

						<div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
							<Button variant="secondary" onClick={() => setIsPreviewOpen(false)}>
								Close Preview
							</Button>
						</div>
					</div>
				)}
			</Modal>
		</div>
	);
};

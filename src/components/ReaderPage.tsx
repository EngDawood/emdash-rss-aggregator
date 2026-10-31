import React, { useState, useEffect } from "react";
import {
	usePluginAPI,
	PageHeader,
	Button,
	Badge,
	Select,
	Alert,
	Loading,
	Modal,
	Input,
} from "./ui";
import type { FeedItem, Source, OutputProfile, Agent } from "../types";
import { formatRelativeTime } from "./shared";

function formatMarkdownOrHtml(text: string | undefined): string {
	if (!text) return "";

	let html = text.replace(/\r\n/g, "\n");

	// 1. Horizontal rules (---, ***, ___)
	html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr style="margin: 20px 0; border: 0; border-top: 1px solid var(--color-border-subtle, #231f1a);" />');

	// 2. Headings (# to ######)
	html = html.replace(/^######\s+(.*?)$/gm, '<h6 style="font-size: 1.0em; font-weight: 600; margin-top: 12px; margin-bottom: 6px;">$1</h6>');
	html = html.replace(/^#####\s+(.*?)$/gm, '<h5 style="font-size: 1.1em; font-weight: 600; margin-top: 14px; margin-bottom: 7px;">$1</h5>');
	html = html.replace(/^####\s+(.*?)$/gm, '<h4 style="font-size: 1.15em; font-weight: 600; margin-top: 16px; margin-bottom: 8px;">$1</h4>');
	html = html.replace(/^###\s+(.*?)$/gm, '<h3 style="font-size: 1.25em; font-weight: 600; margin-top: 18px; margin-bottom: 9px;">$1</h3>');
	html = html.replace(/^##\s+(.*?)$/gm, '<h2 style="font-size: 1.4em; font-weight: 600; margin-top: 20px; margin-bottom: 10px;">$1</h2>');
	html = html.replace(/^#\s+(.*?)$/gm, '<h1 style="font-size: 1.6em; font-weight: 700; margin-top: 24px; margin-bottom: 12px;">$1</h1>');

	// 3. Bold: **text** or __text__
	html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

	// 4. Italic: *text* or _text_
	html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
	html = html.replace(/_(.*?)_/g, "<em>$1</em>");

	// 5. Code: `code`
	html = html.replace(/`(.*?)`/g, '<code style="font-family: monospace; background: var(--color-bg-subtle, #141210); padding: 2px 4px; border-radius: 4px;">$1</code>');

	// Check if the input already contains HTML block tags (like <p>, <div>, <h3>, etc.)
	const hasHtmlParagraphs = /<p\b[^>]*>|<div\b[^>]*>/i.test(html);
	if (!hasHtmlParagraphs) {
		// Convert newlines to paragraph tags
		const parts = html.split(/\n\s*\n/);
		html = parts
			.map((part) => {
				const trimmed = part.trim();
				if (!trimmed) return "";
				// If it's already wrapped in a block-level tag (like <h1>-<h6> or <hr />), don't wrap in <p>
				if (/^<(h[1-6]|hr|blockquote|ul|ol|li)\b[^>]*>/i.test(trimmed)) {
					return trimmed;
				}
				// Replace single newlines inside paragraph with <br />
				const withLineBreaks = trimmed.replace(/\n/g, "<br />");
				return `<p style="margin-bottom: 16px; line-height: 1.6;">${withLineBreaks}</p>`;
			})
			.filter(Boolean)
			.join("\n");
	}

	return html;
}

export const ReaderPage: React.FC = () => {
	const api = usePluginAPI();
	const [items, setItems] = useState<Array<{ id: string } & FeedItem>>([]);
	const [sources, setSources] = useState<Array<{ id: string; name: string; outputProfileId?: string; aiAgentIds?: string[]; aiModelId?: string }>>([]);
	const [profiles, setProfiles] = useState<Array<{ id: string } & OutputProfile>>([]);
	const [agents, setAgents] = useState<Array<{ id: string } & Agent>>([]);
	const [loading, setLoading] = useState(true);
	const [loadingItems, setLoadingItems] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Selected Feed Item
	const [selectedItem, setSelectedItem] = useState<({ id: string } & FeedItem) | null>(null);

	// Filters & Pagination
	const [selectedSource, setSelectedSource] = useState<string>("");
	const [statusFilter, setStatusFilter] = useState<string>("");
	const [searchQuery, setSearchQuery] = useState<string>("");
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [hasMore, setHasMore] = useState(false);

	// Action states
	const [busyId, setBusyId] = useState<string | null>(null);
	const [rejectingItem, setRejectingItem] = useState<{ id: string; title: string } | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	const [isRejectLoading, setIsRejectLoading] = useState(false);
	const [publishingId, setPublishingId] = useState<string | null>(null);

	// Right Panel Tab
	const [activeTab, setActiveTab] = useState<"original" | "summary" | "rewrite" | "custom" | "translations">("original");
	const [activeLang, setActiveLang] = useState<string>("");

	const loadInitialData = async () => {
		try {
			setLoading(true);
			const [sourcesData, profilesData, agentsData] = await Promise.all([
				api.get<{ items: Array<{ id: string } & Source> }>("sources"),
				api.get<{ items: Array<{ id: string } & OutputProfile> }>("output-profiles"),
				api.get<{ items: Array<{ id: string } & Agent> }>("agents"),
			]);

			setSources(sourcesData.items.map((s) => ({
				id: s.id,
				name: s.name,
				outputProfileId: s.outputProfileId,
				aiAgentIds: s.aiAgentIds,
				aiModelId: s.aiModelId,
			})));
			setProfiles(profilesData.items);
			setAgents(agentsData.items);

			// Fetch items
			await fetchItems("", "", undefined, true);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load initial reader data");
		} finally {
			setLoading(false);
		}
	};

	const fetchItems = async (
		sourceId: string,
		statusVal: string,
		cursorVal?: string,
		reset: boolean = false
	) => {
		setLoadingItems(true);
		try {
			let url = "items?limit=25";
			if (sourceId) url += `&sourceId=${encodeURIComponent(sourceId)}`;
			if (statusVal) url += `&status=${encodeURIComponent(statusVal)}`;
			if (cursorVal) url += `&cursor=${encodeURIComponent(cursorVal)}`;

			const data = await api.get<{
				items: Array<{ id: string } & FeedItem>;
				cursor?: string;
				hasMore: boolean;
				total: number;
			}>(url);

			const fetchedItems = data.items;

			if (reset) {
				setItems(fetchedItems);
				// Automatically select first item if none is selected
				if (fetchedItems.length > 0) {
					setSelectedItem(fetchedItems[0]);
				} else {
					setSelectedItem(null);
				}
			} else {
				setItems((prev) => [...prev, ...fetchedItems]);
			}
			setCursor(data.cursor);
			setHasMore(data.hasMore);
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
		fetchItems(sourceId, statusFilter, undefined, true);
	};

	const handleStatusChange = (status: string) => {
		setStatusFilter(status);
		fetchItems(selectedSource, status, undefined, true);
	};

	const handleLoadMore = () => {
		if (hasMore && cursor) {
			fetchItems(selectedSource, statusFilter, cursor, false);
		}
	};

	const handleApprove = async (id: string) => {
		setBusyId(id);
		try {
			const res = await api.post<{ item: FeedItem }>("items/approve", { id });
			const updated = { id, ...res.item };
			setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
			if (selectedItem?.id === id) {
				setSelectedItem(updated);
			}
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to approve item");
		} finally {
			setBusyId(null);
		}
	};

	const handleAi = async (id: string, agentId?: string) => {
		setBusyId(id);
		try {
			const res = await api.post<{ item: FeedItem }>("items/ai", { id, agentId });
			const updated = { id, ...res.item };
			setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
			if (selectedItem?.id === id) {
				setSelectedItem(updated);
			}
		} catch (err) {
			alert(err instanceof Error ? err.message : "AI action failed");
		} finally {
			setBusyId(null);
		}
	};

	const handlePublish = async (id: string) => {
		setPublishingId(id);
		try {
			const res = await api.post<{ item: FeedItem }>("items/publish", { id });
			const updated = { id, ...res.item };
			setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
			if (selectedItem?.id === id) {
				setSelectedItem(updated);
			}
			alert("Item successfully published!");
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to publish item");
		} finally {
			setPublishingId(null);
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
			const nextItems = items.filter((i) => i.id !== rejectingItem.id);
			setItems(nextItems);
			if (selectedItem?.id === rejectingItem.id) {
				setSelectedItem(nextItems.length > 0 ? nextItems[0] : null);
			}
			setRejectingItem(null);
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to reject item");
		} finally {
			setIsRejectLoading(false);
		}
	};

	if (loading) return <Loading size="lg" />;

	const sourceOptions = [{ label: "All Sources", value: "" }].concat(
		sources.map((s) => ({ label: s.name, value: s.id }))
	);

	// Client-side search filtering on the title
	const filteredItems = items.filter((item) =>
		item.title?.toLowerCase().includes(searchQuery.toLowerCase())
	);

	// Get corresponding source and output profile for the selected item
	const selectedItemSource = selectedItem
		? sources.find((s) => s.id === selectedItem.sourceId)
		: null;
	const selectedItemProfile = selectedItemSource?.outputProfileId
		? profiles.find((p) => p.id === selectedItemSource.outputProfileId)
		: null;

	// Extract translations locales
	const translationLocales = selectedItem?.translations
		? Object.keys(selectedItem.translations)
		: [];

	// Set initial language tab when selectedItem changes
	if (translationLocales.length > 0 && !activeLang) {
		setActiveLang(translationLocales[0]);
	}

	return (
		<div
			className="feed-reader-container"
			style={{
				display: "flex",
				flexDirection: "column",
				height: "calc(100vh - 70px)",
				gap: "12px",
				padding: "16px",
				background: "var(--color-bg)",
				color: "var(--color-text)",
				fontFamily: "'Outfit', sans-serif",
			}}
		>
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
			<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&display=swap" rel="stylesheet" />
			<style dangerouslySetInnerHTML={{ __html: `
				.feed-reader-container {
					/* ===== Reading Room design tokens ===== */
					--rr-bg: #F3EEE2;
					--rr-surface: #EAE2CE;
					--rr-surface-2: #E2D8C0;
					--rr-ink: #2a2620;
					--rr-ink-soft: #564d3f;
					--rr-muted: #9a8d78;
					--rr-line: #ddd3bb;
					--rr-line-strong: #c8bda1;
					--rr-accent: #B85A3A;
					--rr-accent-soft: rgba(184,90,58,.12);
					--rr-onaccent: #F8F4EA;
					
					--color-bg: var(--rr-bg);
					--color-bg-subtle: var(--rr-surface-2);
					--color-surface: var(--rr-surface);
					--color-border: var(--rr-line);
					--color-border-subtle: var(--rr-line-strong);
					--color-text: var(--rr-ink);
					--color-text-secondary: var(--rr-ink-soft);
					--color-muted: var(--rr-muted);
					--color-accent: var(--rr-accent);
					--color-on-accent: var(--rr-onaccent);
				}

				:root.dark .feed-reader-container {
					--rr-bg: #16130f;
					--rr-surface: #211c16;
					--rr-surface-2: #2b251d;
					--rr-ink: #efe7d7;
					--rr-ink-soft: #c9bda7;
					--rr-muted: #8a7d68;
					--rr-line: #342c22;
					--rr-line-strong: #443a2c;
					--rr-accent: #D9824E;
					--rr-accent-soft: rgba(217,130,78,.16);
					--rr-onaccent: #1a140f;
				}

				@media (prefers-color-scheme: dark) {
					:root:not(.light) .feed-reader-container {
						--rr-bg: #16130f;
						--rr-surface: #211c16;
						--rr-surface-2: #2b251d;
						--rr-ink: #efe7d7;
						--rr-ink-soft: #c9bda7;
						--rr-muted: #8a7d68;
						--rr-line: #342c22;
						--rr-line-strong: #443a2c;
						--rr-accent: #D9824E;
						--rr-accent-soft: rgba(217,130,78,.16);
						--rr-onaccent: #1a140f;
					}
				}

				/* Scrollbar Styling to match mockup */
				.feed-reader-scrollable::-webkit-scrollbar {
					width: 7px;
					height: 7px;
				}
				.feed-reader-scrollable::-webkit-scrollbar-thumb {
					background: var(--rr-line-strong);
					border-radius: 99px;
				}
				.feed-reader-scrollable::-webkit-scrollbar-thumb:hover {
					background: var(--rr-accent);
				}
			` }} />
			<PageHeader
				title="Feed Reader"
				description="Audit, approve, and curate imported items with AI-assisted outputs."
			/>

			{error && <Alert variant="error" title="Error">{error}</Alert>}

			{/* Main Split Screen Container */}
			<div
				style={{
					display: "flex",
					flex: 1,
					minHeight: 0,
					border: "1px solid var(--color-border)",
					borderRadius: "8px",
					background: "var(--color-bg)",
					overflow: "hidden",
				}}
			>
				{/* LEFT COLUMN: Feed Items List */}
				<div
					style={{
						width: "372px",
						flex: "none",
						display: "flex",
						flexDirection: "column",
						background: "var(--color-surface)",
						borderRight: "1px solid var(--color-border)",
						padding: "16px 14px",
						gap: "12px",
						minHeight: 0,
					}}
				>
					{/* Filters */}
					<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
						<div style={{ display: "flex", gap: "8px" }}>
							<div style={{ flex: 1 }}>
								<Select
									label="Source"
									value={selectedSource}
									onChange={handleSourceChange}
									options={sourceOptions}
								/>
							</div>
							<div style={{ width: "110px" }}>
								<Select
									label="Status"
									value={statusFilter}
									onChange={handleStatusChange}
									options={[
										{ label: "All Status", value: "" },
										{ label: "Pending", value: "pending" },
										{ label: "Approved", value: "approved" },
										{ label: "Rejected", value: "rejected" },
									]}
								/>
							</div>
						</div>
						<Input
							placeholder="Search titles..."
							value={searchQuery}
							onChange={(val) => setSearchQuery(val)}
						/>
					</div>

					{/* List area */}
					<div
						className="feed-reader-scrollable"
						style={{
							flex: 1,
							overflowY: "auto",
							display: "flex",
							flexDirection: "column",
							gap: "8px",
							paddingRight: "4px",
						}}
					>
						{loadingItems && items.length === 0 ? (
							<Loading size="sm" />
						) : filteredItems.length === 0 ? (
							<div
								style={{
									textAlign: "center",
									padding: "40px 20px",
									color: "var(--color-muted, #80796a)",
									fontSize: "14px",
								}}
							>
								No feed items found.
							</div>
						) : (
							filteredItems.map((item) => {
								const isSelected = selectedItem?.id === item.id;
								const itemStatus = item.status || "approved";

								return (
									<div
										key={item.id}
										onClick={() => {
											setSelectedItem(item);
											// Reset lang tab if new item doesn't have current lang
											const nextLangs = item.translations ? Object.keys(item.translations) : [];
											if (nextLangs.length > 0 && (!nextLangs.includes(activeLang) || !activeLang)) {
												setActiveLang(nextLangs[0]);
											}
										}}
										style={{
											padding: "15px 15px",
											borderRadius: "12px",
											background: isSelected
												? "var(--rr-accent-soft)"
												: "transparent",
											border: "none",
											borderLeft: isSelected
												? "3px solid var(--rr-accent)"
												: "3px solid transparent",
											cursor: "pointer",
											transition: "all 0.15s ease",
											display: "flex",
											flexDirection: "column",
											gap: "6px",
											marginBottom: "4px",
										}}
									>
										<div
											style={{
												fontSize: "9px",
												fontFamily: "'Fira Code', monospace",
												color: isSelected
													? "var(--color-accent)"
													: "var(--color-muted)",
												display: "flex",
												justifyContent: "space-between",
												textTransform: "uppercase",
												letterSpacing: "0.06em",
											}}
										>
											<span style={{ fontWeight: 600 }}>{item.sourceName}</span>
											<span>{formatRelativeTime(item.publishedAt)}</span>
										</div>

										<h4
											style={{
												margin: 0,
												fontSize: "16px",
												fontFamily: "'Newsreader', serif",
												fontWeight: 600,
												color: "var(--color-text)",
												lineHeight: 1.3,
											}}
										>
											{item.title}
										</h4>

										{item.excerpt && (
											<div
												style={{
													fontSize: "12px",
													color: "var(--color-text-secondary)",
													lineHeight: 1.5,
													display: "-webkit-box",
													WebkitLineClamp: 2,
													WebkitBoxOrient: "vertical",
													overflow: "hidden",
												}}
											>
												{item.excerpt}
											</div>
										)}

										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												alignItems: "center",
												marginTop: "4px",
											}}
										>
											<Badge
												variant={
													itemStatus === "approved"
														? "success"
														: itemStatus === "pending"
															? "warning"
															: "error"
												}
											>
												{itemStatus}
											</Badge>

											<div style={{ display: "flex", gap: "4px" }}>
												{item.summary && (
													<span
														style={{
															fontSize: "9px",
															background: "rgba(37, 99, 235, 0.15)",
															color: "#60a5fa",
															padding: "1px 4px",
															borderRadius: "3px",
															border: "1px solid rgba(37, 99, 235, 0.3)",
														}}
														title="Summary available"
													>
														TL;DR
													</span>
												)}
												{item.rewrittenContent && (
													<span
														style={{
															fontSize: "9px",
															background: "rgba(124, 58, 237, 0.15)",
															color: "#a78bfa",
															padding: "1px 4px",
															borderRadius: "3px",
															border: "1px solid rgba(124, 58, 237, 0.3)",
														}}
														title="Rewrite available"
													>
														RW
													</span>
												)}
											</div>
										</div>
									</div>
								);
							})
						)}

						{hasMore && (
							<div
								style={{
									display: "flex",
									justifyContent: "center",
									padding: "8px 0",
								}}
							>
								<Button
									variant="secondary"
									size="sm"
									loading={loadingItems}
									onClick={handleLoadMore}
								>
									Load more
								</Button>
							</div>
						)}
					</div>
				</div>

				{/* RIGHT COLUMN: Selected Item Detail View */}
				<div
					style={{
						flex: 1,
						background: "var(--color-bg)",
						display: "flex",
						flexDirection: "column",
						minHeight: 0,
					}}
				>
					{selectedItem ? (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								height: "100%",
								minHeight: 0,
							}}
						>
							{/* 1. Header Toolbar */}
							<div
								style={{
									padding: "24px 28px 16px",
									borderBottom: "1px solid var(--color-border)",
									display: "flex",
									flexDirection: "column",
									gap: "12px",
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "flex-start",
									}}
								>
									<div>
										<div
											style={{
												fontSize: "10px",
												fontFamily: "'Fira Code', monospace",
												color: "var(--color-accent)",
												marginBottom: "8px",
												display: "flex",
												gap: "8px",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
												alignItems: "center",
											}}
										>
											<span>{selectedItem.sourceName}</span>
											{selectedItem.author?.name && (
												<>
													<span style={{ color: "var(--color-muted)" }}>•</span>
													<span>{selectedItem.author.name}</span>
												</>
											)}
											<span style={{ color: "var(--color-muted)" }}>•</span>
											<span style={{ color: "var(--color-muted)" }}>
												{new Date(selectedItem.publishedAt).toLocaleString()}
											</span>
										</div>
										<h2
											style={{
												margin: 0,
												fontSize: "32px",
												fontFamily: "'Newsreader', serif",
												fontWeight: 700,
												color: "var(--color-text)",
												lineHeight: 1.15,
												letterSpacing: "-0.015em",
											}}
										>
											{selectedItem.title}
										</h2>
									</div>

									{/* Status Badge */}
									<Badge
										variant={
											(selectedItem.status || "approved") === "approved"
												? "success"
												: selectedItem.status === "pending"
													? "warning"
													: "error"
										}
									>
										{selectedItem.status || "approved"}
									</Badge>
								</div>

								{/* Output Profile info row */}
								{selectedItemSource && (
									<div
										style={{
											fontSize: "12px",
											padding: "8px 12px",
											borderRadius: "6px",
											background: "var(--color-bg-subtle, #141210)",
											border: "1px solid var(--color-border-subtle, #231f1a)",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											flexWrap: "wrap",
											gap: "8px",
										}}
									>
										<div>
											<span style={{ color: "var(--color-muted, #80796a)" }}>Bound Profile: </span>
											<strong>
												{selectedItemProfile
													? `${selectedItemProfile.name} (mode: ${selectedItemProfile.mode}, body: ${selectedItemProfile.bodySource})`
													: "None"}
											</strong>
										</div>
										{selectedItem.publishedContentId && selectedItemProfile && (
											<a
												href={`/_emdash/admin/content/${selectedItemProfile.collection}/${selectedItem.publishedContentId}`}
												target="_blank"
												rel="noreferrer"
												style={{
													color: "var(--color-accent, #9b2346)",
													fontWeight: 600,
													textDecoration: "underline",
												}}
											>
												View published CMS entry
											</a>
										)}
									</div>
								)}

								{/* Actions Toolbar */}
								<div
									style={{
										display: "flex",
										gap: "8px",
										flexWrap: "wrap",
										borderTop: "1px solid var(--color-border-subtle, #231f1a)",
										paddingTop: "12px",
									}}
								>
									{selectedItem.status === "pending" && (
										<Button
											variant="primary"
											size="sm"
											loading={busyId === selectedItem.id}
											onClick={() => handleApprove(selectedItem.id)}
										>
											Approve
										</Button>
									)}

									{selectedItemSource?.outputProfileId && (
										<Button
											variant="primary"
											size="sm"
											loading={publishingId === selectedItem.id}
											onClick={() => handlePublish(selectedItem.id)}
										>
											Publish Now
										</Button>
									)}

									<div style={{ display: "inline-flex", gap: "4px" }}>
										<Button
											variant="secondary"
											size="sm"
											loading={busyId === selectedItem.id}
											onClick={() => handleAi(selectedItem.id)}
										>
											Re-run AI
										</Button>

										{selectedItemSource?.aiAgentIds && selectedItemSource.aiAgentIds.length > 0 && (
											<select
												onChange={(e) => {
													const val = e.target.value;
													if (val) {
														handleAi(selectedItem.id, val);
														e.target.value = "";
													}
												}}
												disabled={busyId === selectedItem.id}
												style={{
													padding: "4px 8px",
													fontSize: "12px",
													borderRadius: "4px",
													background: "var(--color-bg-subtle)",
													color: "var(--color-text)",
													border: "1px solid var(--color-border-subtle)",
													cursor: "pointer",
													fontFamily: "'Outfit', sans-serif",
												}}
											>
												<option value="">Specific Agent...</option>
												{selectedItemSource.aiAgentIds.map((agentId) => {
													const agent = agents.find((a) => a.id === agentId);
													return agent ? (
														<option key={agent.id} value={agent.id}>
															{agent.name}
														</option>
													) : null;
												})}
											</select>
										)}
									</div>

									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											handleOpenReject({ id: selectedItem.id, title: selectedItem.title })
										}
									>
										Reject
									</Button>

									<a
										href={selectedItem.url}
										target="_blank"
										rel="noreferrer"
										style={{ textDecoration: "none" }}
									>
										<Button variant="ghost" size="sm">
											Open Original
										</Button>
									</a>
								</div>
							</div>

							{/* 2. Detail Body area (Tabs + Content) */}
							<div
								style={{
									flex: 1,
									display: "flex",
									flexDirection: "column",
									minHeight: 0,
									padding: "16px 28px",
								}}
							>
								{/* Custom Tab Headers */}
								<div
									style={{
										display: "flex",
										gap: "24px",
										borderBottom: "1px solid var(--color-border-subtle)",
										marginBottom: "16px",
									}}
								>
									<button
										type="button"
										onClick={() => setActiveTab("original")}
										style={{
											padding: "8px 0",
											background: "none",
											border: "none",
											cursor: "pointer",
											color:
												activeTab === "original"
													? "var(--color-accent)"
													: "var(--color-muted)",
											borderBottom:
												activeTab === "original"
													? "2px solid var(--color-accent)"
													: "2px solid transparent",
											fontWeight: activeTab === "original" ? 600 : 500,
											fontSize: "13px",
											fontFamily: "'Outfit', sans-serif",
											letterSpacing: "0.05em",
											textTransform: "uppercase",
										}}
									>
										Original Content
									</button>
									<button
										type="button"
										onClick={() => setActiveTab("summary")}
										style={{
											padding: "8px 0",
											background: "none",
											border: "none",
											cursor: "pointer",
											color:
												activeTab === "summary"
													? "var(--color-accent)"
													: "var(--color-muted)",
											borderBottom:
												activeTab === "summary"
													? "2px solid var(--color-accent)"
													: "2px solid transparent",
											fontWeight: activeTab === "summary" ? 600 : 500,
											fontSize: "13px",
											fontFamily: "'Outfit', sans-serif",
											letterSpacing: "0.05em",
											textTransform: "uppercase",
										}}
									>
										AI Summary (TL;DR)
									</button>
									<button
										type="button"
										onClick={() => setActiveTab("rewrite")}
										style={{
											padding: "8px 0",
											background: "none",
											border: "none",
											cursor: "pointer",
											color:
												activeTab === "rewrite"
													? "var(--color-accent)"
													: "var(--color-muted)",
											borderBottom:
												activeTab === "rewrite"
													? "2px solid var(--color-accent)"
													: "2px solid transparent",
											fontWeight: activeTab === "rewrite" ? 600 : 500,
											fontSize: "13px",
											fontFamily: "'Outfit', sans-serif",
											letterSpacing: "0.05em",
											textTransform: "uppercase",
										}}
									>
										AI Rewrite
									</button>
									{selectedItem.aiOutputs && Object.keys(selectedItem.aiOutputs).length > 0 && (
										<button
											type="button"
											onClick={() => setActiveTab("custom")}
											style={{
												padding: "8px 0",
												background: "none",
												border: "none",
												cursor: "pointer",
												color:
													activeTab === "custom"
														? "var(--color-accent)"
														: "var(--color-muted)",
												borderBottom:
													activeTab === "custom"
														? "2px solid var(--color-accent)"
														: "2px solid transparent",
												fontWeight: activeTab === "custom" ? 600 : 500,
												fontSize: "13px",
												fontFamily: "'Outfit', sans-serif",
												letterSpacing: "0.05em",
												textTransform: "uppercase",
											}}
										>
											Custom AI
										</button>
									)}
									{translationLocales.length > 0 && (
										<button
											type="button"
											onClick={() => setActiveTab("translations")}
											style={{
												padding: "8px 0",
												background: "none",
												border: "none",
												cursor: "pointer",
												color:
													activeTab === "translations"
														? "var(--color-accent)"
														: "var(--color-muted)",
												borderBottom:
													activeTab === "translations"
														? "2px solid var(--color-accent)"
														: "2px solid transparent",
												fontWeight: activeTab === "translations" ? 600 : 500,
												fontSize: "13px",
												fontFamily: "'Outfit', sans-serif",
												letterSpacing: "0.05em",
												textTransform: "uppercase",
											}}
										>
											Translations ({translationLocales.length})
										</button>
									)}
								</div>

								{/* Scrollable Content Pane */}
								<div
									className="feed-reader-scrollable"
									style={{
										flex: 1,
										overflowY: "auto",
										fontSize: "17px",
										lineHeight: 1.78,
										color: "var(--color-text-secondary)",
										fontFamily: "'Newsreader', Georgia, serif",
										paddingRight: "8px",
									}}
								>
									{/* Featured Image display */}
									{selectedItem.imageUrl && activeTab !== "custom" && (
										<div style={{ marginBottom: "16px", borderRadius: "6px", overflow: "hidden" }}>
											<img
												src={selectedItem.imageUrl}
												alt={selectedItem.title}
												style={{
													width: "100%",
													maxHeight: "300px",
													objectFit: "cover",
												}}
											/>
										</div>
									)}

									{/* Render active tab content */}
									{activeTab === "original" && (
										<div>
											{selectedItem.content ? (
												<div dangerouslySetInnerHTML={{ __html: selectedItem.content }} />
											) : selectedItem.excerpt ? (
												<p>{selectedItem.excerpt}</p>
											) : (
												<p style={{ fontStyle: "italic", color: "var(--color-muted)" }}>
													No content body retrieved from feed.
												</p>
											)}
										</div>
									)}

									{activeTab === "summary" && (
										<div>
											{selectedItem.summary ? (
												<div>
													<p style={{ fontSize: "16px", fontWeight: 400, color: "var(--color-text)" }}>
														{selectedItem.summary}
													</p>
													<div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
														<Button
															variant="ghost"
															size="sm"
															loading={busyId === selectedItem.id}
															onClick={() => {
																const sourceObj = sources.find((s) => s.id === selectedItem.sourceId);
																const summaryAgent = agents.find((a) => a.kind === "summary" && sourceObj?.aiAgentIds?.includes(a.id))
																	|| agents.find((a) => a.kind === "summary");
																if (summaryAgent) {
																	handleAi(selectedItem.id, summaryAgent.id);
																} else {
																	alert("No summary agent found in the system. Please create a summary agent in Settings.");
																}
															}}
														>
															Regenerate Summary
														</Button>
													</div>
												</div>
											) : (
												<div style={{ textAlign: "center", padding: "30px 0" }}>
													<p style={{ color: "var(--color-muted)" }}>No AI Summary generated.</p>
													<Button
														variant="secondary"
														size="sm"
														loading={busyId === selectedItem.id}
														onClick={() => {
															const sourceObj = sources.find((s) => s.id === selectedItem.sourceId);
															const summaryAgent = agents.find((a) => a.kind === "summary" && sourceObj?.aiAgentIds?.includes(a.id))
																	|| agents.find((a) => a.kind === "summary");
															if (summaryAgent) {
																handleAi(selectedItem.id, summaryAgent.id);
															} else {
																alert("No summary agent found in the system. Please create a summary agent in Settings.");
															}
														}}
													>
														Generate with AI
													</Button>
												</div>
											)}
										</div>
									)}

									{activeTab === "rewrite" && (
										<div>
											{selectedItem.rewrittenContent ? (
												<div>
													<div dangerouslySetInnerHTML={{ __html: formatMarkdownOrHtml(selectedItem.rewrittenContent) }} />
													<div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
														<Button
															variant="ghost"
															size="sm"
															loading={busyId === selectedItem.id}
															onClick={() => {
																const sourceObj = sources.find((s) => s.id === selectedItem.sourceId);
																const rewriteAgent = agents.find((a) => a.kind === "rewrite" && sourceObj?.aiAgentIds?.includes(a.id))
																	|| agents.find((a) => a.kind === "rewrite");
																if (rewriteAgent) {
																	handleAi(selectedItem.id, rewriteAgent.id);
																} else {
																	alert("No rewrite agent found in the system. Please create a rewrite agent in Settings.");
																}
															}}
														>
															Regenerate Rewrite
														</Button>
													</div>
												</div>
											) : (
												<div style={{ textAlign: "center", padding: "30px 0" }}>
													<p style={{ color: "var(--color-muted)" }}>No AI Rewrite generated.</p>
													<Button
														variant="secondary"
														size="sm"
														loading={busyId === selectedItem.id}
														onClick={() => {
															const sourceObj = sources.find((s) => s.id === selectedItem.sourceId);
															const rewriteAgent = agents.find((a) => a.kind === "rewrite" && sourceObj?.aiAgentIds?.includes(a.id))
																	|| agents.find((a) => a.kind === "rewrite");
															if (rewriteAgent) {
																handleAi(selectedItem.id, rewriteAgent.id);
															} else {
																alert("No rewrite agent found in the system. Please create a rewrite agent in Settings.");
															}
														}}
													>
														Generate with AI
													</Button>
												</div>
											)}
										</div>
									)}

									{activeTab === "custom" && selectedItem.aiOutputs && (
										<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
											{Object.entries(selectedItem.aiOutputs).map(([key, val]) => (
												<div
													key={key}
													style={{
														padding: "12px",
														background: "var(--color-bg-subtle, #141210)",
														border: "1px solid var(--color-border-subtle, #231f1a)",
														borderRadius: "6px",
													}}
												>
													<div
														style={{
															fontSize: "11px",
															fontWeight: 600,
															textTransform: "uppercase",
															color: "var(--color-muted, #80796a)",
															marginBottom: "4px",
														}}
													>
														Agent ID / Output Key: {key}
													</div>
													<div
														style={{ color: "var(--color-text)" }}
														dangerouslySetInnerHTML={{ __html: formatMarkdownOrHtml(val) }}
													/>
												</div>
											))}
										</div>
									)}

									{activeTab === "translations" && selectedItem.translations && (
										<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
											{/* Translation Language Tab bar */}
											<div
												style={{
													display: "flex",
													gap: "8px",
													borderBottom: "1px solid var(--color-border-subtle, #231f1a)",
													paddingBottom: "8px",
												}}
											>
												{translationLocales.map((lang) => (
													<button
														key={lang}
														type="button"
														onClick={() => setActiveLang(lang)}
														style={{
															padding: "4px 10px",
															borderRadius: "4px",
															background:
																activeLang === lang
																	? "var(--color-accent, #9b2346)"
																	: "var(--color-bg-subtle, #141210)",
															color:
																activeLang === lang
																	? "var(--color-on-accent, #fdfbf6)"
																	: "var(--color-text-secondary, #a89e8c)",
															border: "none",
															cursor: "pointer",
															fontSize: "13px",
															fontWeight: activeLang === lang ? 600 : 500,
														}}
													>
														{lang.toUpperCase()}
													</button>
												))}
											</div>

											{/* Render Selected Translation */}
											{activeLang && selectedItem.translations[activeLang] && (
												<div
													style={{ display: "flex", flexDirection: "column", gap: "12px" }}
													dir={activeLang === "ar" ? "rtl" : "ltr"}
												>
													{selectedItem.translations[activeLang].title && (
														<h3 style={{ margin: "0 0 8px", color: "var(--color-text)" }}>
															{selectedItem.translations[activeLang].title}
														</h3>
													)}
													{selectedItem.translations[activeLang].summary && (
														<div
															style={{
																padding: "12px",
																background: "var(--color-bg-subtle, #141210)",
																borderRadius: "6px",
																fontStyle: "italic",
																marginBottom: "12px",
															}}
														>
															<strong>TL;DR ({activeLang}): </strong>
															{selectedItem.translations[activeLang].summary}
														</div>
													)}
													{selectedItem.translations[activeLang].content ? (
														<div
															dangerouslySetInnerHTML={{
																__html: formatMarkdownOrHtml(selectedItem.translations[activeLang].content) || "",
															}}
														/>
													) : selectedItem.translations[activeLang].excerpt ? (
														<p>{selectedItem.translations[activeLang].excerpt}</p>
													) : (
														<p style={{ fontStyle: "italic", color: "var(--color-muted)" }}>
															No translated content available.
														</p>
													)}
												</div>
											)}
										</div>
									)}
								</div>
							</div>
						</div>
					) : (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flex: 1,
								color: "var(--color-muted, #80796a)",
								fontSize: "14px",
							}}
						>
							Select a feed item from the list to start reading.
						</div>
					)}
				</div>
			</div>

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
		</div>
	);
};
export default ReaderPage;

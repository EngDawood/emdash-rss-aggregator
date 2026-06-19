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
	Card,
	Tabs,
	Alert,
	Loading,
	ConfirmDialog,
} from "@emdash-cms/admin";
import type { Display, Source } from "../types";

export const DisplaysPage: React.FC = () => {
	const api = usePluginAPI();
	const [displays, setDisplays] = useState<Array<{ id: string } & Display>>([]);
	const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Modal states
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingDisplay, setEditingDisplay] = useState<({ id: string } & Display) | null>(null);

	// Confirm delete states
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [displayToDelete, setDisplayToDelete] = useState<string | null>(null);

	// Form fields
	const [formFields, setFormFields] = useState<Partial<Display>>({});

	// Selected sources for the display (helper state for multi-select)
	const [selectedSourcesList, setSelectedSourcesList] = useState<string[]>([]);
	const [selectedExcludedList, setSelectedExcludedList] = useState<string[]>([]);

	const fetchData = async () => {
		try {
			setLoading(true);
			const displaysData = await api.get<{ items: Array<{ id: string } & Display> }>("displays");
			setDisplays(displaysData.items);

			const sourcesData = await api.get<{ items: Array<{ id: string } & Source> }>("sources");
			setSources(sourcesData.items.map((s) => ({ id: s.id, name: s.name })));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load display configurations");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const handleOpenAdd = () => {
		setEditingDisplay(null);
		setSelectedSourcesList([]);
		setSelectedExcludedList([]);
		setFormFields({
			name: "",
			sources: [],
			excludeSources: [],
			tags: [],
			layout: "list",
			numItems: 15,
			enablePagination: true,
			paginationStyle: "numbered",
			htmlClass: "",
			enableTitles: true,
			titleMaxLength: 0,
			linkTitles: true,
			enableSources: true,
			sourcePrefix: "",
			linkSource: true,
			enableDates: true,
			datePrefix: "",
			dateFormat: "F j, Y",
			useRelativeDate: false,
			enableAuthors: true,
			authorPrefix: "By ",
			linkTarget: "_blank",
			linksNoFollow: true,
			linkToEmbeds: false,
			enableExcerpts: true,
			excerptMaxWords: 55,
			excerptEllipsis: "...",
			enableReadMore: true,
			readMoreText: "Read more",
			enableImages: true,
			linkImages: true,
			imageWidth: 150,
			imageHeight: 150,
			fallbackToSourceImage: true,
			gridMaxColumns: 3,
			gridUseImageAsBg: false,
			gridFitImages: true,
			gridEnableEmbeds: false,
			enableAudioPlayer: false,
			audioPlayerPosition: "after",
			enableBullets: false,
			bulletStyle: "disc",
		});
		setIsModalOpen(true);
	};

	const handleOpenEdit = (display: { id: string } & Display) => {
		setEditingDisplay(display);
		setFormFields({ ...display });
		setSelectedSourcesList(display.sources || []);
		setSelectedExcludedList(display.excludeSources || []);
		setIsModalOpen(true);
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!formFields.name) {
			alert("Name is required.");
			return;
		}

		const dataToSave = {
			...formFields,
			sources: selectedSourcesList,
			excludeSources: selectedExcludedList,
		};

		try {
			if (editingDisplay) {
				await api.post("displays/update", {
					id: editingDisplay.id,
					...dataToSave,
				});
			} else {
				await api.post("displays/create", dataToSave);
			}
			setIsModalOpen(false);
			fetchData();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to save display template");
		}
	};

	const handleConfirmDelete = (id: string) => {
		if (id === "default") {
			alert("Cannot delete the default display.");
			return;
		}
		setDisplayToDelete(id);
		setIsDeleteOpen(true);
	};

	const handleDelete = async () => {
		if (!displayToDelete) return;
		try {
			await api.post("displays/delete", { id: displayToDelete });
			setIsDeleteOpen(false);
			fetchData();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete display template");
		}
	};

	const handleUpdateField = (key: keyof Display, value: any) => {
		setFormFields((prev) => ({ ...prev, [key]: value }));
	};

	const toggleSourceSelection = (sourceId: string) => {
		setSelectedSourcesList((prev) =>
			prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
		);
	};

	const toggleExcludedSelection = (sourceId: string) => {
		setSelectedExcludedList((prev) =>
			prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
		);
	};

	const getApiUrl = (id: string) => {
		if (typeof window !== "undefined") {
			return `${window.location.origin}/api/plugins/rss-aggregator/public/items?display=${id}`;
		}
		return `/api/plugins/rss-aggregator/public/items?display=${id}`;
	};

	const columns = [
		{
			key: "name",
			label: "Name",
			render: (_: any, row: any) => (
				<div>
					<div style={{ fontWeight: 600 }}>{row.name}</div>
					{row.id === "default" && <Badge variant="info">Default</Badge>}
				</div>
			),
		},
		{
			key: "layout",
			label: "Layout",
			render: (val: any) => <Badge variant="default">{val as string}</Badge>,
		},
		{
			key: "numItems",
			label: "Items/Page",
		},
		{
			key: "sources",
			label: "Target Sources",
			render: (_: any, row: any) => {
				const srcCount = row.sources?.length || 0;
				if (srcCount === 0) return <span>All Sources</span>;
				return <span>{srcCount} Source(s)</span>;
			},
		},
		{
			key: "apiUrl",
			label: "Theme JSON Endpoint",
			render: (_: any, row: any) => (
				<input
					readOnly
					value={getApiUrl(row.id)}
					onClick={(e) => (e.target as HTMLInputElement).select()}
					style={{
						fontSize: "11px",
						width: "100%",
						padding: "4px 8px",
						borderRadius: "4px",
						border: "1px solid #ccc",
						background: "#f9f9f9",
						cursor: "pointer",
					}}
					title="Click to select all and copy"
				/>
			),
		},
		{
			key: "actions",
			label: "Actions",
			width: "160px",
			render: (_: any, row: any) => (
				<div style={{ display: "flex", gap: "6px" }}>
					<Button variant="secondary" size="sm" onClick={() => handleOpenEdit(row as any)}>
						Edit
					</Button>
					{row.id !== "default" && (
						<Button variant="danger" size="sm" onClick={() => handleConfirmDelete(row.id)}>
							Delete
						</Button>
					)}
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
						placeholder="E.g., Tech news sidebar"
					/>
					<Select
						label="Layout Style"
						value={formFields.layout || "list"}
						onChange={(val) => handleUpdateField("layout", val)}
						options={[
							{ label: "List layout", value: "list" },
							{ label: "Grid layout", value: "grid" },
							{ label: "Full excerpts list", value: "excerpts" },
							{ label: "Thumbnail list", value: "thumbnails" },
						]}
					/>
					<NumberInput
						label="Items to show"
						value={formFields.numItems || 15}
						onChange={(val) => handleUpdateField("numItems", val)}
						min={1}
						max={100}
					/>
					<Toggle
						label="Enable Pagination"
						checked={formFields.enablePagination || false}
						onChange={(val) => handleUpdateField("enablePagination", val)}
					/>
					{formFields.enablePagination && (
						<Select
							label="Pagination Style"
							value={formFields.paginationStyle || "numbered"}
							onChange={(val) => handleUpdateField("paginationStyle", val)}
							options={[
								{ label: "Numbered links", value: "numbered" },
								{ label: "Infinite Load More button", value: "load-more" },
							]}
						/>
					)}
					<div style={{ marginTop: "8px" }}>
						<label style={{ fontSize: "14px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
							Select sources to show (Leave blank for all)
						</label>
						<div style={{ border: "1px solid #ccc", padding: "10px", borderRadius: "4px", maxHeight: "150px", overflowY: "auto" }}>
							{sources.map((s) => (
								<label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0", cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={selectedSourcesList.includes(s.id)}
										onChange={() => toggleSourceSelection(s.id)}
									/>
									<span style={{ fontSize: "13px" }}>{s.name}</span>
								</label>
							))}
							{sources.length === 0 && <span style={{ fontSize: "13px", color: "#888" }}>No sources created yet.</span>}
						</div>
					</div>
				</div>
			),
		},
		{
			id: "titles",
			label: "Titles & Excerpts",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Toggle
						label="Show Title"
						checked={formFields.enableTitles || false}
						onChange={(val) => handleUpdateField("enableTitles", val)}
					/>
					{formFields.enableTitles && (
						<>
							<Toggle
								label="Link Title to original source"
								checked={formFields.linkTitles || false}
								onChange={(val) => handleUpdateField("linkTitles", val)}
							/>
							<NumberInput
								label="Max Title Length (Characters, 0 for unlimited)"
								value={formFields.titleMaxLength || 0}
								onChange={(val) => handleUpdateField("titleMaxLength", val)}
								min={0}
							/>
						</>
					)}
					<hr style={{ border: "0", borderTop: "1px solid #eee", margin: "10px 0" }} />
					<Toggle
						label="Show Excerpts / Descriptions"
						checked={formFields.enableExcerpts || false}
						onChange={(val) => handleUpdateField("enableExcerpts", val)}
					/>
					{formFields.enableExcerpts && (
						<>
							<NumberInput
								label="Max Excerpt Words"
								value={formFields.excerptMaxWords || 55}
								onChange={(val) => handleUpdateField("excerptMaxWords", val)}
								min={5}
								max={200}
							/>
							<Input
								label="Excerpt Ellipsis"
								value={formFields.excerptEllipsis || "..."}
								onChange={(val) => handleUpdateField("excerptEllipsis", val)}
							/>
							<Toggle
								label="Show 'Read more' link"
								checked={formFields.enableReadMore || false}
								onChange={(val) => handleUpdateField("enableReadMore", val)}
							/>
							{formFields.enableReadMore && (
								<Input
									label="Read more text"
									value={formFields.readMoreText || "Read more"}
									onChange={(val) => handleUpdateField("readMoreText", val)}
								/>
							)}
						</>
					)}
				</div>
			),
		},
		{
			id: "elements",
			label: "Info Elements & Images",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Toggle
						label="Show Source Name"
						checked={formFields.enableSources || false}
						onChange={(val) => handleUpdateField("enableSources", val)}
					/>
					{formFields.enableSources && (
						<>
							<Input
								label="Source prefix text"
								value={formFields.sourcePrefix || ""}
								onChange={(val) => handleUpdateField("sourcePrefix", val)}
								placeholder="E.g., Source: "
							/>
							<Toggle
								label="Link Source Name to feed site"
								checked={formFields.linkSource || false}
								onChange={(val) => handleUpdateField("linkSource", val)}
							/>
						</>
					)}
					<Toggle
						label="Show Published Date"
						checked={formFields.enableDates || false}
						onChange={(val) => handleUpdateField("enableDates", val)}
					/>
					{formFields.enableDates && (
						<>
							<Input
								label="Date prefix text"
								value={formFields.datePrefix || ""}
								onChange={(val) => handleUpdateField("datePrefix", val)}
								placeholder="E.g., Published on: "
							/>
							<Input
								label="Date format (PHP/Moment style)"
								value={formFields.dateFormat || "F j, Y"}
								onChange={(val) => handleUpdateField("dateFormat", val)}
							/>
							<Toggle
								label="Use relative date (E.g., 2 hours ago)"
								checked={formFields.useRelativeDate || false}
								onChange={(val) => handleUpdateField("useRelativeDate", val)}
							/>
						</>
					)}
					<Toggle
						label="Show Author Name"
						checked={formFields.enableAuthors || false}
						onChange={(val) => handleUpdateField("enableAuthors", val)}
					/>
					{formFields.enableAuthors && (
						<Input
							label="Author prefix text"
							value={formFields.authorPrefix || "By "}
							onChange={(val) => handleUpdateField("authorPrefix", val)}
						/>
					)}
					<hr style={{ border: "0", borderTop: "1px solid #eee", margin: "10px 0" }} />
					<Toggle
						label="Show Media Images"
						checked={formFields.enableImages || false}
						onChange={(val) => handleUpdateField("enableImages", val)}
					/>
					{formFields.enableImages && (
						<>
							<Toggle
								label="Link images to source URL"
								checked={formFields.linkImages || false}
								onChange={(val) => handleUpdateField("linkImages", val)}
							/>
							<div style={{ display: "flex", gap: "12px" }}>
								<div style={{ flex: 1 }}>
									<NumberInput
										label="Image Width (px)"
										value={formFields.imageWidth || 150}
										onChange={(val) => handleUpdateField("imageWidth", val)}
										min={30}
									/>
								</div>
								<div style={{ flex: 1 }}>
									<NumberInput
										label="Image Height (px)"
										value={formFields.imageHeight || 150}
										onChange={(val) => handleUpdateField("imageHeight", val)}
										min={30}
									/>
								</div>
							</div>
							<Toggle
								label="Fallback to source image if item lacks image"
								checked={formFields.fallbackToSourceImage || false}
								onChange={(val) => handleUpdateField("fallbackToSourceImage", val)}
							/>
						</>
					)}
				</div>
			),
		},
		{
			id: "advanced",
			label: "Advanced Settings",
			content: (
				<div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
					<Select
						label="Link Target"
						value={formFields.linkTarget || "_blank"}
						onChange={(val) => handleUpdateField("linkTarget", val)}
						options={[
							{ label: "Open in new window/tab (_blank)", value: "_blank" },
							{ label: "Open in same window (_self)", value: "_self" },
						]}
					/>
					<Toggle
						label="Add rel='nofollow' to links"
						checked={formFields.linksNoFollow || false}
						onChange={(val) => handleUpdateField("linksNoFollow", val)}
					/>
					<Toggle
						label="Enable Audio Player for podcasts"
						checked={formFields.enableAudioPlayer || false}
						onChange={(val) => handleUpdateField("enableAudioPlayer", val)}
					/>
					{formFields.enableAudioPlayer && (
						<Select
							label="Audio player position"
							value={formFields.audioPlayerPosition || "after"}
							onChange={(val) => handleUpdateField("audioPlayerPosition", val)}
							options={[
								{ label: "Before article details", value: "before" },
								{ label: "After article details", value: "after" },
							]}
						/>
					)}
					<Toggle
						label="Display as bullets"
						checked={formFields.enableBullets || false}
						onChange={(val) => handleUpdateField("enableBullets", val)}
					/>
					{formFields.enableBullets && (
						<Select
							label="Bullet Style"
							value={formFields.bulletStyle || "disc"}
							onChange={(val) => handleUpdateField("bulletStyle", val)}
							options={[
								{ label: "Disc", value: "disc" },
								{ label: "Circle", value: "circle" },
								{ label: "Square", value: "square" },
								{ label: "None", value: "none" },
							]}
						/>
					)}
					{formFields.layout === "grid" && (
						<div style={{ border: "1px solid #ddd", padding: "12px", borderRadius: "4px", background: "#fdfdfd" }}>
							<span style={{ fontSize: "14px", fontWeight: 600, display: "block", marginBottom: "10px" }}>
								Grid Specific Options
							</span>
							<NumberInput
								label="Max Grid Columns"
								value={formFields.gridMaxColumns || 3}
								onChange={(val) => handleUpdateField("gridMaxColumns", val)}
								min={1}
								max={6}
							/>
							<Toggle
								label="Use image as background for card"
								checked={formFields.gridUseImageAsBg || false}
								onChange={(val) => handleUpdateField("gridUseImageAsBg", val)}
							/>
							<Toggle
								label="Fit image size (contain/cover)"
								checked={formFields.gridFitImages || false}
								onChange={(val) => handleUpdateField("gridFitImages", val)}
							/>
						</div>
					)}
					<Input
						label="Custom CSS Classes"
						value={formFields.htmlClass || ""}
						onChange={(val) => handleUpdateField("htmlClass", val)}
						placeholder="E.g., custom-sidebar-feed mt-4"
					/>
				</div>
			),
		},
	];

	if (loading) return <Loading size="lg" />;

	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="Display Templates"
				description="Configure layouts, styling, pagination, and data scopes for displaying feed items in templates."
				actions={<Button variant="primary" onClick={handleOpenAdd}>Add Template</Button>}
			/>

			{error && <Alert variant="error" title="Error">{error}</Alert>}

			<Card>
				<Table
					columns={columns}
					data={displays as any}
					emptyMessage="No display configurations found. Click 'Add Template' to create one."
				/>
			</Card>

			{/* Add/Edit Modal */}
			<Modal
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={editingDisplay ? "Edit Display Template" : "Add Display Template"}
				size="lg"
			>
				<form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
					<Tabs tabs={formTabs} defaultTab="general" />
					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
						<Button variant="secondary" onClick={() => setIsModalOpen(false)}>
							Cancel
						</Button>
						<Button variant="primary" type="submit">
							Save Template
						</Button>
					</div>
				</form>
			</Modal>

			{/* Delete confirmation */}
			<ConfirmDialog
				open={isDeleteOpen}
				title="Delete Display Template?"
				description="This will permanently delete this display template. Themes using this display's key will fall back to default configurations."
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setIsDeleteOpen(false)}
			/>
		</div>
	);
};

import React, { useState, useEffect } from "react";
import {
	usePluginAPI,
	PageHeader,
	Button,
	Table,
	Badge,
	Modal,
	Input,
	TextArea,
	Select,
	Toggle,
	Card,
	Alert,
	Loading,
	ConfirmDialog,
} from "./ui";
import type { OutputProfile, FieldToken } from "../types";
import { FIELD_TOKENS } from "../types";

/** "field = token" per line ⇄ OutputProfile.fieldMap. */
function fieldMapToText(map: OutputProfile["fieldMap"]): string {
	if (!map) return "";
	return Object.entries(map)
		.map(([field, token]) => `${field} = ${token}`)
		.join("\n");
}

function parseFieldMap(text: string): { map: Record<string, FieldToken>; error: string | null } {
	const map: Record<string, FieldToken> = {};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) return { map, error: `Line "${line}" is not "field = token".` };
		const field = line.slice(0, eq).trim();
		const token = line.slice(eq + 1).trim();
		if (!field) return { map, error: `Missing field name in "${line}".` };
		if (!FIELD_TOKENS.includes(token as FieldToken)) {
			return { map, error: `Unknown token "${token}". Use one of: ${FIELD_TOKENS.join(", ")}.` };
		}
		map[field] = token as FieldToken;
	}
	return { map, error: null };
}

export const ProfilesPage: React.FC = () => {
	const api = usePluginAPI();
	const [profiles, setProfiles] = useState<Array<{ id: string } & OutputProfile>>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editing, setEditing] = useState<({ id: string } & OutputProfile) | null>(null);
	const [form, setForm] = useState<Partial<OutputProfile> & { defaultCategoriesText?: string; fieldMapText?: string }>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const fetchData = async () => {
		try {
			setLoading(true);
			const data = await api.get<{ items: Array<{ id: string } & OutputProfile> }>("output-profiles");
			setProfiles(data.items);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load output profiles");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const openAdd = () => {
		setEditing(null);
		setForm({
			name: "",
			mode: "publish",
			collection: "posts",
			status: "draft",
			requireApproval: true,
			slugPattern: "{itemSlug}",
			bodySource: "rewrite",
			excerptSource: "summary",
			footerTemplate: "",
			defaultCategories: [],
			defaultCategoriesText: "",
			mapFeedCategories: true,
			fieldMapText: "content = body\nexcerpt = excerpt",
		});
		setFormError(null);
		setIsModalOpen(true);
	};

	const openEdit = (p: { id: string } & OutputProfile) => {
		setEditing(p);
		setForm({
			...p,
			defaultCategoriesText: p.defaultCategories ? p.defaultCategories.join(", ") : "",
			fieldMapText: fieldMapToText(p.fieldMap),
		});
		setFormError(null);
		setIsModalOpen(true);
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormError(null);
		if (!form.name?.trim()) {
			setFormError("Name is required.");
			return;
		}
		if (form.mode === "publish" && !form.collection?.trim()) {
			setFormError("A target collection is required when publishing.");
			return;
		}

		const { map: fieldMap, error: fieldMapError } = parseFieldMap(form.fieldMapText || "");
		if (fieldMapError) {
			setFormError(fieldMapError);
			return;
		}

		const categoriesArray = form.defaultCategoriesText
			? form.defaultCategoriesText.split(",").map((c) => c.trim()).filter(Boolean)
			: form.defaultCategories || [];

		const payload: Partial<OutputProfile> = {
			...form,
			defaultCategories: categoriesArray,
			fieldMap,
		};
		delete (payload as any).defaultCategoriesText;
		delete (payload as any).fieldMapText;

		try {
			if (editing) {
				await api.post("output-profiles/update", { id: editing.id, ...payload });
			} else {
				await api.post("output-profiles/create", payload);
			}
			setIsModalOpen(false);
			fetchData();
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Failed to save output profile");
		}
	};

	const handleDelete = async () => {
		if (!deleteId) return;
		try {
			await api.post("output-profiles/delete", { id: deleteId });
			setDeleteId(null);
			fetchData();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete output profile");
		}
	};

	const columns = [
		{ key: "name", label: "Name", render: (v: any) => <span style={{ fontWeight: 600 }}>{v}</span> },
		{ key: "mode", label: "Mode", render: (v: any) => <Badge variant={v === "publish" ? "success" : "default"}>{v}</Badge> },
		{ key: "collection", label: "Collection", render: (v: any, row: any) => (row.mode === "publish" ? v : "—") },
		{ key: "status", label: "Status" },
		{
			key: "actions",
			label: "Actions",
			width: "160px",
			render: (_: any, row: any) => (
				<div style={{ display: "flex", gap: "6px" }}>
					<Button variant="secondary" size="sm" onClick={() => openEdit(row)}>Edit</Button>
					<Button variant="danger" size="sm" onClick={() => setDeleteId(row.id)}>Delete</Button>
				</div>
			),
		},
	];

	if (loading) return <Loading />;

	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="Output Profiles"
				description="Configure CMS publishing targets, body text sources, slug patterns, and category mapping rules for imported feeds."
			/>
			<div style={{ display: "flex", justifyContent: "flex-end" }}>
				<Button variant="primary" onClick={openAdd}>Add Output Profile</Button>
			</div>
			{error && <Alert variant="error" title="Error">{error}</Alert>}
			<Card>
				<Table columns={columns} data={profiles as any} emptyMessage="No output profiles yet." />
			</Card>

			<Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? "Edit Output Profile" : "Add Output Profile"} size="md">
				<form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<Input label="Name" value={form.name || ""} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
					<Select
						label="Mode"
						value={form.mode || "publish"}
						onChange={(v) => setForm((p) => ({ ...p, mode: v as OutputProfile["mode"] }))}
						options={[
							{ label: "Publish to a collection", value: "publish" },
							{ label: "Internal (keep private)", value: "internal" },
						]}
					/>
					{form.mode === "publish" && (
						<>
							<Input label="Collection" value={form.collection || ""} onChange={(v) => setForm((p) => ({ ...p, collection: v }))} placeholder="posts" />
							<Select
								label="Status"
								value={form.status || "draft"}
								onChange={(v) => setForm((p) => ({ ...p, status: v as OutputProfile["status"] }))}
								options={[
									{ label: "Draft (review in CMS)", value: "draft" },
									{ label: "Published (live)", value: "published" },
								]}
							/>
							<Toggle
								label="Require approval before creating the entry"
								checked={form.requireApproval ?? true}
								onChange={(v) => setForm((p) => ({ ...p, requireApproval: v }))}
								description="When on, items stay pending until approved on the Items page."
							/>
							<Input
								label="Slug pattern"
								value={form.slugPattern || "{itemSlug}"}
								onChange={(v) => setForm((p) => ({ ...p, slugPattern: v }))}
								description="Tokens: {itemSlug}, {sourceSlug}. Site routes are flat — avoid nested slashes."
							/>
							<Select
								label="Body source"
								value={form.bodySource || "rewrite"}
								onChange={(v) => setForm((p) => ({ ...p, bodySource: v as OutputProfile["bodySource"] }))}
								options={[
									{ label: "Rewritten (falls back to original)", value: "rewrite" },
									{ label: "Original content", value: "original" },
									{ label: "Summary (digest)", value: "summary" },
								]}
							/>
							<Select
								label="Excerpt source"
								value={form.excerptSource || "summary"}
								onChange={(v) => setForm((p) => ({ ...p, excerptSource: v as OutputProfile["excerptSource"] }))}
								options={[
									{ label: "Summary", value: "summary" },
									{ label: "Original excerpt", value: "original" },
									{ label: "None", value: "none" },
								]}
							/>
							<TextArea
								label="Field map (one “field = token” per line)"
								value={form.fieldMapText || ""}
								onChange={(v) => setForm((p) => ({ ...p, fieldMapText: v }))}
								rows={5}
								placeholder={"content = body\nexcerpt = excerpt"}
								description={`Every field named here is written as a column on the target collection, so each must exist on it. Tokens: ${FIELD_TOKENS.join(", ")}. Leave empty for "content = body, excerpt = excerpt". title, slug, status, publishedAt and seo are always written.`}
							/>
							<Alert variant="warning" title="Categories are not assigned yet">
								EmDash gives plugins read-only taxonomy access, so the two settings below are
								stored but never applied — published entries get no terms. Assign them in the
								CMS for now.
							</Alert>
							<Input
								label="Default Categories (comma-separated IDs or slugs)"
								value={form.defaultCategoriesText || ""}
								onChange={(v) => setForm((p) => ({ ...p, defaultCategoriesText: v }))}
								placeholder="news, tech"
								description="Default categories to assign to published entries."
							/>
							<Toggle
								label="Dynamically map RSS feed categories"
								checked={form.mapFeedCategories ?? true}
								onChange={(v) => setForm((p) => ({ ...p, mapFeedCategories: v }))}
								description="Map feed category tags and source slug to target collection taxonomy terms."
							/>
							<TextArea
								label="Footer template (HTML, optional)"
								value={form.footerTemplate || ""}
								onChange={(v) => setForm((p) => ({ ...p, footerTemplate: v }))}
								rows={3}
								placeholder={'<hr><p>Originally published at <a href="{originalUrl}">{sourceName}</a>.</p>'}
							/>
						</>
					)}
					{formError && <Alert variant="error" title="Could not save">{formError}</Alert>}
					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
						<Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
						<Button variant="primary" type="submit">Save Profile</Button>
					</div>
				</form>
			</Modal>

			<ConfirmDialog
				open={!!deleteId}
				title="Delete output profile?"
				description="Feeds using this profile will stop publishing until reassigned."
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeleteId(null)}
			/>
		</div>
	);
};

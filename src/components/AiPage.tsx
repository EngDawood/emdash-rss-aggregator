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
	NumberInput,
	Card,
	Tabs,
	Alert,
	Loading,
	ConfirmDialog,
} from "./ui";
import type { Model, Agent, OutputProfile } from "../types";

const KIND_OPTIONS = [
	{ label: "Summary", value: "summary" },
	{ label: "Rewrite", value: "rewrite" },
	{ label: "Translate", value: "translate" },
	{ label: "Custom", value: "custom" },
];

// ── Models Tab ─────────────────────────────────────────────────────────────

const ModelsTab: React.FC = () => {
	const api = usePluginAPI();
	const [models, setModels] = useState<Array<{ id: string } & Model>>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editing, setEditing] = useState<({ id: string } & Model) | null>(null);
	const [form, setForm] = useState<Partial<Model> & { apiKey?: string; gatewayToken?: string; headersText?: string }>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{ ok: boolean; status?: number; error?: string } | null>(null);
	const [saving, setSaving] = useState(false);

	const isGateway = (form.mode || "direct") === "gateway";

	const [deleteId, setDeleteId] = useState<string | null>(null);

	const fetchData = async () => {
		try {
			setLoading(true);
			const data = await api.get<{ items: Array<{ id: string } & Model> }>("models");
			setModels(data.items);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load models");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const openAdd = () => {
		setEditing(null);
		setForm({ name: "", mode: "direct", endpoint: "https://api.openai.com/v1/chat/completions", modelId: "", provider: "", apiKey: "", gatewayToken: "", headersText: "" });
		setFormError(null);
		setTestResult(null);
		setIsModalOpen(true);
	};

	const openEdit = (m: { id: string } & Model) => {
		setEditing(m);
		setForm({ ...m, mode: m.mode || "direct", apiKey: "", gatewayToken: "", headersText: m.headers ? JSON.stringify(m.headers, null, 2) : "" });
		setFormError(null);
		setTestResult(null);
		setIsModalOpen(true);
	};

	/** Update a connection-relevant field and invalidate any stale test result. */
	const setConnField = (patch: Partial<typeof form>) => {
		setForm((p) => ({ ...p, ...patch }));
		setTestResult(null);
	};

	const parseHeaders = (): Record<string, string> | undefined | null => {
		if (!form.headersText?.trim()) return undefined;
		try {
			return JSON.parse(form.headersText) as Record<string, string>;
		} catch {
			return null; // signals parse error
		}
	};

	/** Mode-aware required-field check. Returns an error message, or null when valid. */
	const validate = (): string | null => {
		if (!form.name?.trim()) return "Name is required.";
		if (!form.endpoint?.trim()) return "Endpoint is required.";
		if (!form.modelId?.trim()) return "Model ID is required.";
		if (isGateway) {
			if (!form.provider?.trim()) return "Provider slug is required for AI Gateway mode.";
		} else if (!editing && !form.apiKey?.trim()) {
			return "An API key is required to create a model.";
		}
		return null;
	};

	/** Runs exactly one connection test and records its result. Returns the result, or null on a local error. */
	const runTest = async (): Promise<{ ok: boolean; status?: number; error?: string } | null> => {
		const headers = parseHeaders();
		if (headers === null) {
			setFormError("Headers must be valid JSON.");
			return null;
		}
		try {
			const res = await api.post<{ ok: boolean; status?: number; error?: string }>("models/test", {
				id: editing?.id,
				mode: form.mode || "direct",
				endpoint: form.endpoint,
				modelId: form.modelId,
				provider: form.provider,
				apiKey: form.apiKey?.trim() || undefined,
				gatewayToken: form.gatewayToken?.trim() || undefined,
				headers,
			});
			setTestResult(res);
			return res;
		} catch (err) {
			const res = { ok: false, error: err instanceof Error ? err.message : "Test failed" };
			setTestResult(res);
			return res;
		}
	};

	const handleTest = async () => {
		setFormError(null);
		await runTest();
	};

	/** Persists the model with the given verification status. */
	const persist = async (testStatus: "ok" | "failed" | "untested") => {
		const headers = parseHeaders();
		if (headers === null) {
			setFormError("Headers must be valid JSON.");
			return;
		}
		const payload: Record<string, unknown> = {
			name: form.name,
			mode: form.mode || "direct",
			endpoint: form.endpoint,
			modelId: form.modelId,
			provider: form.provider,
			headers,
			testStatus,
		};
		if (form.apiKey?.trim()) payload.apiKey = form.apiKey.trim();
		if (form.gatewayToken?.trim()) payload.gatewayToken = form.gatewayToken.trim();
		try {
			setSaving(true);
			if (editing) {
				await api.post("models/update", { id: editing.id, ...payload });
			} else {
				await api.post("models/create", payload);
			}
			setIsModalOpen(false);
			fetchData();
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Failed to save model");
		} finally {
			setSaving(false);
		}
	};

	// "Test & Save": test once (reusing a fresh result), save on success, otherwise offer save-for-later.
	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormError(null);
		const v = validate();
		if (v) {
			setFormError(v);
			return;
		}
		const result = testResult ?? (await runTest());
		if (!result) return; // local error (e.g. invalid headers) already surfaced
		if (result.ok) {
			await persist("ok");
		}
		// On failure, leave the failed alert + "Save for later" button visible — no auto-save.
	};

	const handleDelete = async () => {
		if (!deleteId) return;
		try {
			await api.post("models/delete", { id: deleteId });
			setDeleteId(null);
			fetchData();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete model");
		}
	};

	const columns = [
		{ key: "name", label: "Name", render: (v: any) => <span style={{ fontWeight: 600 }}>{v}</span> },
		{ key: "provider", label: "Provider", render: (v: any) => v || "—" },
		{ key: "modelId", label: "Model" },
		{
			key: "verifiedAt",
			label: "Status",
			render: (v: any, row: any) =>
				v ? (
					<Badge variant="success">Verified</Badge>
				) : row.lastTestStatus === "failed" ? (
					<Badge variant="warning">Unverified</Badge>
				) : (
					<Badge variant="default">Untested</Badge>
				),
		},
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
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div style={{ display: "flex", justifyContent: "flex-end" }}>
				<Button variant="primary" onClick={openAdd}>Add Model</Button>
			</div>
			{error && <Alert variant="error" title="Error">{error}</Alert>}
			<Card>
				<Table columns={columns} data={models as any} emptyMessage="No models yet. Add one — test the connection, then save (or save for later if the test fails)." />
			</Card>

			<Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? "Edit Model" : "Add Model"} size="md">
				<form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<Input label="Name" value={form.name || ""} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="e.g. OpenAI GPT-4o mini" />
					<Select
						label="Connection type"
						value={form.mode || "direct"}
						onChange={(v) => setConnField({ mode: v as Model["mode"] })}
						options={[
							{ label: "Direct (OpenAI-compatible URL)", value: "direct" },
							{ label: "Cloudflare AI Gateway", value: "gateway" },
						]}
					/>
					<Input label="Endpoint" value={form.endpoint || ""} onChange={(v) => setConnField({ endpoint: v })} placeholder="https://…/chat/completions" description={isGateway ? "Your AI Gateway compat URL: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/chat/completions" : "Full OpenAI-compatible chat-completions URL."} />
					<Input label="Model ID" value={form.modelId || ""} onChange={(v) => setConnField({ modelId: v })} placeholder={isGateway ? "moonshotai/kimi-k2.6" : "gpt-4o-mini"} description={isGateway ? "Bare model name — the provider slug below is prepended automatically as provider/model." : undefined} />
					<Input
						label={isGateway ? "Provider slug" : "Provider (label)"}
						value={form.provider || ""}
						onChange={(v) => setConnField({ provider: v })}
						placeholder={isGateway ? "groq · custom-nividia-nvm" : "OpenAI"}
						description={isGateway ? "Routing prefix AI Gateway recognizes: a native slug (groq, openai, anthropic, google-ai-studio…) or your custom provider as custom-{slug}." : "Display label only — not sent."}
					/>
					<TextArea label="Extra headers (JSON, optional)" value={form.headersText || ""} onChange={(v) => setConnField({ headersText: v })} rows={3} placeholder={'{ "x-custom-header": "value" }'} />
					<Input
						label={editing ? "Replace API key (leave blank to keep)" : isGateway ? "Provider API key (optional)" : "API key"}
						type="password"
						value={form.apiKey || ""}
						onChange={(v) => setConnField({ apiKey: v })}
						description={editing && form.hasKey ? "A key is configured." : isGateway ? "Leave blank if the provider key is stored on the gateway (BYOK)." : undefined}
					/>
					{isGateway && (
						<Input
							label={editing ? "Replace gateway token (leave blank to keep)" : "Gateway token (optional)"}
							type="password"
							value={form.gatewayToken || ""}
							onChange={(v) => setConnField({ gatewayToken: v })}
							description={editing && form.hasGatewayToken ? "A gateway token is configured." : "cf-aig-authorization — only for an authenticated gateway. Leave blank for your own gateway."}
						/>
					)}
					<div>
						<Button variant="secondary" size="sm" onClick={handleTest}>Test connection</Button>
					</div>
					{testResult && (
						<Alert variant={testResult.ok ? "success" : "error"} title={testResult.ok ? "Connection OK" : "Test failed"}>
							{testResult.ok ? "The model responded successfully." : (testResult.error || "Unknown error")}
						</Alert>
					)}
					{testResult && !testResult.ok && (
						<div>
							<Button variant="secondary" size="sm" onClick={() => persist("failed")} loading={saving}>Save for later anyway</Button>
						</div>
					)}
					{formError && <Alert variant="error" title="Could not save">{formError}</Alert>}
					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
						<Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
						<Button variant="primary" type="submit" loading={saving}>{editing ? "Save" : "Test & Save"}</Button>
					</div>
				</form>
			</Modal>

			<ConfirmDialog
				open={!!deleteId}
				title="Delete model?"
				description="This removes the model and its stored API key. Feeds using it will stop running AI until reassigned."
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeleteId(null)}
			/>
		</div>
	);
};

// ── Agents Tab ─────────────────────────────────────────────────────────────

const AgentsTab: React.FC = () => {
	const api = usePluginAPI();
	const [agents, setAgents] = useState<Array<{ id: string } & Agent>>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editing, setEditing] = useState<({ id: string } & Agent) | null>(null);
	const [form, setForm] = useState<Partial<Agent>>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const fetchData = async () => {
		try {
			setLoading(true);
			const data = await api.get<{ items: Array<{ id: string } & Agent> }>("agents");
			setAgents(data.items);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load agents");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, []);

	const openAdd = () => {
		setEditing(null);
		setForm({ name: "", kind: "summary", instructions: "", temperature: 0.4, locales: "" });
		setFormError(null);
		setIsModalOpen(true);
	};

	const openEdit = (a: { id: string } & Agent) => {
		setEditing(a);
		setForm({ ...a });
		setFormError(null);
		setIsModalOpen(true);
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormError(null);
		if (!form.name?.trim() || !form.instructions?.trim()) {
			setFormError("Name and instructions are required.");
			return;
		}
		const payload = {
			name: form.name,
			kind: form.kind,
			instructions: form.instructions,
			temperature: form.temperature,
			locales: form.kind === "translate" ? form.locales : undefined,
		};
		try {
			if (editing) {
				await api.post("agents/update", { id: editing.id, ...payload });
			} else {
				await api.post("agents/create", payload);
			}
			setIsModalOpen(false);
			fetchData();
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Failed to save agent");
		}
	};

	const handleDelete = async () => {
		if (!deleteId) return;
		try {
			await api.post("agents/delete", { id: deleteId });
			setDeleteId(null);
			fetchData();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Failed to delete agent");
		}
	};

	const columns = [
		{ key: "name", label: "Name", render: (v: any) => <span style={{ fontWeight: 600 }}>{v}</span> },
		{ key: "kind", label: "Kind", render: (v: any) => <Badge variant="info">{v}</Badge> },
		{ key: "locales", label: "Locales", render: (v: any, row: any) => (row.kind === "translate" ? v || "—" : "—") },
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
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div style={{ display: "flex", justifyContent: "flex-end" }}>
				<Button variant="primary" onClick={openAdd}>Add Agent</Button>
			</div>
			{error && <Alert variant="error" title="Error">{error}</Alert>}
			<Card>
				<Table columns={columns} data={agents as any} emptyMessage="No agents yet." />
			</Card>

			<Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? "Edit Agent" : "Add Agent"} size="md">
				<form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<Input label="Name" value={form.name || ""} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
					<Select label="Kind" value={form.kind || "summary"} onChange={(v) => setForm((p) => ({ ...p, kind: v as Agent["kind"] }))} options={KIND_OPTIONS} />
					<TextArea label="Instructions (system prompt)" value={form.instructions || ""} onChange={(v) => setForm((p) => ({ ...p, instructions: v }))} rows={8} />
					<NumberInput label="Temperature" value={form.temperature ?? 0.4} onChange={(v) => setForm((p) => ({ ...p, temperature: v }))} min={0} max={2} />
					{form.kind === "translate" && (
						<Input label="Locales" value={form.locales || ""} onChange={(v) => setForm((p) => ({ ...p, locales: v }))} placeholder="ar,fr,es" description="Comma-separated BCP-47 locales. Empty = no-op." />
					)}
					{formError && <Alert variant="error" title="Could not save">{formError}</Alert>}
					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
						<Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
						<Button variant="primary" type="submit">Save Agent</Button>
					</div>
				</form>
			</Modal>

			<ConfirmDialog
				open={!!deleteId}
				title="Delete agent?"
				description="This removes the agent. Feeds referencing it will skip it."
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeleteId(null)}
			/>
		</div>
	);
};

// ── Page ─────────────────────────────────────────────────────────────────────

export const AiPage: React.FC = () => {
	return (
		<div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
			<PageHeader
				title="AI Pipeline"
				description="Saved models and agents for automated AI content rewriting and summarization."
			/>
			<Tabs
				tabs={[
					{ id: "models", label: "Models", content: <ModelsTab /> },
					{ id: "agents", label: "Agents", content: <AgentsTab /> },
				]}
				defaultTab="models"
			/>
		</div>
	);
};

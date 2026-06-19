/**
 * Ambient type declarations for `@emdash-cms/blocks` peer dependency.
 */

declare module "@emdash-cms/blocks" {
	export const blocks: {
		header(text: string): unknown;
		section(config: { text: string; accessory?: unknown }): unknown;
		divider(): unknown;
		fields(config: { fields: Array<{ label: string; value: string }> }): unknown;
		stats(config: { stats: Array<{ label: string; value: string; trend?: string; trend_direction?: string }> }): unknown;
		table(config: { columns: unknown[]; rows: unknown[]; blockId?: string }): unknown;
		actions(config: { elements: unknown[] }): unknown;
		form(config: { blockId: string; fields: unknown[]; submit: { label: string; actionId: string } }): unknown;
		timeseriesChart(config: { series: unknown[]; xAxisName?: string; yAxisName?: string; gradient?: boolean; height?: number }): unknown;
		customChart(config: { options: unknown; height?: number }): unknown;
		banner(config: { title?: string; description?: string; variant?: string }): unknown;
		meter(config: { label: string; value: number; max?: number; custom_value?: string }): unknown;
		code(config: { code: string; language?: string }): unknown;
		columns(config: { columns: Array<{ blocks: unknown[] }> }): unknown;
	};

	export const elements: {
		button(text: string, actionId: string, config?: { style?: string; confirm?: unknown }): unknown;
		textInput(actionId: string, label: string, config?: { initialValue?: string; placeholder?: string; multiline?: boolean }): unknown;
		numberInput(actionId: string, label: string, config?: { initialValue?: number; min?: number; max?: number }): unknown;
		select(actionId: string, label: string, options: Array<{ label: string; value: string }>, config?: { initialValue?: string }): unknown;
		toggle(actionId: string, label: string, config?: { initialValue?: boolean }): unknown;
		secretInput(actionId: string, label: string, config?: { placeholder?: string }): unknown;
		checkbox(actionId: string, label: string, options: Array<{ label: string; value: string }>): unknown;
		radio(actionId: string, label: string, options: Array<{ label: string; value: string }>): unknown;
		dateInput(actionId: string, label: string, config?: { initialValue?: string }): unknown;
		combobox(actionId: string, label: string, options: Array<{ label: string; value: string }>): unknown;
	};
}

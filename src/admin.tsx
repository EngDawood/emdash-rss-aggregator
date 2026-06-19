/**
 * Admin entry point for the RSS Aggregator plugin.
 *
 * Exports page components (keyed by route) and dashboard widgets
 * consumed by the EmDash admin shell.
 */

import { SourcesPage } from './components/SourcesPage';
import { ItemsPage } from './components/ItemsPage';
import { DisplaysPage } from './components/DisplaysPage';
import { LogsPage } from './components/LogsPage';
import { SettingsPage } from './components/SettingsPage';
import { StatsWidget } from './components/StatsWidget';

export const pages = {
	'/sources': SourcesPage,
	'/items': ItemsPage,
	'/displays': DisplaysPage,
	'/logs': LogsPage,
	'/settings': SettingsPage,
};

export const widgets = {
	'rss-stats': StatsWidget,
};

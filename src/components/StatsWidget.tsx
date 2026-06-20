/**
 * StatsWidget — compact dashboard card for the RSS Aggregator plugin.
 *
 * Displays: Total Sources, Total Items, Active Sources, Last Import time.
 */

import React, { useEffect, useState } from 'react';
import { usePluginAPI, StatGroup, Stat, Loading, Alert } from './ui';
import type { PluginStats } from '../types';
import { formatRelativeTime } from './shared';

export const StatsWidget: React.FC = () => {
	const api = usePluginAPI();
	const [stats, setStats] = useState<PluginStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const fetchStats = async () => {
			try {
				setLoading(true);
				const data = await api.get<PluginStats>('stats');
				if (!cancelled) {
					setStats(data);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Failed to load stats');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		fetchStats();
		return () => { cancelled = true; };
	}, [api]);

	if (loading) return <Loading size="sm" />;

	if (error) {
		return (
			<Alert variant="error" title="Error">
				{error}
			</Alert>
		);
	}

	if (!stats) return null;

	return (
		<StatGroup>
			<Stat label="Total Sources" value={stats.totalSources} />
			<Stat label="Active Sources" value={stats.activeSources} />
			<Stat label="Total Items" value={stats.totalItems} />
			<Stat
				label="Last Import"
				value={stats.lastImportAt ? formatRelativeTime(stats.lastImportAt) : 'Never'}
			/>
		</StatGroup>
	);
};

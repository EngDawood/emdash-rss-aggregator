export const storageConfig = {
	sources: {
		indexes: ["status", "tag", "createdAt", ["status", "nextFetchAt"]],
	},
	feedItems: {
		indexes: [
			"sourceId",
			"guid",
			"publishedAt",
			["sourceId", "publishedAt"],
			["sourceId", "guid"],
		],
	},
	displays: { indexes: ["name"] },
	models: { indexes: ["createdAt"] },
	agents: { indexes: ["kind", "createdAt"] },
	outputProfiles: { indexes: ["createdAt"] },
	rejectList: { indexes: ["guid", "sourceId", "createdAt"] },
	importLogs: {
		indexes: ["sourceId", "status", "createdAt", ["sourceId", "createdAt"]],
	},
	folders: { indexes: ["slug", "name"] },
};

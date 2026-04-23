import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@mariozechner/pi-coding-agent";
import { Container, Text, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";

// --- API Types ---

interface BucketInfo {
	remainingAmount?: string;
	remainingFraction?: number;
	resetTime?: string;
	tokenType?: string;
	modelId?: string;
}

interface QuotaStats {
	remaining: number;
	limit: number;
	resetTime?: string;
	tokenType?: string;
}

interface LoadCodeAssistResponse {
	currentTier?: {
		id?: string;
		name?: string;
		description?: string;
		availableCredits?: Array<{
			creditType: string;
			creditAmount: string;
		}>;
	};
	releaseChannel?: {
		type?: string;
		name?: string;
	};
	paidTier?: {
		id?: string;
		name?: string;
		description?: string;
	};
	manageSubscriptionUri?: string;
}

// --- Logic ---

function processQuotaBuckets(buckets: BucketInfo[]): Map<string, QuotaStats> {
	const modelQuotas = new Map<string, QuotaStats>();
	for (const bucket of buckets) {
		if (!bucket.modelId || bucket.remainingFraction === undefined) continue;
		let remaining: number;
		let limit: number;
		if (bucket.remainingAmount) {
			remaining = Number.parseInt(bucket.remainingAmount, 10);
			limit = bucket.remainingFraction > 0 ? Math.round(remaining / bucket.remainingFraction) : 0;
		} else {
			limit = 100;
			remaining = Math.round(bucket.remainingFraction * limit);
		}
		if (!Number.isNaN(remaining) && Number.isFinite(limit)) {
			modelQuotas.set(bucket.modelId, {
				remaining,
				limit,
				resetTime: bucket.resetTime,
				tokenType: bucket.tokenType,
			});
		}
	}
	return modelQuotas;
}

async function retrieveQuota(token: string, projectId: string): Promise<{ buckets?: BucketInfo[] }> {
	const response = await fetch(`${DEFAULT_ENDPOINT}/v1internal:retrieveUserQuota`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"User-Agent": "pi-coding-agent",
		},
		body: JSON.stringify({ project: projectId }),
	});
	if (!response.ok) throw new Error(`Quota fetch failed: ${response.status}`);
	return (await response.json()) as { buckets?: BucketInfo[] };
}

async function loadTierInfo(token: string, projectId: string): Promise<LoadCodeAssistResponse> {
	const response = await fetch(`${DEFAULT_ENDPOINT}/v1internal:loadCodeAssist`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"User-Agent": "pi-coding-agent",
		},
		body: JSON.stringify({ cloudaicompanionProject: projectId, metadata: { ideType: "GEMINI_CLI" } }),
	});
	if (!response.ok) throw new Error(`Tier fetch failed: ${response.status}`);
	return (await response.json()) as LoadCodeAssistResponse;
}

async function sendQuotaMessage(ctx: ExtensionContext, pi: ExtensionAPI) {
	const model = ctx.model;
	if (!model || (model.provider !== "google-gemini-cli" && model.provider !== "google-antigravity")) {
		return;
	}

	try {
		const apiKey = await ctx.modelRegistry.getApiKeyForProvider(model.provider);
		if (!apiKey) return;
		const { token, projectId } = JSON.parse(apiKey);

		const [tierRes, quotaRes] = await Promise.all([
			loadTierInfo(token, projectId).catch(() => ({})),
			retrieveQuota(token, projectId).catch(() => ({})),
		]);

		const statsMap = "buckets" in quotaRes && quotaRes.buckets ? processQuotaBuckets(quotaRes.buckets) : new Map();

		if (statsMap.size > 0 || "currentTier" in tierRes) {
			pi.sendMessage({
				customType: "gemini-quota",
				content: "Gemini API Quota and Tier Information",
				display: true,
				details: {
					tierInfo: tierRes,
					stats: Array.from(statsMap.entries()),
				},
			});
		}
	} catch (_error) {
		// Fail silently
	}
}

// --- Extension Entry ---

export default async function geminiQuotaExtension(pi: ExtensionAPI) {
	// 1. Register a custom message renderer to handle the visual output natively
	pi.registerMessageRenderer("gemini-quota", (message, _opts, theme) => {
		const details = message.details as {
			tierInfo?: LoadCodeAssistResponse;
			stats?: Array<[string, QuotaStats]>;
		};

		const container = new Container();

		if (details.tierInfo?.currentTier) {
			const tier = details.tierInfo.currentTier;
			container.addChild(new Text(theme.bold(`User Tier: ${tier.name || "Unknown"}`), 0, 0));
			if (tier.description) {
				container.addChild(new Text(theme.fg("dim", `  ${tier.description}`), 0, 0));
			}
			if (tier.availableCredits && tier.availableCredits.length > 0) {
				for (const credit of tier.availableCredits) {
					container.addChild(new Text(`  - ${credit.creditType}: ${credit.creditAmount}`, 0, 0));
				}
			}
			if (details.tierInfo.releaseChannel) {
				container.addChild(
					new Text(
						theme.bold(`Release Channel: `) +
							`${details.tierInfo.releaseChannel.name} (${details.tierInfo.releaseChannel.type})`,
						0,
						0,
					),
				);
			}
			if (details.tierInfo.paidTier) {
				container.addChild(new Text(theme.bold(`Paid Tier: `) + details.tierInfo.paidTier.name, 0, 0));
				if (details.tierInfo.paidTier.description) {
					container.addChild(new Text(theme.fg("dim", `  ${details.tierInfo.paidTier.description}`), 0, 0));
				}
			}
			if (details.tierInfo.manageSubscriptionUri) {
				container.addChild(
					new Text(`${theme.bold(`Manage Subscription: `)}${details.tierInfo.manageSubscriptionUri}`, 0, 0),
				);
			}
			container.addChild(new Text("", 0, 0)); // Padding
		}

		if (details.stats && details.stats.length > 0) {
			container.addChild(new Text(theme.bold("Gemini API Quota (Remaining):"), 0, 0));
			let maxLabelWidth = 0;
			for (const [modelId] of details.stats) maxLabelWidth = Math.max(maxLabelWidth, visibleWidth(modelId));

			for (const [modelId, s] of details.stats) {
				const padding = " ".repeat(maxLabelWidth - visibleWidth(modelId));
				const label = `  ${modelId}:${padding} `;
				const progressBarWidth = 30;
				const fraction = Math.min(1, s.limit > 0 ? s.remaining / s.limit : 0);
				const filledWidth = Math.round(fraction * progressBarWidth);
				const emptyWidth = progressBarWidth - filledWidth;

				let colorType: "success" | "warning" | "error" = "success";
				if (fraction < 0.2) colorType = "error";
				else if (fraction < 0.5) colorType = "warning";

				const bar = theme.fg(colorType, "█".repeat(filledWidth)) + theme.fg("dim", "░".repeat(emptyWidth));
				const percentage = Math.round(fraction * 100)
					.toString()
					.padStart(3, " ");

				const reset = s.resetTime ? ` (Resets: ${new Date(s.resetTime).toLocaleString()})` : "";
				const type = s.tokenType ? ` [${s.tokenType}]` : "";

				const line = `${label}${bar}  ${percentage}% (${s.remaining}/${s.limit})${type}${reset}`;

				container.addChild(new Text(line, 0, 0));
			}
		}

		return container;
	});

	// 2. Register /quota command to trigger a refresh message
	pi.registerCommand("quota", {
		description: "Display current Gemini API quota",
		handler: async (_args, ctx) => {
			await sendQuotaMessage(ctx, pi);
		},
	});

	// 3. Show once on startup
	pi.on("session_start", (_: SessionStartEvent, ctx: ExtensionContext) => {
		// Call immediately - sendMessage will queue it correctly after session init
		sendQuotaMessage(ctx, pi).catch(() => {});
	});
}

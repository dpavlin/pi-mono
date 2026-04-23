#!/usr/bin/env -S npx tsx

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";

async function main() {
	const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
	if (!fs.existsSync(authPath)) {
		console.error(chalk.red(`Error: Auth file not found at ${authPath}`));
		process.exit(1);
	}

	const auth = JSON.parse(fs.readFileSync(authPath, "utf-8"));
	const credentials = auth["google-gemini-cli"];
	if (!credentials?.access || !credentials?.projectId) {
		console.error(chalk.red("Error: google-gemini-cli credentials not found."));
		process.exit(1);
	}

	console.log(chalk.cyan("Fetching Gemini User Info and Quota..."));
	const { access: token, projectId } = credentials;

	try {
		const [tierRes, quotaRes] = await Promise.all([
			fetch(`${DEFAULT_ENDPOINT}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ cloudaicompanionProject: projectId, metadata: { ideType: "GEMINI_CLI" } }),
			}).then(r => r.json()),
			fetch(`${DEFAULT_ENDPOINT}/v1internal:retrieveUserQuota`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ project: projectId }),
			}).then(r => r.json())
		]);

		if (tierRes.currentTier) {
			console.log("");
			console.log(chalk.bold(" User Tier:"), tierRes.currentTier.name);
			if (tierRes.currentTier.description) console.log(" ", chalk.gray(tierRes.currentTier.description));
			if (tierRes.releaseChannel) console.log(chalk.bold(" Release Channel:"), `${tierRes.releaseChannel.name} (${tierRes.releaseChannel.type})`);
			if (tierRes.paidTier) {
				console.log(chalk.bold(" Paid Tier:"), tierRes.paidTier.name);
				console.log(" ", chalk.gray(tierRes.paidTier.description));
			}
			if (tierRes.manageSubscriptionUri) console.log(chalk.bold(" Manage Subscription:"), tierRes.manageSubscriptionUri);
		}

		if (quotaRes.buckets) {
			console.log("");
			console.log(chalk.bold(" Gemini API Quota (Remaining):"));
			
			// Simple alignment logic for script
			let maxLen = 0;
			for (const b of quotaRes.buckets) if (b.modelId) maxLen = Math.max(maxLen, b.modelId.length);

			for (const b of quotaRes.buckets) {
				if (!b.modelId || b.remainingFraction === undefined) continue;
				
				const label = `  ${b.modelId.padEnd(maxLen)}: `;
				const fraction = b.remainingFraction;
				const filled = Math.round(fraction * 30);
				const empty = 30 - filled;
				
				let colorFn = chalk.green;
				if (fraction < 0.2) colorFn = chalk.red;
				else if (fraction < 0.5) colorFn = chalk.yellow;

				const bar = colorFn("█".repeat(filled)) + chalk.gray("░".repeat(empty));
				const remaining = b.remainingAmount || Math.round(fraction * 100);
				const limit = b.remainingAmount ? Math.round(Number.parseInt(b.remainingAmount) / fraction) : 100;
				const reset = b.resetTime ? ` (Resets: ${new Date(b.resetTime).toLocaleString()})` : "";
				const type = b.tokenType ? ` [${b.tokenType}]` : "";
				
				console.log(`${label}${bar}  ${Math.round(fraction * 100).toString().padStart(3)}% (${remaining}/${limit})${type}${reset}`);
			}
		}
		console.log("");
	} catch (error) {
		console.error(chalk.red(`Error: ${error}`));
	}
}

main().catch(console.error);

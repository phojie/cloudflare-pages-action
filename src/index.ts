import { getInput, setOutput, setFailed, summary } from "@actions/core";
import type { Project, Deployment } from "@cloudflare/types";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { env } from "process";
import path from "node:path";

// Helper function to get GitHub Actions run URL
const getGitHubActionsRunUrl = () => {
	const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
	const repository = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;

	if (!repository || !runId) {
		return serverUrl;
	}

	let url = `${serverUrl}/${repository}/actions/runs/${runId}`;

	// Add PR number if this is a pull request event
	if (context.payload.pull_request) {
		url += `?pr=${context.payload.pull_request.number}`;
	}

	return url;
};

type Octokit = ReturnType<typeof getOctokit>;

// Define a common type for deployment info
type DeploymentInfo = {
	name: string;
	status: string;
	url: string;
	inspect_url: string;
	updated: string;
};

const headerTitle = "🚀 Deploying your latest changes";

// Helper function to extract domain from URL
const extractDomainFromUrl = (url: string): string | null => {
	try {
		// Remove protocol and get domain
		const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
		return match ? match[1] : null;
	} catch (error) {
		console.warn(`Failed to extract domain from URL: ${url}`);
		return null;
	}
};

// Helper function to generate performance badge for a URL
const getPerformanceBadge = (url: string): string => {
	const domain = extractDomainFromUrl(url);
	if (!domain) return "";

	return `\n[![Performance](https://page-speed.dev/badge/${domain})](https://page-speed.dev/${domain})`;
};

// Helper function to extract deployments from comment body
const extractDeploymentsFromComment = (commentBody: string, currentProjectName: string): DeploymentInfo[] => {
	const deployments: DeploymentInfo[] = [];

	// Try to extract existing deployments from the table - using a more robust regex that handles multiline cells
	const tableRegex = /\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([\s\S]*?)\s*\|\s*([^|]*?)\s*\|/g;
	const matches = [...commentBody.matchAll(tableRegex)];

	// Skip header and separator rows
	if (matches.length > 2) {
		for (let i = 2; i < matches.length; i++) {
			const match = matches[i];
			if (match.length >= 5) {
				const name = match[1].trim();
				const status = match[2].trim();
				const url = match[3].trim();
				const updated = match[4].trim();

				// Extract inspect URL from markdown link in Status column
				const inspectUrlMatch = status.match(/\[Inspect\]\(([^)]+)\)/);
				const inspect_url = inspectUrlMatch ? inspectUrlMatch[1] : "";

				// Only add if it's not the current project being updated
				if (name !== currentProjectName) {
					deployments.push({ name, status, url, inspect_url, updated });
				}
			}
		}
	}

	return deployments;
};

try {
	const apiToken = getInput("apiToken", { required: true });
	const accountId = getInput("accountId", { required: true });
	const projectName = getInput("projectName", { required: true });
	const directory = getInput("directory", { required: true });
	const gitHubToken = getInput("gitHubToken", { required: false });
	const branch = getInput("branch", { required: false });
	const workingDirectory = getInput("workingDirectory", { required: false });
	const wranglerVersion = getInput("wranglerVersion", { required: false });
	const debug = getInput("debug", { required: false });
	const timezone = getInput("timezone", { required: false }) || "UTC";

	// GitHub App authentication inputs
	const appId = getInput("appId", { required: false });
	const privateKey = getInput("privateKey", { required: false });
	const installationId = getInput("installationId", { required: false });

	// Get reactions input and parse it to an array
	const reactionsInput = getInput("reactions", { required: false });
	const reactions = reactionsInput
		? reactionsInput
				.split("\n")
				.map((r) => r.trim())
				.filter(Boolean)
		: [];

	const getProject = async () => {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
			{ headers: { Authorization: `Bearer ${apiToken}` } }
		);
		if (response.status !== 200) {
			console.error(`Cloudflare API returned non-200: ${response.status}`);
			const json = await response.text();
			console.error(`API returned: ${json}`);
			throw new Error("Failed to get Pages project, API returned non-200");
		}

		const { result } = (await response.json()) as { result: Project | null };
		if (result === null) {
			throw new Error("Failed to get Pages project, project does not exist. Check the project name or create it!");
		}

		return result;
	};

	const createPagesDeployment = async () => {
		// TODO: Replace this with an API call to wrangler so we can get back a full deployment response object
		await shellac.in(path.join(process.cwd(), workingDirectory))`
    $ export CLOUDFLARE_API_TOKEN="${apiToken}"
    if ${accountId} {
      $ export CLOUDFLARE_ACCOUNT_ID="${accountId}"
    }
  
    $$ npx wrangler@${wranglerVersion} pages deploy "${directory}" --project-name="${projectName}" --branch="${branch}"
    `;

		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
			{ headers: { Authorization: `Bearer ${apiToken}` } }
		);
		const {
			result: [deployment],
		} = (await response.json()) as { result: Deployment[] };

		return deployment;
	};

	const githubBranch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;

	// Initialize GitHub Octokit with appropriate token
	const getOctokitClient = async (): Promise<Octokit> => {
		// If GitHub App credentials are provided, use them to generate an installation token
		if (appId && privateKey && installationId) {
			// Dynamically import @octokit/auth-app to avoid adding it as a direct dependency
			const { createAppAuth } = await import("@octokit/auth-app");

			const auth = createAppAuth({
				appId,
				privateKey,
				installationId,
			});

			// Generate an installation token
			const { token } = await auth({ type: "installation" });

			return getOctokit(token);
		}

		// Otherwise, use the provided GitHub token
		return getOctokit(gitHubToken);
	};

	const createDeploymentComment = async (octokit: Octokit, body: string) => {
		if (!context.issue.number) return;

		const comments = await octokit.rest.issues.listComments({
			owner: context.repo.owner,
			repo: context.repo.repo,
			issue_number: context.issue.number,
		});
		if (debug) console.dir("comments.data", comments.data);
		const deploymentComment = comments.data.find((c) => c.body?.includes(headerTitle));

		let commentId: number;
		// Update or create comment
		if (deploymentComment) {
			const result = await octokit.rest.issues.updateComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				comment_id: deploymentComment.id,
				body,
			});
			commentId = deploymentComment.id;
			return result;
		} else {
			const result = await octokit.rest.issues.createComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				body,
			});
			commentId = result.data.id;
			return result;
		}
	};

	// Function to add reactions to a comment
	const addReactionsToComment = async (octokit: Octokit, commentId: number, reactions: string[]) => {
		if (!reactions.length) return;

		// Map common emoji names to GitHub reaction content values
		const reactionMap: Record<string, string> = {
			"+1": "+1",
			"-1": "-1",
			laugh: "laugh",
			confused: "confused",
			heart: "heart",
			hooray: "hooray",
			rocket: "rocket",
			eyes: "eyes",
		};

		// Add custom mappings for other emojis
		const customMap: Record<string, string> = {
			tada: "hooray",
			fire: "hooray",
			sparkles: "hooray",
			party_popper: "hooray",
			party_blob: "hooray",
		};

		for (const reaction of reactions) {
			try {
				// Try to use a standard reaction or default to +1
				let content: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes" = "+1";

				// Check if it's a standard reaction
				const lowered = reaction.toLowerCase();
				if (lowered in reactionMap) {
					content = reactionMap[lowered] as "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
				}
				// Check if it's a custom mapped reaction
				else if (lowered in customMap) {
					content = customMap[lowered] as "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
				}

				await octokit.rest.reactions.createForIssueComment({
					owner: context.repo.owner,
					repo: context.repo.repo,
					comment_id: commentId,
					content,
				});
				if (debug) console.log(`Added reaction "${content}" to comment ${commentId}`);
			} catch (error) {
				console.warn(`Failed to add reaction "${reaction}" to comment: ${error}`);
			}
		}
	};

	const createGitHubDeployment = async (octokit: Octokit, productionEnvironment: boolean, environment: string) => {
		const deployment = await octokit.rest.repos.createDeployment({
			owner: context.repo.owner,
			repo: context.repo.repo,
			ref: branch || context.sha,
			auto_merge: false,
			description: "Cloudflare Pages",
			required_contexts: [],
			environment,
			production_environment: productionEnvironment,
		});
		if (debug) console.dir("deployment.data", deployment.data);

		if (deployment.status === 201) {
			return deployment.data;
		}
	};

	const createGitHubDeploymentStatus = async ({
		id,
		url,
		deploymentId,
		environmentName,
		productionEnvironment,
		octokit,
	}: {
		octokit: Octokit;
		id: number;
		url: string;
		deploymentId: string;
		environmentName: string;
		productionEnvironment: boolean;
	}) => {
		// Get GitHub Actions run URL for logs
		const actionsRunUrl = getGitHubActionsRunUrl();

		return octokit.rest.repos.createDeploymentStatus({
			owner: context.repo.owner,
			repo: context.repo.repo,
			deployment_id: id,
			// @ts-ignore
			environment: environmentName,
			environment_url: url,
			production_environment: productionEnvironment,
			log_url: actionsRunUrl,
			description: "Cloudflare Pages",
			state: "success",
			auto_inactive: false,
		});
	};

	const createJobSummary = async ({
		deployment,
		aliasUrl,
		productionEnvironment,
		deployments = [],
	}: {
		deployment: Deployment;
		aliasUrl: string;
		productionEnvironment: boolean;
		deployments?: DeploymentInfo[];
	}) => {
		const deployStage = deployment.stages.find((stage) => stage.name === "deploy");

		// Format current deployment status
		let statusIcon = "✅";
		let statusText = "Ready";
		let url_emoji = "😎";
		if (deployStage?.status === "idle") {
			statusIcon = "⚡️";
			statusText = "Deploying";
			url_emoji = "⚡️";
		} else if (deployStage?.status === "failure") {
			statusIcon = "🚫";
			statusText = "Failed";
			url_emoji = "💥";
		}

		// Format date for "Updated" column with configurable timezone
		const updatedDate = new Date().toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: timezone,
			hour12: true,
		});

		// Format inspect URL - use GitHub Actions run URL only
		const inspectUrl = getGitHubActionsRunUrl();

		// Generate the performance badge for the URL if it exists
		const performanceBadge = aliasUrl ? getPerformanceBadge(aliasUrl) : "";

		// Add current deployment to the list
		deployments.push({
			name: projectName,
			status: `${statusIcon} ${statusText} ([Inspect](${inspectUrl}))`,
			url: aliasUrl ? `${url_emoji} [Visit Preview](${aliasUrl})${performanceBadge}` : "",
			inspect_url: inspectUrl,
			updated: updatedDate,
		});

		// Create summary table
		let tableContent = `## ${headerTitle}

| Name | Status | Preview | Updated (${timezone}) | 
| ---- | ------ | ------- | ------------- |
`;

		// Add all deployments to the table
		for (const dep of deployments) {
			// Make the project name bold if it matches the current project
			const nameCell = dep.name === projectName ? `**${dep.name}**` : dep.name;
			tableContent += `| ${nameCell} | ${dep.status} | ${dep.url} | ${dep.updated} |\n`;
		}

		// Add commit info below the table
		tableContent += `\n**Latest commit:** \`${deployment.deployment_trigger.metadata.commit_hash.substring(0, 8)}\``;

		await summary.addRaw(tableContent).write();
		return tableContent;
	};

	(async () => {
		// Get Octokit client with appropriate authentication
		const octokit = await getOctokitClient();
		const project = await getProject();

		const productionEnvironment = githubBranch === project.production_branch || branch === project.production_branch;
		const environmentName = `${projectName} (${productionEnvironment ? "Production" : "Preview"})`;

		let gitHubDeployment: Awaited<ReturnType<typeof createGitHubDeployment>>;

		if ((gitHubToken && gitHubToken.length) || (appId && privateKey && installationId)) {
			gitHubDeployment = await createGitHubDeployment(octokit, productionEnvironment, environmentName);
		}

		const pagesDeployment = await createPagesDeployment();
		if (debug) console.dir("pagesDeployment", pagesDeployment);
		setOutput("id", pagesDeployment.id);
		setOutput("url", pagesDeployment.url);
		setOutput("environment", pagesDeployment.environment);

		let alias = pagesDeployment.url;
		if (!productionEnvironment && pagesDeployment.aliases && pagesDeployment.aliases.length > 0) {
			alias = pagesDeployment.aliases[0];
		}
		setOutput("alias", alias);

		// Get existing deployments from comment if available
		let existingDeployments: DeploymentInfo[] = [];

		if (((gitHubToken && gitHubToken.length) || (appId && privateKey && installationId)) && context.issue.number) {
			const comments = await octokit.rest.issues.listComments({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
			});

			const deploymentComment = comments.data.find((c) => c.body?.includes(headerTitle));

			if (deploymentComment && deploymentComment.body) {
				existingDeployments = extractDeploymentsFromComment(deploymentComment.body, projectName);
			}
		}

		const summaryContent = await createJobSummary({
			deployment: pagesDeployment,
			aliasUrl: alias,
			productionEnvironment,
			deployments: existingDeployments,
		});

		const commentResult = await createDeploymentComment(octokit, summaryContent);

		// Add reactions to the comment if specified
		if (commentResult && reactions.length > 0) {
			const commentId = commentResult.data.id;
			await addReactionsToComment(octokit, commentId, reactions);
		}

		if (gitHubDeployment) {
			const deploymentStatus = await createGitHubDeploymentStatus({
				id: gitHubDeployment.id,
				url: pagesDeployment.url,
				deploymentId: pagesDeployment.id,
				environmentName,
				productionEnvironment,
				octokit,
			});
			if (debug) console.dir("deploymentStatus.data", deploymentStatus.data);
		}
	})();
} catch (thrown) {
	setFailed(thrown.message);
}

import { getInput, setOutput, setFailed, summary } from "@actions/core";
import type { Project, Deployment } from "@cloudflare/types";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { env } from "process";
import path from "node:path";

type Octokit = ReturnType<typeof getOctokit>;

// Define a common type for deployment info
type DeploymentInfo = {
	name: string;
	status: string;
	url: string;
	inspect_url: string;
	updated: string;
};

// Helper function to extract deployments from comment body
const extractDeploymentsFromComment = (
	commentBody: string,
	currentProjectName: string
): DeploymentInfo[] => {
	const deployments: DeploymentInfo[] = [];
	
	// Try to extract existing deployments from the table
	const tableRows = commentBody.match(/\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g);
	if (tableRows && tableRows.length > 2) { // Skip header and separator rows
		for (let i = 2; i < tableRows.length; i++) {
			const row = tableRows[i];
			const cells = row.split('|').map(cell => cell.trim()).filter(Boolean);
			if (cells.length >= 4) {
				const name = cells[0];
				const status = cells[1];
				// Extract URL from markdown link in Preview column
				const urlMatch = cells[2].match(/\[([^\]]+)\]\(([^)]+)\)/);
				const url = urlMatch ? urlMatch[2] : '';
				// Extract inspect URL from markdown link in Status column
				const inspectUrlMatch = cells[1].match(/\[([^\]]+)\]\(([^)]+)\)/);
				const inspect_url = inspectUrlMatch ? inspectUrlMatch[2] : '';
				const updated = cells[3];
				
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
	
	// GitHub App authentication inputs
	const appId = getInput("appId", { required: false });
	const privateKey = getInput("privateKey", { required: false });
	const installationId = getInput("installationId", { required: false });

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
			const { createAppAuth } = await import('@octokit/auth-app');
			
			const auth = createAppAuth({
				appId,
				privateKey,
				installationId,
			});
			
			// Generate an installation token
			const { token } = await auth({ type: 'installation' });
			
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
		const deploymentComment = comments.data.find(
			(c) => !!c.performed_via_github_app?.id && c.body?.includes("🚀 Deploying your latest changes")
		);
		
		// Update or create comment
		if (deploymentComment) {
			return octokit.rest.issues.updateComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				comment_id: deploymentComment.id,
				body,
			});
		} else {
			return octokit.rest.issues.createComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				body,
			});
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
		if (debug) console.dir("deployment.data", deployment.data)

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
		return octokit.rest.repos.createDeploymentStatus({
			owner: context.repo.owner,
			repo: context.repo.repo,
			deployment_id: id,
			// @ts-ignore
			environment: environmentName,
			environment_url: url,
			production_environment: productionEnvironment,
			log_url: `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/${deploymentId}`,
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
		let statusIcon = "⚡️";
		let statusText = "Deploying";
		
		if (deployStage?.status === "success") {
			statusIcon = "✅";
			statusText = "Ready";
		} else if (deployStage?.status === "failure") {
			statusIcon = "🚫";
			statusText = "Failed";
		}
		
		// Format date for "Updated" column
		const updatedDate = new Date().toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'UTC',
			hour12: false
		});

		// Format inspect URL
		const inspectUrl = `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}/${deployment.id}`;
		
		// Add current deployment to the list
		deployments.push({
			name: projectName,
			status: `${statusIcon} ${statusText} ([Inspect](${inspectUrl}))`,
			url: aliasUrl,
			inspect_url: inspectUrl,
			updated: updatedDate
		});
		
		// Create summary table
		let tableContent = `# 🚀 Deploying your latest changes

| Name | Status | Preview | Updated (UTC) |
| ---- | ------ | ------- | ------------- |
`;

		// Add all deployments to the table
		for (const dep of deployments) {
			tableContent += `| ${dep.name} | ${dep.status} | [Visit Preview](${dep.url}) | ${dep.updated} |\n`;
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
			
			const deploymentComment = comments.data.find(
				(c) => c.body?.includes("🚀 Deploying your latest changes")
			);
			
			if (deploymentComment && deploymentComment.body) {
				existingDeployments = extractDeploymentsFromComment(deploymentComment.body, projectName);
			}
		}

		const summaryContent = await createJobSummary({ 
			deployment: pagesDeployment, 
			aliasUrl: alias, 
			productionEnvironment,
			deployments: existingDeployments
		});
		
		await createDeploymentComment(octokit, summaryContent);

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

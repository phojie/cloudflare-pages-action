import { getInput, setOutput, setFailed, summary } from "@actions/core";
import type { Project, Deployment } from "@cloudflare/types";
import { context, getOctokit } from "@actions/github";
import shellac from "shellac";
import { fetch } from "undici";
import { env } from "process";
import path from "node:path";

type Octokit = ReturnType<typeof getOctokit>;

try {
	const apiToken = getInput("apiToken", { required: true });
	const accountId = getInput("accountId", { required: true });
	const projectName = getInput("projectName", { required: true });
	const directory = getInput("directory", { required: true });
	const gitHubToken = getInput("gitHubToken", { required: false });
	const branch = getInput("branch", { required: false });
	const workingDirectory = getInput("workingDirectory", { required: false });
	const wranglerVersion = getInput("wranglerVersion", { required: false });

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

	const createDeploymentComment = async (octokit: Octokit, body: string) => {
		const comments = await octokit.rest.issues.listComments({
			owner: context.repo.owner,
			repo: context.repo.repo,
			issue_number: context.issue.number
		})
		console.dir(comments.data)
		const deploymentComment = comments.data.find(c => !!c.performed_via_github_app?.id && c.body?.includes("Deploying with Cloudflare Pages"))
		if (deploymentComment) {
			// update comment
			return octokit.rest.issues.updateComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				comment_id: deploymentComment.id,
				body,
			})
		} else {
			// create comment
			return octokit.rest.issues.createComment({
				owner: context.repo.owner,
				repo: context.repo.repo,
				issue_number: context.issue.number,
				body
			})
		}
	}

	const createGitHubDeployment = async (octokit: Octokit, productionEnvironment: boolean, environment: string) => {
		const deployment = await octokit.rest.repos.createDeployment({
			owner: context.repo.owner,
			repo: context.repo.repo,
			ref: `refs/pull/${context.issue.number}/merge` || context.sha,
			auto_merge: false,
			description: "Cloudflare Pages",
			required_contexts: [],
			environment,
			production_environment: productionEnvironment,
		});
		console.log(deployment.data)

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

	const createJobSummary = async ({ deployment, aliasUrl }: { deployment: Deployment; aliasUrl: string }) => {
		const deployStage = deployment.stages.find((stage) => stage.name === "deploy");

		let status = "⚡️  Deployment in progress...";
		if (deployStage?.status === "success") {
			status = "✅  Deploy successful!";
		} else if (deployStage?.status === "failure") {
			status = "🚫  Deployment failed";
		}

		const summaryBody = `# Deploying with Cloudflare Pages

| Name                    | Result |
| ----------------------- | - |
| **Last commit:**        | \`${deployment.deployment_trigger.metadata.commit_hash.substring(0, 8)}\` |
| **Status**:             | ${status} |
| **Preview URL**:        | ${deployment.url} |
| **Branch Preview URL**: | ${aliasUrl} |`

		await summary.addRaw(summaryBody).write();
		return summaryBody
	};

	(async () => {
		const octokit = getOctokit(gitHubToken);
		const project = await getProject();

		const productionEnvironment = githubBranch === project.production_branch || branch === project.production_branch;
		const environmentName = `${projectName} (${productionEnvironment ? "Production" : "Preview"})`;

		let gitHubDeployment: Awaited<ReturnType<typeof createGitHubDeployment>>;

		if (gitHubToken && gitHubToken.length) {
			gitHubDeployment = await createGitHubDeployment(octokit, productionEnvironment, environmentName);
		}

		const pagesDeployment = await createPagesDeployment();
		setOutput("id", pagesDeployment.id);
		setOutput("url", pagesDeployment.url);
		setOutput("environment", pagesDeployment.environment);

		let alias = pagesDeployment.url;
		if (!productionEnvironment && pagesDeployment.aliases && pagesDeployment.aliases.length > 0) {
			alias = pagesDeployment.aliases[0];
		}
		setOutput("alias", alias);

		const summary = await createJobSummary({ deployment: pagesDeployment, aliasUrl: alias });
		await createDeploymentComment(octokit, summary)

		if (gitHubDeployment) {
			const deploymentStatus = await createGitHubDeploymentStatus({
				id: gitHubDeployment.id,
				url: pagesDeployment.url,
				deploymentId: pagesDeployment.id,
				environmentName,
				productionEnvironment,
				octokit,
			});
			console.dir(deploymentStatus.data)
		}
	})();
} catch (thrown) {
	setFailed(thrown.message);
}

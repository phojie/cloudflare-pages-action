# Cloudflare Pages GitHub Action + Monorepo Support

GitHub Action for creating Cloudflare Pages deployments, using the new [Direct Upload](https://developers.cloudflare.com/pages/platform/direct-upload/) feature and [Wrangler](https://developers.cloudflare.com/pages/platform/direct-upload/#wrangler-cli) integration.

## Features

- Seamlessly deploy your static site to Cloudflare Pages
- GitHub Deployment integration
- Automatic PR comments with deployment status
- Detailed job summary
- Multi-deployment support for monorepo projects
  - Automatically detects multiple deployments in the same repository
  - Merges deployment information into a single table
  - Updates information about all deployments with each new deployment

## Usage

1. Create an API token in the Cloudflare dashboard with the "Cloudflare Pages — Edit" permission.
1. Add that API token as a secret to your GitHub repository, `CLOUDFLARE_API_TOKEN`.
1. Create a `.github/workflows/publish.yml` file in your repository:

   ```yml
   on: [push]

   jobs:
     publish:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         deployments: write
       name: Publish to Cloudflare Pages
       steps:
         - name: Checkout
           uses: actions/checkout@v3

         # Run a build step here if your project requires

         - name: Publish to Cloudflare Pages
           uses: cloudflare/pages-action@v1
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: YOUR_ACCOUNT_ID
             projectName: YOUR_PROJECT_NAME
             directory: YOUR_BUILD_OUTPUT_DIRECTORY
             # Optional: Enable this if you want to have GitHub Deployments triggered
             gitHubToken: ${{ secrets.GITHUB_TOKEN }}
             # Optional: Switch what branch you are publishing to.
             # By default this will be the branch which triggered this workflow
             branch: main
             # Optional: Change the working directory
             workingDirectory: my-site
             # Optional: Change the Wrangler version, allows you to point to a specific version or a tag such as `beta`
             wranglerVersion: "3"
   ```

1. Replace `YOUR_ACCOUNT_ID`, `YOUR_PROJECT_NAME` and `YOUR_BUILD_OUTPUT_DIRECTORY` with the appropriate values to your Pages project.

### Get account ID

To find your account ID, log in to the Cloudflare dashboard > select your zone in Account Home > find your account ID in Overview under **API** on the right-side menu. If you have not added a zone, add one by selecting **Add site** . You can purchase a domain from [Cloudflare's registrar](https://developers.cloudflare.com/registrar/).

If you do not have a zone registered to your account, you can also get your account ID from the `pages.dev` URL. E.g: `https://dash.cloudflare.com/<ACCOUNT_ID>/pages`

### Generate an API Token

To generate an API token:

1. Log in to the Cloudflare dashboard.
2. Select My Profile from the dropdown menu of your user icon on the top right of your dashboard.
3. Select API Tokens > Create Token.
4. Under Custom Token, select Get started.
5. Name your API Token in the Token name field.
6. Under Permissions, select Account, Cloudflare Pages and Edit:
7. Select Continue to summary > Create Token.

More information can be found on [our guide for making Direct Upload deployments with continous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/#use-github-actions).

### Specifying a branch

The branch name is used by Cloudflare Pages to determine if the deployment is production or preview. Read more about
[git branch build controls](https://developers.cloudflare.com/pages/platform/branch-build-controls/#branch-build-controls).

If you are in a Git workspace, Wrangler will automatically pull the branch information for you. You can override this
manually by adding the argument `branch: YOUR_BRANCH_NAME`.

### Specifying a working directory

By default Wrangler will run in the root package directory. If your app lives in a monorepo and you want to run Wrangler from its directory, add `workingDirectory: YOUR_PACKAGE_DIRECTORY`.

### Wrangler v3

You can use the newly released [Wrangler v3](https://blog.cloudflare.com/wrangler3/) with the `wranglerVersion` property.

## Outputs

| Name          | Description                                         |
| ------------- | --------------------------------------------------- |
| `id`          | The ID of the pages deployment                      |
| `url`         | The URL of the pages deployment                     |
| `alias`       | The alias if it exists otherwise the deployment URL |
| `environment` | The environment that was deployed to                |

## Monorepo Example

If you have a monorepo with multiple Cloudflare Pages projects, you can use this action to deploy them all in a single workflow. Here's an example:

```yaml
name: Deploy Cloudflare Pages Projects

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy-docs:
    runs-on: ubuntu-latest
    name: Deploy Docs Site
    steps:
      - uses: actions/checkout@v3
      - name: Build Docs
        run: |
          cd docs
          npm ci
          npm run build
      - name: Publish to Cloudflare Pages
        uses: phojie/cloudflare-pages-action@main
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-docs-site
          directory: docs/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

  deploy-marketing:
    runs-on: ubuntu-latest
    name: Deploy Marketing Site
    steps:
      - uses: actions/checkout@v3
      - name: Build Marketing Site
        run: |
          cd marketing
          npm ci
          npm run build
      - name: Publish to Cloudflare Pages
        uses: phojie/cloudflare-pages-action@main
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-marketing-site
          directory: marketing/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

  deploy-app:
    runs-on: ubuntu-latest
    name: Deploy Main App
    steps:
      - uses: actions/checkout@v3
      - name: Build App
        run: |
          cd app
          npm ci
          npm run build
      - name: Publish to Cloudflare Pages
        uses: phojie/cloudflare-pages-action@main
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-main-app
          directory: app/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

This will deploy all three projects and maintain a single deployment summary in the pull request comment, showing the status of all deployments in one view.

## Using a Custom GitHub App for Comments

By default, comments created by this action will show the GitHub Actions bot avatar. If you want to use a custom avatar (like the triangular logo shown in the screenshots), you can create a GitHub App:

1. **Create a GitHub App**

   - Go to your GitHub account settings > Developer settings > GitHub Apps
   - Click "New GitHub App"
   - Fill in the required fields:
     - Name: "Cloudflare Pages Deployer" (or your preferred name)
     - Homepage URL: Your repo URL
     - Webhook: Disable it (uncheck "Active")
   - Set permissions:
     - Issues: Read & Write
     - Pull requests: Read & Write
   - Upload your custom logo/avatar
   - Create the app

2. **Install the App to your repositories**

   - After creating, click "Install App"
   - Select which repositories to enable it for

3. **Generate a private key**

   - In your app settings, scroll down to "Private keys"
   - Click "Generate a private key"
   - Download the key file

4. **Use the App in your workflow**
   ```yaml
   - name: Publish to Cloudflare Pages
     uses: phojie/cloudflare-pages-action@main
     with:
       apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
       projectName: your-project-name
       directory: dist
       # GitHub App credentials instead of gitHubToken
       appId: ${{ secrets.GH_APP_ID }}
       privateKey: ${{ secrets.GH_PRIVATE_KEY }}
       installationId: ${{ secrets.GH_INSTALLATION_ID }}
   ```

The Installation ID can be found in the URL when you visit the installation page of your GitHub App (`https://github.com/settings/installations/{INSTALLATION_ID}`).

## Adding Reactions to Comments

You can automatically add reactions to deployment comments by specifying them in your workflow:

```yaml
- name: Publish to Cloudflare Pages
  uses: phojie/cloudflare-pages-action@main
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: your-project-name
    directory: dist
    # Add reactions to the deployment comment
    reactions: |
      rocket
      hooray
      heart
```

Supported reactions:

- `+1` (👍)
- `-1` (👎)
- `laugh` (😄)
- `confused` (😕)
- `heart` (❤️)
- `hooray` (🎉)
- `rocket` (🚀)
- `eyes` (👀)

Custom emoji names like `tada`, `fire`, `sparkles`, `party_popper` will be mapped to appropriate GitHub reactions.

### Complete Example with Custom App and Reactions

Here's a complete example using both a custom GitHub App and adding reactions:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm run build

      - name: Deploy to Cloudflare Pages
        uses: phojie/cloudflare-pages-action@main
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: your-project-name
          directory: dist
          # GitHub App credentials for custom avatar
          appId: ${{ secrets.GH_APP_ID }}
          privateKey: ${{ secrets.GH_PRIVATE_KEY }}
          installationId: ${{ secrets.GH_INSTALLATION_ID }}
          # Add multiple reactions
          reactions: |
            rocket
            heart
            hooray
```

This will deploy your site, create a comment with your custom GitHub App avatar, and add three reactions to the comment.

## Detailed Documentation

For more detailed information and advanced usage, check out these guides:

- [Setting up a GitHub App for Custom Avatars](docs/github-app-guide.md)
- [Adding Reactions to Deployment Comments](docs/reactions-guide.md)

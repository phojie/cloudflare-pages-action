# Setting up a GitHub App for Custom Avatars

This guide walks you through creating a GitHub App for use with the Cloudflare Pages Action. Using a GitHub App allows your deployment comments to show a custom avatar/logo instead of the default GitHub Actions bot avatar.

## Step 1: Create the GitHub App

1. Go to your GitHub account settings
2. Navigate to **Developer settings** > **GitHub Apps**
3. Click **New GitHub App**
4. Fill in the following details:
   - **GitHub App name**: "Cloudflare Pages Deployer" (or any name you prefer)
   - **Homepage URL**: Your repository URL (e.g., `https://github.com/yourusername/yourrepo`)
   - **Webhook**: Uncheck "Active" (we don't need webhooks)
   - **Description**: "Custom app for Cloudflare Pages deployments"

## Step 2: Set App Permissions

Under "Permissions", set the following:

1. **Repository permissions**:

   - **Issues**: Read & Write
   - **Pull requests**: Read & Write
   - **Contents**: Read-only (if you want to comment on specific code/files)
   - **Deployments**: Read & Write (required if you want GitHub deployment status integration)

2. **Account permissions**: None needed

3. **Organization permissions**: None needed

4. **Where can this GitHub App be installed?**: Either select "Only on this account" or "Any account" depending on your needs

## Step 3: Upload a Custom Logo

1. Prepare an image file meeting these requirements:

   - Square dimensions (1:1 aspect ratio)
   - At least 200x200 pixels
   - File size under 1MB
   - PNG, JPG, or GIF format

2. Click **Upload a logo** and select your image file

3. Click **Create GitHub App**

## Step 4: Install the App

1. After creating the app, you'll be taken to the app's settings page
2. Click **Install App** from the sidebar
3. Choose the account where you want to install the app
4. Select which repositories to give the app access to
   - You can select "All repositories" or "Only select repositories"
5. Click **Install**

## Step 5: Generate a Private Key

1. Go back to the app's settings page
2. Scroll down to the "Private keys" section
3. Click **Generate a private key**
4. This will download a `.pem` file containing the private key

## Step 6: Get the Required IDs

You need three pieces of information:

1. **App ID**: Found at the top of your app's settings page
2. **Installation ID**: Found in the URL when you visit the installation page
   - The URL will look like: `https://github.com/settings/installations/INSTALLATION_ID`
3. **Private Key**: The contents of the `.pem` file downloaded earlier

## Step 7: Configure Your GitHub Workflow

```yaml
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
```

## Step 8: Add Secrets to Your Repository

1. Go to your repository settings
2. Navigate to **Secrets and variables** > **Actions**
3. Add the following secrets:
   - `GH_APP_ID`: Your GitHub App ID (a number)
   - `GH_INSTALLATION_ID`: Your installation ID (a number)
   - `GH_PRIVATE_KEY`: The entire contents of the `.pem` file

## Troubleshooting

- **Comment shows default bot avatar**: Make sure your GitHub App has the required permissions and the correct credentials are being used.
- **Authentication errors**: Verify the private key is correctly set as a secret, including any newline characters.
- **Permission errors**: Ensure your app has both Issues and Pull requests write permissions.

That's it! Your deployment comments should now show your custom avatar.

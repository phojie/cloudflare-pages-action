# Adding Reactions to Deployment Comments

This guide shows you how to configure your Cloudflare Pages Action to automatically add reactions to deployment comments in pull requests.

## What Are Reactions?

GitHub allows adding emoji reactions to comments, such as 👍, ❤️, 🚀, etc. Adding reactions to your deployment comments can:

- Make them more noticeable in busy pull requests
- Indicate the status of a deployment at a glance
- Add a touch of personality to your CI/CD process

## Basic Configuration

Add the `reactions` input to your workflow configuration:

```yaml
- name: Deploy to Cloudflare Pages
  uses: phojie/cloudflare-pages-action@main
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: your-project-name
    directory: dist
    reactions: |
      rocket
      hooray
```

## Supported Reactions

GitHub supports these standard reactions:

| Reaction Name | Emoji |
|---------------|-------|
| `+1`          | 👍    |
| `-1`          | 👎    |
| `laugh`       | 😄    |
| `confused`    | 😕    |
| `heart`       | ❤️    |
| `hooray`      | 🎉    |
| `rocket`      | 🚀    |
| `eyes`        | 👀    |

## Alternate Emoji Names

The action also supports common alternative names that will be mapped to GitHub's standard reactions:

| Alternative Name | Maps to  | GitHub Emoji |
|------------------|----------|--------------|
| `tada`           | `hooray` | 🎉           |
| `fire`           | `hooray` | 🎉           |
| `sparkles`       | `hooray` | 🎉           |
| `party_popper`   | `hooray` | 🎉           |
| `party_blob`     | `hooray` | 🎉           |

## Example Configurations

### Simple Success Indicator

```yaml
reactions: rocket
```

### Celebration for Successful Deployments

```yaml
reactions: |
  rocket
  hooray
  heart
```

### Attentions to Reviews Needed

```yaml
reactions: |
  rocket
  eyes
```

## Advanced Usage: Conditional Reactions

You can conditionally apply reactions based on the workflow context:

```yaml
# Apply different reactions based on branch
- name: Deploy to Cloudflare Pages
  uses: phojie/cloudflare-pages-action@main
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: your-project-name
    directory: dist
    # Only add these reactions for main branch deployments
    reactions: ${{ github.ref == 'refs/heads/main' && 'rocket\nheart\nhooray' || 'rocket' }}
```

## Combining with Custom GitHub App

For the best experience, combine reactions with a custom GitHub App avatar:

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
    # Add reactions
    reactions: |
      rocket
      heart
```

This will post comments with your custom avatar and add the specified reactions to them. 

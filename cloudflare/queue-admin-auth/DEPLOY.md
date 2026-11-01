# Queue admin password service

The Worker stores only a salted password hash, short-lived bearer sessions, and hashed IP rate-limit keys. Site edits remain in each browser's local storage.

## Configure and deploy

1. Publish the site with GitHub Pages and note its HTTPS origin. Use only the origin, without a repository path, for example `https://account.github.io`.
2. Set `vars.ALLOWED_ORIGIN` in `wrangler.jsonc` to that exact origin.
3. From this directory, deploy the Worker with Wrangler:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   ```

   The config creates the SQLite-backed Durable Object namespace and deploys the `AuthState` class.
4. In Cloudflare, open the Worker settings and add a secret named `BOOTSTRAP_KEY`. Generate a unique random value of at least 32 characters and keep it private.
5. Copy the deployed `workers.dev` HTTPS URL into `QUEUE_AUTH_API` in the site's `auth-config.js`.
6. Publish the updated site. Open `admin.html`, enter the Cloudflare bootstrap key, then create the admin password (at least 12 characters).
7. After password setup succeeds, remove the `BOOTSTRAP_KEY` secret from the Worker settings. The one-time setup endpoint will remain closed because the password is now initialized.

The Worker accepts requests only from `ALLOWED_ORIGIN`; changing the site's origin requires updating this setting and redeploying. Do not put either password or bootstrap key in the GitHub repository.

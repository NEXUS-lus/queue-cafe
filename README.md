# Qúeue website

Static website for the Qúeue cafe in Anapa. GitHub Pages serves this directory from the `main` branch; there is no build step.

## Project layout

```text
index.html                         Homepage and homepage content
menu.html                          Menu sections and menu content
admin.html                         Redirect to the visual editor
styles.css                         Shared layout, typography, and responsive styles
script.js                          Site settings and visual editor
auth-config.js                     Public URL of the Cloudflare auth Worker
assets/                            Images used by the pages
cloudflare/queue-admin-auth/       Password Worker, Wrangler config, and deployment guide
```

Keep the HTML entry points in the repository root: GitHub Pages links, relative asset URLs, and the admin redirect rely on this layout.

## Local preview

From this directory, run:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. To preview the editor, open `http://localhost:8000/index.html?admin=1`.

## Publishing

Push changes to `main`; GitHub Pages publishes the site from this directory. The password service is deployed separately. Its configuration, required secrets, and first-time setup are documented in [cloudflare/queue-admin-auth/DEPLOY.md](cloudflare/queue-admin-auth/DEPLOY.md).

Do not commit passwords, Cloudflare secrets, `.dev.vars`, or generated Wrangler files.

## Site editing and checks

Update page content in `index.html` and `menu.html`, shared presentation in `styles.css`, and editor behavior in `script.js`. Keep image files under `assets/` and update their references when replacing them.

The visual editor saves content and image overrides in the current browser's local storage; those edits do not sync between devices. Its login is handled by the Cloudflare Worker.

Before publishing, check JavaScript syntax and whitespace:

```powershell
node --check script.js
git diff --check
```

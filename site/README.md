# Prebuilt dashboard (served statically)

This folder is a **generated** copy of the dashboard, built with relative asset
paths (`ARBIBOT_BASE=./`) so it runs from any static host — including GitHub
Pages, a subfolder of any website, or a CDN that mirrors this repository.

It exists so the app has a permanent public URL even without a server:

* GitHub Pages (repository **Settings → Pages → Source: Deploy from a branch →
  `main` / `/site`**) serves it at `https://<user>.github.io/<repo>/`.
* Or enable **Settings → Pages → Source: GitHub Actions** and let
  `.github/workflows/pages.yml` publish the same thing.

Because no `/api` exists on a static host, the page detects that and runs the
scanner **in the visitor's browser**: it queries the public exchange APIs
directly and applies the same fee/slippage maths as the Python engine.

Rebuild after changing anything in `frontend/`:

```bash
cd frontend && ARBIBOT_BASE=./ npm run build && rm -rf ../site && mkdir -p ../site && \
  cp -r dist/* ../site/ && cp ../site/README.md /tmp/site-readme.md
# (the README is re-added above so it stays with the build)
```

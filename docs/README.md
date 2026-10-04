# GitHub Pages site (generated)

This folder is the **built dashboard**, published as-is. GitHub Pages branch
deployment can only serve the repository root or `/docs`, which is why the build
lives here.

* Enable it once: **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**
  → the app is live at `https://meysam8664.github.io/arbibot-web/`.
* Alternative: **Settings → Pages → Source: GitHub Actions**, and
  `.github/workflows/pages.yml` publishes the same thing on every push to `main`.

Because a static host has no `/api`, the page detects that and runs the scanner
**in the visitor's browser**: it queries the public exchange APIs directly and
applies the same fee/slippage maths as the Python engine.

Regenerate after changing `frontend/`:

```bash
make site        # builds with relative asset paths and refreshes this folder
```

Do not edit the generated files by hand — edit `frontend/` and rebuild.

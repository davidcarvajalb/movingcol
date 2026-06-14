# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Hugo static catalog plus a local Node/Express admin panel. Hugo content lives in `content/products/`, with one product per Markdown bundle such as `content/products/shelf/index.md`. Hugo templates are in `layouts/`, including `layouts/index.html`, `layouts/products/single.html`, and the shared base template in `layouts/_default/baseof.html`. Frontend assets are under `assets/`: SCSS partials in `assets/scss/` and product detail JavaScript in `assets/js/product-detail.js`. The local admin UI is `views/index.html`, and its API/file-management server is `admin-server.js`. Temporary uploads belong in `tmp-uploads/`; generated output in `public/` and `resources/_gen/` should not be committed.

## Build, Test, and Development Commands

- `docker compose up`: starts Hugo at `http://localhost:1313` and the admin panel at `http://localhost:3000`.
- `npm install`: installs the admin server dependencies when running outside Docker.
- `npm start`: runs `admin-server.js` locally on `PORT` or `3000`.
- `hugo server --bind 0.0.0.0 --port 1313`: runs only the static catalog for theme/content work.
- `hugo --gc --minify`: builds the production site into `public/`.

## Coding Style & Naming Conventions

Use two-space indentation in JavaScript, HTML, SCSS, TOML, and Markdown front matter. Keep JavaScript vanilla and localized unless a shared helper clearly reduces duplication. SCSS should stay modular: add design tokens to `_variables.scss`, reusable controls to `_components.scss`, page-specific layout to `_pages.scss`, and import through `styles.scss`. Product routes, folders, and API paths should use the English `products` naming already in the codebase. Name product image files sequentially where the admin workflow expects it, for example `foto-1.jpg`.

## Testing Guidelines

There is no automated test suite configured yet. Before submitting changes, run the relevant local service and manually verify the catalog, product detail gallery/lightbox, filters, WhatsApp link behavior, and admin create/edit/delete flows. For production-facing changes, also run `hugo --gc --minify` to catch template or asset pipeline errors.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style, such as `feat(catalog): add sold status`, `refactor(catalog): rename product routes`, or `docs: update README`. Keep commits focused and avoid checking in generated `public/`, `resources/_gen/`, `node_modules/`, or temporary uploads. Pull requests should include a concise description, manual verification steps, linked issues when applicable, and screenshots or screen recordings for visible UI changes.

## Security & Configuration Tips

Configure public site values in `hugo.toml`, including `baseURL`, `params.whatsappNumber`, and display currency. Do not commit real buyer-sensitive data unless it is intended to be published in the static catalog.

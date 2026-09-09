# Justin Martin MCP

A public, read-only MCP server for justinmartin.wiki. The website remains on GitHub Pages; the server runs on a Cloudflare Worker.

## Run and verify

Requires Node 22 or newer.

```sh
cd mcp-service
npm ci
npm test
npm run check
npm run dev
```

The local MCP endpoint is `http://localhost:8787/mcp`. `/health` checks the process only; call `get_profile` to check content retrieval.

## Deploy

1. Run `npx wrangler login` and sign in to your Cloudflare account.
2. Run `npm run deploy`. Wrangler prints your actual `workers.dev` URL.
3. Connect an MCP client to that URL with `/mcp` appended. Call all four tools and verify source links.
4. Put that complete HTTPS endpoint into `../mcp/config.json` as `{"endpoint":"https://YOUR-ACTUAL-WORKER-URL/mcp"}`.
5. Merge the website changes into `main` to publish the setup page at `https://justinmartin.wiki/mcp/`.

A custom `mcp.justinmartin.wiki` domain is optional and requires control of DNS. Do not point the GitHub Pages domain at this Worker. The service needs no secrets or database.

## Content

The service fetches only `content.json`, `updates.json`, and the Person JSON-LD in `index.html` from the public `justintylerm/wiki` repository’s `main` branch. Results are cached for 60 seconds per Worker instance, plus any GitHub CDN caching. Edits need no MCP redeployment. Only posts explicitly marked `published: true` are returned. The service does not read the admin directory or follow arbitrary input URLs. It derives contact links from the site; it invents no email or availability.

Supported tools: `get_profile`, `search_content`, `get_page`, and `get_contact`. Search uses keyword matching, suitable for the current small wiki. Returned note URLs use the existing `?post=` navigation; status updates link to the homepage.

Public access is intentional: no authentication, cookies, or write actions. Browser CORS allows public clients. For a higher-traffic launch, configure request limits in the hosting account as needed.

The stateless SDK transport handles MCP initialization, tool discovery, JSON-RPC validation, and JSON responses. Tests use the official client over the actual Worker fetch handler, including upstream errors, caching, invalid input, and draft exclusion.

## Maintenance

`npm audit` currently reports a libheif advisory through the development-only Wrangler → Miniflare → sharp dependency. No image processing is used here, and sharp is not in the deployed Worker bundle. Update Wrangler when a patched transitive version is released; do not apply the suggested downgrade blindly.

The setup page deliberately shows no connection URL until `mcp/config.json` is configured with the verified deployed endpoint.

# Contributing to ContainSite

## Getting started

1. Fork the repository
2. Clone your fork
3. Load the extension in Firefox via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on...** → select `manifest.json`

## Development

The extension is plain JavaScript with no build tools or dependencies. Edit files and reload the extension from `about:debugging` to see changes.

### Testing changes

1. Add a hostname alias in `/etc/hosts` (e.g. `127.0.0.1 containsite-test.site`) since localhost is excluded from containerization
2. Start a local server: `python3 -m http.server 8888 --bind 0.0.0.0`
3. Open `http://containsite-test.site:8888/test/fingerprint-test.html` to verify fingerprint vectors
4. Open the same page in multiple container tabs to confirm different fingerprints are generated

### Structure

- `background.js` — container lifecycle, navigation interception, HTTP header spoofing
- `inject.js` — fingerprint overrides injected into page context
- `lib/prng.js` — Mulberry32 PRNG
- `lib/fingerprint-gen.js` — seed-to-profile generator
- `popup/` — toolbar popup UI
- `options/` — full options page

## Submitting changes

1. Create a branch for your change
2. Make your changes and test locally
3. Commit with a clear, descriptive message
4. Open a pull request against `main`

## Reporting bugs

Open an issue with:

- Firefox/LibreWolf version
- Steps to reproduce
- Expected vs. actual behavior
- The site(s) affected, if applicable

## Code style

- 2-space indentation for JS, HTML, and CSS
- No external dependencies or build tools
- Use Firefox's `exportFunction()` / `cloneInto()` for page-context overrides (never inline script injection)

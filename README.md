# ContainSite

Per-site container isolation with unique device fingerprints for Firefox and LibreWolf.

Every website you visit is automatically placed in its own isolated container with a unique, deterministic device identity. Sites cannot share sessions, cookies, or correlate you through browser fingerprinting.

## What it does

- **Automatic per-site containers** — each domain gets its own container on first visit, no configuration needed
- **Unique fingerprints per container** — every container presents a completely different device to websites
- **Auth-aware** — login redirects (e.g. YouTube to Google) stay in the originating container so authentication works seamlessly
- **Cross-site navigation** — clicking a link to a different domain automatically switches to the correct container
- **HTTP header spoofing** — User-Agent, Accept-Language, and Client Hints headers match each container's identity
- **Configurable** — toggle individual fingerprint vectors, whitelist domains, manage containers from the options page
- **Auto-prune** — automatically remove inactive containers after configurable days
- **Import/export** — backup and restore all settings, seeds, and whitelist
- **Zero configuration** — install and browse, everything is automatic

## Fingerprint vectors protected

| Vector | Method |
|---|---|
| Canvas | Deterministic pixel noise per container seed |
| WebGL | Spoofed GPU vendor, renderer, max parameters, and normalized extensions |
| AudioContext | Seeded noise on frequency and channel data |
| Navigator | CPU cores, platform, languages, device memory, oscpu |
| Screen | Resolution, color depth, window dimensions |
| Timezone | getTimezoneOffset, Date.toString, Intl.DateTimeFormat |
| WebRTC | Forced relay-only ICE policy (blocks local IP leak) |
| Fonts | Noise on measureText (prevents font enumeration) |
| Font API | document.fonts.check() returns uniform response |
| ClientRects | Sub-pixel noise on getBoundingClientRect |
| Plugins | Reports empty |
| Battery | Always reports full/charging |
| Connection | Fixed network profile |
| HTTP Headers | User-Agent, Accept-Language spoofed per container; Client Hints stripped |
| Speech Synthesis | getVoices() returns empty, voiceschanged suppressed |
| matchMedia | Screen dimension queries return spoofed values |
| Performance | performance.now() precision reduced to 0.1ms |
| Storage | navigator.storage.estimate() returns generic values |
| Gamepad | navigator.getGamepads() returns empty |
| WebGL readPixels | Seeded noise on framebuffer reads |

## How it works

1. You visit `youtube.com` in a normal tab
2. ContainSite creates a `youtube.com` container and reopens the tab in it
3. A deterministic fingerprint is generated from a random seed and injected via `exportFunction()` before any page scripts run
4. You visit `gmail.com` — gets its own container with a different fingerprint
5. YouTube and Gmail cannot share cookies, sessions, or device identity

When YouTube redirects you to `accounts.google.com` for login, the redirect stays in YouTube's container. Gmail has its own separate Google login in its own container. Same authentication flow, fully isolated identities.

## Architecture

```
Background Script
  ├── Auto-creates containers per domain (contextualIdentities API)
  ├── Generates deterministic fingerprint from seed (Mulberry32 PRNG)
  ├── Registers per-container content scripts (contentScripts.register + cookieStoreId)
  ├── Intercepts navigation to assign tabs to containers
  └── Spoofs HTTP headers (User-Agent, Accept-Language, Client Hints) per container

Content Script (per container, ISOLATED world, document_start)
  └── Uses exportFunction() + wrappedJSObject to override page APIs
      ├── Canvas, WebGL, AudioContext prototypes
      ├── Navigator, Screen, Performance properties
      ├── Timezone (Date, Intl.DateTimeFormat)
      ├── WebRTC (RTCPeerConnection)
      ├── Font metrics (measureText, DOM dimensions, document.fonts)
      ├── ClientRects, Battery, Connection, Storage
      ├── Speech synthesis, matchMedia
      └── Plugins, mimeTypes
```

Uses Firefox's `exportFunction()` API to inject overrides from the isolated content script world directly into the page context. This bypasses Content Security Policy restrictions that block inline script injection.

## Install

### From file

1. Download the latest `.xpi` from [Releases](../../releases)
2. In Firefox/LibreWolf: `about:addons` → gear icon → "Install Add-on From File..."
3. Select the `.xpi` file

For unsigned installs, set `xpinstall.signatures.required` to `false` in `about:config` (LibreWolf has this off by default).

### From source

1. Clone the repo
2. Go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Select `manifest.json`

## Popup UI

Click the ContainSite toolbar icon to see all active containers. From there you can:

- **Toggle** fingerprint spoofing on/off per container
- **Regenerate** a container's fingerprint (creates a new device identity)
- **Prune Unused** — remove containers with no open tabs
- **Reset All** — clear all containers and data

## Options Page

Right-click the toolbar icon → **Manage Extension** → **Preferences** to open the full options page.

### Fingerprint Vectors

Toggle individual spoofing vectors on or off globally. Vectors can be independently controlled:

Canvas, WebGL, Audio, Navigator, Screen, Timezone, WebRTC, Fonts, Client Rects, Plugins, Battery, Connection

### Domain Whitelist

Add domains that should never be containerized or fingerprint-spoofed. Useful for internal sites, local services, or sites that break with container isolation.

### Container Management

Full table of all managed containers with per-container controls:

- **Toggle** spoofing on/off
- **Regenerate** fingerprint
- **Delete** container (removes all cookies and data for that site)

## Requirements

- Firefox 100+ or LibreWolf
- Containers must be enabled (`privacy.userContext.enabled = true` in `about:config`)

### Recommended about:config settings

For maximum WebRTC leak protection, set these in `about:config`:

| Setting | Value | Purpose |
|---|---|---|
| `media.peerconnection.ice.default_address_only` | `true` | Only use default route for ICE |
| `media.peerconnection.ice.no_host` | `true` | Prevent host candidate gathering |
| `media.peerconnection.ice.proxy_only_if_behind_proxy` | `true` | Force proxy-only mode |

LibreWolf may already have some of these set by default.

## Testing

A built-in test page is included at `test/fingerprint-test.html`. To use it:

1. Load the extension via `about:debugging`
2. Add a hostname alias (e.g. `127.0.0.1 containsite-test.site` in `/etc/hosts`) — localhost is excluded from containerization
3. Start a local server: `python3 -m http.server 8888 --bind 0.0.0.0`
4. Open `http://containsite-test.site:8888/test/fingerprint-test.html` in a regular (non-private) window
5. Open the same URL in a different container tab and compare composite hashes

## File structure

```
manifest.json          MV2 extension manifest
background.js          Container management, navigation, HTTP header spoofing
inject.js              Fingerprint overrides (exportFunction-based, 20 vectors)
lib/
  prng.js              Mulberry32 seeded PRNG
  fingerprint-gen.js   Deterministic seed → device profile generator
popup/
  popup.html           Container list UI
  popup.css            Styles
  popup.js             Toggle, regenerate, prune, reset controls
options/
  options.html         Full options page (opens in tab)
  options.css          Styles
  options.js           Vector toggles, whitelist, container management
test/
  fingerprint-test.html  Comprehensive fingerprint verification page
icons/
  icon-48.png          Toolbar icon
  icon-96.png          Extension icon
```

## Build

No build tools required. The extension is plain JavaScript with no dependencies.

To package as `.xpi`:

```sh
zip -r ContainSite.xpi manifest.json background.js inject.js lib/ popup/ options/ icons/icon-48.png icons/icon-96.png
```

## License

[GPL-3.0](LICENSE)

# ContainSite

Per-site container isolation with unique device fingerprints for Firefox and LibreWolf.

Every website you visit is automatically placed in its own isolated container with a unique, deterministic device identity. Sites cannot share sessions, cookies, or correlate you through browser fingerprinting.

## What it does

- **Automatic per-site containers** — each domain gets its own container on first visit, no configuration needed
- **Unique fingerprints per container** — every container presents a completely different device to websites
- **Auth-aware** — login redirects (e.g. YouTube to Google) stay in the originating container so authentication works seamlessly
- **Zero configuration** — install and browse, everything is automatic

## Fingerprint vectors protected

| Vector | Method |
|---|---|
| Canvas | Deterministic pixel noise per container seed |
| WebGL | Spoofed GPU vendor and renderer strings |
| AudioContext | Seeded noise on frequency and channel data |
| Navigator | CPU cores, platform, languages, device memory |
| Screen | Resolution, color depth, window dimensions |
| Timezone | getTimezoneOffset, Date.toString, Intl.DateTimeFormat |
| WebRTC | Forced relay-only ICE policy (blocks local IP leak) |
| Fonts | Noise on measureText (prevents font enumeration) |
| ClientRects | Sub-pixel noise on getBoundingClientRect |
| Plugins | Reports empty |
| Battery | Always reports full/charging |
| Connection | Fixed network profile |

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
  └── Intercepts navigation to assign tabs to containers

Content Script (per container, ISOLATED world, document_start)
  └── Uses exportFunction() + wrappedJSObject to override page APIs
      ├── Canvas, WebGL, AudioContext prototypes
      ├── Navigator, Screen properties
      ├── Timezone (Date, Intl.DateTimeFormat)
      ├── WebRTC (RTCPeerConnection)
      └── Font metrics, ClientRects, Battery, Connection
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

## Requirements

- Firefox 100+ or LibreWolf
- Containers must be enabled (`privacy.userContext.enabled = true` in `about:config`)

## File structure

```
manifest.json          MV2 extension manifest
background.js          Container management, navigation interception, script registration
inject.js              Fingerprint overrides (exportFunction-based)
lib/
  prng.js              Mulberry32 seeded PRNG
  fingerprint-gen.js   Deterministic seed → device profile generator
popup/
  popup.html           Container list UI
  popup.css            Styles
  popup.js             Toggle, regenerate, prune, reset controls
icons/
  icon-48.png          Toolbar icon
  icon-96.png          Extension icon
```

## Build

No build tools required. The extension is plain JavaScript with no dependencies.

To package as `.xpi`:

```sh
zip -r ContainSite.xpi manifest.json background.js inject.js lib/ popup/ icons/icon-48.png icons/icon-96.png
```

## License

[GPL-3.0](LICENSE)

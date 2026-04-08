# ContainSite

Per-site container isolation with unique device fingerprints for Firefox.

## What it does

Every website you visit is automatically placed in its own Firefox container with a unique, deterministic device fingerprint. Each container presents a completely different device identity to websites — a different User-Agent, canvas fingerprint, WebGL renderer, screen resolution, timezone, language, and more. Sites cannot share cookies, sessions, or correlate you through browser fingerprinting across domains.

The fingerprint for each container is generated from a random seed using a deterministic PRNG (Mulberry32). The same seed always produces the same device profile, so your identity within a site stays consistent across sessions while remaining completely different from every other site.

## Key features

- **Automatic container creation** — each domain gets its own container on first visit, no configuration needed
- **Per-container fingerprint generation** — deterministic from a random seed; coherent device profiles (platform, GPU, resolution, and User-Agent all match)
- **HTTP header spoofing** — User-Agent, Accept-Language, and Client Hints headers are modified per container to match the JS-side fingerprint
- **CSP-safe fingerprint injection** — content scripts use Firefox's `exportFunction()` and `wrappedJSObject` APIs to override page-context APIs from the isolated content script world, bypassing Content Security Policy restrictions
- **Auth provider bypass** — login redirects to Google (accounts.google.com, accounts.youtube.com) stay in the originating container so authentication works seamlessly
- **Preserve original tab** — cross-domain link clicks open the target in a new container tab while keeping the original tab intact
- **Domain whitelist** — exclude specific domains from containerization and fingerprint spoofing
- **Cloudflare-safe mode** — per-container shield toggle that reduces spoofing to only vectors that don't create detectable inconsistencies with Cloudflare's bot detection, keeping canvas/audio/fonts/timezone/WebRTC spoofing active while using real UA/platform/WebGL/screen values
- **Per-container vector overrides** — enable or disable specific spoofing vectors on a per-container basis, with global defaults
- **Global and per-container settings** — global vector toggles in the options page, per-container overrides via the popup gear icon
- **Auto-prune inactive containers** — automatically remove containers with no open tabs after a configurable number of days
- **Import/export settings** — backup and restore all seeds, vector settings, whitelist, and container mappings as JSON
- **Container management** — regenerate fingerprints, delete individual containers, prune unused containers, or reset everything

## Fingerprint vectors

| Vector | Method |
|---|---|
| Canvas | Deterministic pixel noise on `toDataURL`, `toBlob`, `getImageData` |
| WebGL | Spoofed GPU vendor/renderer, normalized max parameters, baseline extension set |
| WebGL readPixels | Seeded pixel noise on framebuffer reads |
| AudioContext | Seeded noise on `getFloatFrequencyData`, `getByteFrequencyData`, `getChannelData` |
| Navigator | CPU cores, platform, languages, device memory, User-Agent, appVersion, oscpu |
| Screen | Resolution, color depth, window dimensions (`outerWidth/Height`, `innerWidth/Height`) |
| Timezone | `getTimezoneOffset`, `Date.toString`, `Date.toTimeString`, `Intl.DateTimeFormat.resolvedOptions` |
| WebRTC | Host candidate filtering in SDP (strips local IP addresses) |
| Fonts | Noise on `measureText` width; `document.fonts.check()` returns uniform `true` |
| ClientRects | Sub-pixel noise on `getBoundingClientRect` and `getClientRects` |
| Plugins | `navigator.plugins` and `navigator.mimeTypes` report empty |
| Battery | `navigator.getBattery()` always reports full/charging |
| Connection | `navigator.connection` returns fixed network profile (4g, 10 Mbps, 50ms RTT) |
| HTTP Headers | User-Agent, Accept-Language spoofed per container; Client Hints (Sec-CH-UA, Sec-CH-UA-Platform) stripped or overridden |
| Speech Synthesis | `speechSynthesis.getVoices()` returns empty; `onvoiceschanged` suppressed |
| matchMedia | Screen dimension media queries return results consistent with spoofed screen size |
| Performance | `performance.now()` precision reduced to 0.1ms |
| Storage | `navigator.storage.estimate()` returns generic values (2 GB quota, 0 usage) |
| Gamepad | `navigator.getGamepads()` returns empty array |

## Cloudflare-safe mode

Cloudflare and similar bot-detection services cross-reference browser fingerprint data against external signals — TLS ClientHello fingerprints, GPU hardware databases, and network timing. When JavaScript-spoofed values contradict these external signals, the mismatch itself becomes a detection vector. Cloudflare-safe mode solves this by disabling the spoofing vectors that create detectable inconsistencies while keeping the ones that have no external cross-reference.

### Vectors disabled in Cloudflare-safe mode

These vectors are turned off because their spoofed values can be compared against out-of-band data:

| Vector | Why it's disabled |
|---|---|
| User-Agent / platform / appVersion | TLS ClientHello fingerprint identifies the real browser; a mismatched UA string is an immediate red flag |
| WebGL vendor / renderer | GPU strings can be validated against known hardware databases and driver capabilities |
| Screen resolution | Window dimensions and CSS media queries can be cross-checked with reported screen size |
| Plugins | Modern browsers report empty plugins natively; spoofing them is unnecessary and anomalous |
| Connection (NetworkInformation) | Timing-based checks can infer real connection characteristics, contradicting spoofed values |
| Hardware concurrency / device memory | Can be inferred from timing side-channels and correlated with TLS-identified platform |

### Vectors that stay active

These vectors add noise that cannot be cross-referenced against external signals:

| Vector | Why it's safe |
|---|---|
| Canvas | Pixel-level noise has no external reference point; every GPU renders slightly differently |
| AudioContext | Frequency/channel data noise is undetectable without a known-good baseline |
| Fonts (measureText) | Text measurement noise cannot be validated externally |
| ClientRects | Sub-pixel element positioning has no external cross-reference |
| Timezone | Selected from real IANA timezones; no TLS or hardware signal reveals the real one |
| Languages | Spoofed consistently between JS and Accept-Language header; no external contradiction |
| WebRTC | Host candidate filtering (IP stripping) is indistinguishable from browser privacy settings |
| Battery | Always reports full/charging; matches the majority of devices |
| Speech synthesis | Empty voice list is normal for many configurations |
| Performance | Reduced timer precision matches Firefox's built-in fingerprinting protection |
| Storage | Generic quota values are indistinguishable from real responses |
| Gamepad | Empty gamepad list is the norm for most users |

### HTTP headers

In Cloudflare-safe mode, HTTP header spoofing for User-Agent and Sec-CH-UA headers is also skipped — real browser headers are sent so they match the TLS fingerprint. Accept-Language spoofing continues because the spoofed languages are consistent with the JS-side `navigator.languages` value and have no external contradiction.

### How to enable

- **Per container:** Click the shield icon next to any container in the popup to toggle Cloudflare-safe mode on or off for that site.
- **Bulk toggle:** On the options page, the Cloudflare-Safe Mode section has buttons to enable or disable the mode for all containers at once.

## How it works

1. You visit `youtube.com` in a normal tab
2. ContainSite intercepts the navigation, creates a `youtube.com` container, and reopens the tab in it
3. A deterministic fingerprint profile is generated from a random seed and registered as a content script for that container
4. The content script runs at `document_start` and uses `exportFunction()` to override page APIs before any site scripts execute
5. HTTP headers (User-Agent, Accept-Language) are modified in `onBeforeSendHeaders` to match the container's JS-side identity
6. You visit `gmail.com` — it gets its own container with a completely different fingerprint
7. YouTube and Gmail cannot share cookies, sessions, or device identity

When YouTube redirects to `accounts.google.com` for login, the redirect stays in YouTube's container. Gmail has its own separate Google login in its own container.

## Architecture

```
Background Script (background.js)
  |- Intercepts main_frame navigations (webRequest.onBeforeRequest)
  |- Creates containers per domain (contextualIdentities API)
  |- Generates deterministic profiles from seed (Mulberry32 PRNG)
  |- Registers per-container content scripts (contentScripts.register + cookieStoreId filter)
  |- Spoofs HTTP headers per container (webRequest.onBeforeSendHeaders)
  |- Manages container lifecycle, domain mapping, auto-prune
  '- Handles messages from popup and options page

Content Script (inject.js, per container, ISOLATED world, document_start)
  '- Uses exportFunction() + wrappedJSObject to override page APIs
      |- Canvas (toDataURL, toBlob, getImageData)
      |- WebGL (getParameter, getSupportedExtensions, readPixels)
      |- AudioContext (frequency data, channel data)
      |- Navigator (properties, languages, plugins, battery, connection, gamepad, storage)
      |- Screen (dimensions, color depth, window size)
      |- Timezone (Date methods, Intl.DateTimeFormat)
      |- WebRTC (SDP host candidate filtering)
      |- Fonts (measureText noise, document.fonts.check)
      |- ClientRects (getBoundingClientRect, getClientRects)
      |- Speech synthesis (getVoices, onvoiceschanged)
      |- matchMedia (screen dimension queries)
      '- Performance (performance.now precision)

Fingerprint Generator (lib/fingerprint-gen.js)
  '- Seed -> coherent device profile (archetype-based: Windows, Linux, macOS)
      |- Platform, User-Agent, appVersion, oscpu
      |- GPU vendor + renderer (matching platform)
      |- Screen resolution, color depth
      |- CPU cores, device memory
      |- Languages, timezone
      '- Sub-seeds for canvas, audio, font, and rect noise

PRNG (lib/prng.js)
  '- Mulberry32: fast, deterministic 32-bit PRNG
```

## Installation

### From source (development)

1. Clone the repository
2. Open `about:debugging#/runtime/this-firefox` in Firefox
3. Click **Load Temporary Add-on...**
4. Select `manifest.json` from the cloned directory

### From .xpi file

1. Download the latest `.xpi` from [Releases](../../releases)
2. In Firefox/LibreWolf: `about:addons` → gear icon → **Install Add-on From File...**
3. Select the `.xpi` file

For unsigned installs, set `xpinstall.signatures.required` to `false` in `about:config` (LibreWolf has this disabled by default).

### Packaging

No build tools required. The extension is plain JavaScript with no dependencies.

```sh
zip -r ContainSite.xpi manifest.json background.js inject.js lib/ popup/ options/ icons/icon-48.png icons/icon-96.png
```

## Permissions

| Permission | Why it's needed |
|---|---|
| `contextualIdentities` | Create, query, and remove Firefox containers |
| `cookies` | Required alongside `contextualIdentities` to access container cookie stores |
| `storage` | Persist domain-to-container mappings, fingerprint seeds, settings, and whitelist |
| `tabs` | Open tabs in specific containers, detect active containers for pruning, preserve original tabs on cross-domain navigation |
| `webRequest` | Intercept navigations to route them into the correct container |
| `webRequestBlocking` | Synchronously cancel and redirect navigations before they complete; modify HTTP headers before they are sent |
| `<all_urls>` | Apply container routing and header spoofing to all websites |

## Configuration

### Popup

Click the ContainSite toolbar icon to see all managed containers. From there you can:

- **Search** containers by name or domain
- **Toggle** fingerprint spoofing on/off per container
- **Shield icon** — toggle Cloudflare-safe mode per container (reduces spoofing to avoid bot detection)
- **Gear icon** — open per-container vector settings to override global defaults for individual sites (vectors locked by Cloudflare-safe mode are shown as disabled)
- **New** — regenerate a container's fingerprint seed (creates a new device identity)
- **Delete** — remove a container and all its data
- **Regenerate All** — generate new fingerprints for every container
- **Prune Unused** — remove containers with no open tabs
- **Reset All** — delete all containers, seeds, and settings

### Options page

Right-click the toolbar icon → **Manage Extension** → **Preferences**, or navigate to the extension's preferences in `about:addons`.

- **Fingerprint Vectors** — toggle individual spoofing vectors on/off globally (Canvas, WebGL, Audio, Navigator, Screen, Timezone, WebRTC, Fonts, Client Rects, Plugins, Battery, Connection)
- **Cloudflare-Safe Mode** — explanation of what the mode does, with bulk enable/disable buttons for all containers
- **Domain Whitelist** — add domains that should never be containerized or fingerprint-spoofed
- **Containers** — table of all managed containers with per-container toggle, regenerate, and delete
- **Auto-Prune** — enable automatic removal of inactive containers after a configurable number of days (1-365)
- **Import/Export** — backup all settings to a JSON file or restore from a previous backup
- **Bulk Actions** — regenerate all fingerprints, prune unused containers, or reset everything

## Privacy

ContainSite collects **zero data**. It runs entirely locally in your browser with no telemetry, no analytics, no external connections, and no third-party dependencies. All settings and fingerprint seeds are stored in the browser's local extension storage.

## Compatibility

- **Firefox 100+** (Manifest V2)
- **LibreWolf** (fully compatible; unsigned install support out of the box)
- Requires containers to be enabled: `privacy.userContext.enabled = true` in `about:config`

### Recommended about:config settings

For maximum WebRTC leak protection, set these in `about:config`:

| Setting | Value | Purpose |
|---|---|---|
| `media.peerconnection.ice.default_address_only` | `true` | Only use default route for ICE |
| `media.peerconnection.ice.no_host` | `true` | Prevent host candidate gathering |
| `media.peerconnection.ice.proxy_only_if_behind_proxy` | `true` | Force proxy-only mode |

LibreWolf may already have some of these set by default.

## Testing

A test page is included at `test/fingerprint-test.html`:

1. Load the extension via `about:debugging`
2. Add a hostname alias (e.g. `127.0.0.1 containsite-test.site` in `/etc/hosts`) — localhost is excluded from containerization
3. Start a local server: `python3 -m http.server 8888 --bind 0.0.0.0`
4. Open `http://containsite-test.site:8888/test/fingerprint-test.html` in a regular window
5. Open the same URL in a different container tab and compare composite hashes

## File structure

```
manifest.json          MV2 extension manifest
background.js          Container lifecycle, navigation interception, HTTP header spoofing
inject.js              Fingerprint overrides (exportFunction-based, 20+ vectors)
lib/
  prng.js              Mulberry32 seeded PRNG
  fingerprint-gen.js   Deterministic seed -> coherent device profile generator
popup/
  popup.html           Container list popup
  popup.css            Popup styles
  popup.js             Toggle, regenerate, delete, prune, reset, per-container vectors
options/
  options.html         Full options page (opens in tab)
  options.css          Options styles
  options.js           Vector toggles, whitelist, containers, auto-prune, import/export
test/
  fingerprint-test.html  Fingerprint verification page
icons/
  icon-48.png          Toolbar icon
  icon-96.png          Extension icon
```

## License

[GPL-3.0](LICENSE)

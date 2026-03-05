# Changelog

## 0.5.3

- Fixed Discord and other complex apps crashing due to cross-compartment constructor failures
- Replaced Intl.DateTimeFormat constructor override with safe resolvedOptions-only approach
- Replaced RTCPeerConnection constructor override with SDP-level host candidate filtering
- Added per-container vector settings (gear icon in popup to toggle vectors per site)
- Added delete button per container in popup (x icon)
- Fixed Reset All not removing orphaned containers from previous installs
- Popup now only shows ContainSite-managed containers
- Delete container now fully cleans up domainMap, seeds, scripts, and profiles

## 0.5.2

- Fixed Discord crash caused by Intl.DateTimeFormat cross-compartment constructor failure
- Fixed Connection API override missing addEventListener (could crash real-time apps)

## 0.5.1

- Fixed Discord and other complex web apps crashing due to DOM dimension noise
- Removed offsetWidth/Height noise (too aggressive, broke layout calculations)
- Changed document.fonts.check() to return true instead of false (prevents font loading hangs)
- Added search bar to popup for filtering containers

## 0.5.0

- Gamepad API spoofing (returns empty, prevents controller fingerprinting)
- WebGL readPixels noise (seeded pixel noise on framebuffer reads)
- Auto-prune: automatically remove inactive containers after configurable days
- Import/export all settings (seeds, whitelist, vector config) from options page
- Active container count badge on toolbar icon
- Updated test page with new vector sections

## 0.4.1

- Skip all fingerprint overrides on Google auth domains to fix login rejection
- Keep auth redirects in originating container for session isolation
- Skip User-Agent spoofing on accounts.google.com and accounts.youtube.com

## 0.4.0

- Added 6 new fingerprint vectors: Font API (document.fonts), DOM element dimensions, HTTP header spoofing (User-Agent, Accept-Language, Client Hints), Speech Synthesis, Performance Timing, Storage Estimate
- WebGL parameter normalization (MAX_TEXTURE_SIZE, MAX_VERTEX_ATTRIBS, etc.)
- Font enumeration hardening via offsetWidth/Height noise
- Total spoofed vectors: 18

## 0.3.0

- HTTP header spoofing: User-Agent and Accept-Language modified per container
- Client Hints header stripping (Sec-CH-UA, Sec-CH-UA-Platform)
- Speech synthesis protection (getVoices returns empty)
- matchMedia screen dimension override
- Performance.now() precision reduction
- navigator.storage.estimate() spoofing

## 0.2.0

- Coherent device profiles with 3 archetypes (Windows, Linux, macOS)
- User-Agent spoofing with matching platform, oscpu, appVersion
- Added data_collection_permissions for AMO submission

## 0.1.0

- Initial release
- Per-site container isolation with automatic domain detection
- 12 fingerprint vectors: Canvas, WebGL, Audio, Navigator, Screen, Timezone, WebRTC, Fonts, ClientRects, Plugins, Battery, Connection
- Popup UI with per-container toggle, regenerate, prune, reset
- Options page with vector toggles, domain whitelist, container management

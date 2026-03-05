// ContainSite — Background Script
// Every site gets its own container. Auth redirects stay in the originating container.

const registeredScripts = {}; // cookieStoreId -> RegisteredContentScript
const containerProfiles = {}; // cookieStoreId -> { userAgent, languages } for HTTP header spoofing
let injectSourceCache = null;
let domainMap = {};   // baseDomain -> cookieStoreId
let pendingTabs = {}; // tabId -> true (tabs being redirected)
let cachedWhitelist = []; // domains that bypass containerization

const CONTAINER_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
const CONTAINER_ICONS = ["fingerprint", "fence", "briefcase", "cart", "circle", "gift", "tree", "chill"];

// All container IDs we've created — used for ownership checks on cross-domain navigation
const managedContainerIds = new Set();

// --- Domain Extraction ---

function extractDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Skip localhost and local IPs
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return null;
    return h;
  } catch(e) {
    return null;
  }
}

function getBaseDomain(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;

  const twoPartTLDs = ["co.uk", "co.jp", "co.kr", "com.au", "com.br", "co.nz", "co.in", "org.uk", "net.au"];
  const lastTwo = parts.slice(-2).join(".");
  if (twoPartTLDs.includes(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

// --- Seed Management ---

function generateSeed() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0];
}

// --- Inject Source Loading ---

async function getInjectSource() {
  if (!injectSourceCache) {
    const resp = await fetch(browser.runtime.getURL("inject.js"));
    injectSourceCache = await resp.text();
  }
  return injectSourceCache;
}

// --- Per-Container Script Registration ---

async function registerForContainer(cookieStoreId, profile) {
  if (registeredScripts[cookieStoreId]) {
    try { await registeredScripts[cookieStoreId].unregister(); } catch(e) {}
    delete registeredScripts[cookieStoreId];
  }

  const injectSource = await getInjectSource();

  // Set config then run inject.js — both execute in ISOLATED world
  // inject.js uses exportFunction/wrappedJSObject to modify page context (bypasses CSP)
  const configCode = `window.__csConfig = ${JSON.stringify(profile)};`;

  registeredScripts[cookieStoreId] = await browser.contentScripts.register({
    matches: ["<all_urls>"],
    js: [{ code: configCode }, { code: injectSource }],
    runAt: "document_start",
    allFrames: true,
    cookieStoreId: cookieStoreId
  });
}

async function buildProfileAndRegister(cookieStoreId, seed) {
  const profile = generateFingerprintProfile(seed);
  const stored = await browser.storage.local.get(["vectorSettings", "containerSettings"]);
  const globalVectors = stored.vectorSettings || {};
  const containerSettings = stored.containerSettings || {};
  const containerVectors = containerSettings[cookieStoreId]?.vectors || {};

  // Merge: per-container overrides take precedence over global settings
  profile.vectors = { ...globalVectors };
  for (const [key, val] of Object.entries(containerVectors)) {
    if (val !== null) profile.vectors[key] = val;
  }

  // Cache profile for HTTP header spoofing
  containerProfiles[cookieStoreId] = {
    userAgent: profile.nav.userAgent,
    languages: profile.nav.languages,
    platform: profile.nav.platform
  };

  await registerForContainer(cookieStoreId, profile);
}

async function registerAllKnownContainers() {
  const stored = await browser.storage.local.get(["containerSeeds", "containerSettings"]);
  const seeds = stored.containerSeeds || {};
  const settings = stored.containerSettings || {};

  for (const [cid, script] of Object.entries(registeredScripts)) {
    try { await script.unregister(); } catch(e) {}
  }
  for (const key of Object.keys(registeredScripts)) {
    delete registeredScripts[key];
  }

  for (const [cookieStoreId, seed] of Object.entries(seeds)) {
    const cfg = settings[cookieStoreId] || { enabled: true };
    if (!cfg.enabled) continue;
    await buildProfileAndRegister(cookieStoreId, seed);
  }
}

// --- Storage ---

async function loadDomainMap() {
  const stored = await browser.storage.local.get("domainMap");
  domainMap = stored.domainMap || {};
}

async function saveDomainMap() {
  await browser.storage.local.set({ domainMap });
}

// --- Auto-Containment ---

async function getOrCreateContainerForDomain(baseDomain) {
  if (domainMap[baseDomain]) {
    return domainMap[baseDomain];
  }

  const colorIndex = Object.keys(domainMap).length % CONTAINER_COLORS.length;
  const iconIndex = Object.keys(domainMap).length % CONTAINER_ICONS.length;

  const container = await browser.contextualIdentities.create({
    name: baseDomain,
    color: CONTAINER_COLORS[colorIndex],
    icon: CONTAINER_ICONS[iconIndex]
  });

  const cookieStoreId = container.cookieStoreId;
  domainMap[baseDomain] = cookieStoreId;
  managedContainerIds.add(cookieStoreId);
  await saveDomainMap();

  const stored = await browser.storage.local.get("containerSeeds");
  const seeds = stored.containerSeeds || {};
  seeds[cookieStoreId] = generateSeed();
  await browser.storage.local.set({ containerSeeds: seeds });

  await buildProfileAndRegister(cookieStoreId, seeds[cookieStoreId]);
  await updateBadge();

  return cookieStoreId;
}

// tabId -> baseDomain — tabs we just created, skip only for the same domain
const createdByUs = {};

// Handle a tab that needs to be in a container for a given domain
async function assignTabToContainer(tabId, url, baseDomain) {
  // Skip tabs we just created — but only for the domain we created them for
  if (createdByUs[tabId] === baseDomain) return;
  // Skip whitelisted domains
  if (cachedWhitelist.includes(baseDomain)) return;
  if (pendingTabs[tabId]) return;
  pendingTabs[tabId] = true;

  try {
    const tab = await browser.tabs.get(tabId);
    const cookieStoreId = await getOrCreateContainerForDomain(baseDomain);

    if (tab.cookieStoreId === cookieStoreId) {
      // Already in the correct container
      delete pendingTabs[tabId];
      return;
    }

    if (tab.cookieStoreId !== "firefox-default") {
      // Tab is in a non-default container — only reassign if it's one we manage
      if (!managedContainerIds.has(tab.cookieStoreId)) {
        // Not a ContainSite-managed container — leave it alone
        delete pendingTabs[tabId];
        return;
      }
      // Tab is in our container navigating to a different domain.
      // If target is an auth provider, keep in current container so auth
      // cookies stay isolated (e.g. YouTube login via accounts.google.com
      // stays in the youtube.com container, not the google.com container)
      const hostname = extractDomain(url);
      if (hostname && AUTH_BYPASS_DOMAINS.includes(hostname)) {
        delete pendingTabs[tabId];
        return;
      }
      // Otherwise reassign to correct container
    }

    const newTab = await browser.tabs.create({
      url: url,
      cookieStoreId: cookieStoreId,
      index: tab.index + 1,
      active: tab.active
    });
    // Mark the new tab — only skip reassignment for this same domain
    createdByUs[newTab.id] = baseDomain;
    setTimeout(() => { delete createdByUs[newTab.id]; }, 5000);

    await browser.tabs.remove(tabId);
  } catch(e) {}
  delete pendingTabs[tabId];
}

// Intercept new navigations
browser.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (details.type !== "main_frame") return {};
    if (details.tabId === -1) return {};

    const domain = extractDomain(details.url);
    if (!domain) return {};

    const baseDomain = getBaseDomain(domain);

    // Trigger async container assignment
    assignTabToContainer(details.tabId, details.url, baseDomain);
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// Handle in-tab navigations (address bar, link clicks)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (pendingTabs[tabId]) return;

  const domain = extractDomain(changeInfo.url);
  if (!domain) return;

  const baseDomain = getBaseDomain(domain);
  await assignTabToContainer(tabId, changeInfo.url, baseDomain);
});

// Clean up tab tracking when tabs close
browser.tabs.onRemoved.addListener((tabId) => {
  delete pendingTabs[tabId];
});

// --- Badge: show active container count ---

async function updateBadge() {
  const count = Object.keys(domainMap).length;
  browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#4a9eff" });
}

// --- Message Handling (from popup and options page) ---

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "getContainerList") return handleGetContainerList();
  if (message.type === "toggleContainer") return handleToggle(message.cookieStoreId, message.enabled);
  if (message.type === "regenerateFingerprint") return handleRegenerate(message.cookieStoreId);
  if (message.type === "regenerateAll") return handleRegenerateAll();
  if (message.type === "resetAll") return handleResetAll();
  if (message.type === "pruneContainers") return handlePruneContainers();
  if (message.type === "deleteContainer") return handleDeleteContainer(message.cookieStoreId);
  if (message.type === "getWhitelist") return handleGetWhitelist();
  if (message.type === "setWhitelist") return handleSetWhitelist(message.whitelist);
  if (message.type === "getVectorSettings") return handleGetVectorSettings();
  if (message.type === "setVectorSettings") return handleSetVectorSettings(message.vectorSettings);
  if (message.type === "exportSettings") return handleExportSettings();
  if (message.type === "importSettings") return handleImportSettings(message.data);
  if (message.type === "getAutoPruneSettings") return handleGetAutoPruneSettings();
  if (message.type === "setAutoPruneSettings") return handleSetAutoPruneSettings(message.settings);
  if (message.type === "getContainerVectors") return handleGetContainerVectors(message.cookieStoreId);
  if (message.type === "setContainerVectors") return handleSetContainerVectors(message.cookieStoreId, message.vectors);
});

async function handleGetContainerList() {
  const containers = await browser.contextualIdentities.query({});
  const stored = await browser.storage.local.get(["containerSeeds", "containerSettings"]);
  const seeds = stored.containerSeeds || {};
  const settings = stored.containerSettings || {};

  const reverseDomainMap = {};
  for (const [domain, cid] of Object.entries(domainMap)) {
    reverseDomainMap[cid] = domain;
  }

  // Only show containers we manage (in domainMap or have a seed)
  const ourContainerIds = new Set([
    ...Object.values(domainMap),
    ...Object.keys(seeds)
  ]);

  return containers
    .filter(c => ourContainerIds.has(c.cookieStoreId))
    .map(c => ({
      name: c.name,
      cookieStoreId: c.cookieStoreId,
      color: c.color,
      icon: c.icon,
      domain: reverseDomainMap[c.cookieStoreId] || null,
      enabled: (settings[c.cookieStoreId]?.enabled !== false),
      hasSeed: !!seeds[c.cookieStoreId]
    }));
}

async function handleToggle(cookieStoreId, enabled) {
  const stored = await browser.storage.local.get("containerSettings");
  const settings = stored.containerSettings || {};
  settings[cookieStoreId] = { ...settings[cookieStoreId], enabled };
  await browser.storage.local.set({ containerSettings: settings });

  if (!enabled) {
    if (registeredScripts[cookieStoreId]) {
      try { await registeredScripts[cookieStoreId].unregister(); } catch(e) {}
      delete registeredScripts[cookieStoreId];
    }
  } else {
    const seedStored = await browser.storage.local.get("containerSeeds");
    const seeds = seedStored.containerSeeds || {};
    if (seeds[cookieStoreId]) {
      await buildProfileAndRegister(cookieStoreId, seeds[cookieStoreId]);
    }
  }
  return { ok: true };
}

async function handleRegenerate(cookieStoreId) {
  const stored = await browser.storage.local.get(["containerSeeds", "containerSettings"]);
  const seeds = stored.containerSeeds || {};
  const settings = stored.containerSettings || {};

  seeds[cookieStoreId] = generateSeed();
  await browser.storage.local.set({ containerSeeds: seeds });

  const cfg = settings[cookieStoreId] || { enabled: true };
  if (cfg.enabled) {
    await buildProfileAndRegister(cookieStoreId, seeds[cookieStoreId]);
  }
  return { ok: true };
}

async function handleRegenerateAll() {
  const stored = await browser.storage.local.get("containerSeeds");
  const seeds = stored.containerSeeds || {};

  for (const cid of Object.keys(seeds)) {
    seeds[cid] = generateSeed();
  }
  await browser.storage.local.set({ containerSeeds: seeds });
  await registerAllKnownContainers();
  return { ok: true };
}

async function handleResetAll() {
  // Unregister all content scripts
  for (const [cid, script] of Object.entries(registeredScripts)) {
    try { await script.unregister(); } catch(e) {}
  }
  for (const key of Object.keys(registeredScripts)) {
    delete registeredScripts[key];
  }

  // Collect all container IDs we know about (domainMap + seeds)
  const stored = await browser.storage.local.get("containerSeeds");
  const seeds = stored.containerSeeds || {};
  const ourContainerIds = new Set([
    ...Object.values(domainMap),
    ...Object.keys(seeds),
    ...managedContainerIds
  ]);

  // Remove all containers that are ours OR look like domain-named containers
  // (catches orphans from previous installs/reloads)
  const containers = await browser.contextualIdentities.query({});
  const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  for (const c of containers) {
    if (ourContainerIds.has(c.cookieStoreId) || domainPattern.test(c.name)) {
      try { await browser.contextualIdentities.remove(c.cookieStoreId); } catch(e) {}
    }
  }

  // Clear all storage and caches
  domainMap = {};
  pendingTabs = {};
  cachedWhitelist = [];
  managedContainerIds.clear();
  for (const key of Object.keys(containerProfiles)) delete containerProfiles[key];
  await browser.storage.local.clear();
  await updateBadge();

  return { ok: true };
}

async function handlePruneContainers() {
  // Remove containers that have no open tabs
  const containers = await browser.contextualIdentities.query({});
  const tabs = await browser.tabs.query({});

  // Collect cookieStoreIds that have open tabs
  const activeContainers = new Set(tabs.map(t => t.cookieStoreId));

  let pruned = 0;
  for (const c of containers) {
    if (managedContainerIds.has(c.cookieStoreId) && !activeContainers.has(c.cookieStoreId)) {
      try {
        await browser.contextualIdentities.remove(c.cookieStoreId);
        pruned++;
      } catch(e) {}
    }
  }
  await updateBadge();
  return { pruned };
}

async function handleDeleteContainer(cookieStoreId) {
  // Unregister content script
  if (registeredScripts[cookieStoreId]) {
    try { await registeredScripts[cookieStoreId].unregister(); } catch(e) {}
    delete registeredScripts[cookieStoreId];
  }

  try {
    await browser.contextualIdentities.remove(cookieStoreId);
  } catch(e) {}

  // Clean up domainMap
  for (const [domain, cid] of Object.entries(domainMap)) {
    if (cid === cookieStoreId) {
      delete domainMap[domain];
    }
  }
  await saveDomainMap();

  managedContainerIds.delete(cookieStoreId);
  delete containerProfiles[cookieStoreId];

  const stored = await browser.storage.local.get(["containerSeeds", "containerSettings"]);
  const seeds = stored.containerSeeds || {};
  const settings = stored.containerSettings || {};
  delete seeds[cookieStoreId];
  delete settings[cookieStoreId];
  await browser.storage.local.set({ containerSeeds: seeds, containerSettings: settings });
  await updateBadge();
  return { ok: true };
}

async function handleGetWhitelist() {
  const stored = await browser.storage.local.get("whitelist");
  return stored.whitelist || [];
}

async function handleSetWhitelist(whitelist) {
  cachedWhitelist = whitelist;
  await browser.storage.local.set({ whitelist });
  return { ok: true };
}

async function handleGetVectorSettings() {
  const stored = await browser.storage.local.get("vectorSettings");
  return stored.vectorSettings || {};
}

async function handleSetVectorSettings(vectorSettings) {
  await browser.storage.local.set({ vectorSettings });
  await registerAllKnownContainers();
  return { ok: true };
}

// --- Import/Export ---

async function handleExportSettings() {
  const stored = await browser.storage.local.get(null); // get everything
  return {
    version: browser.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    domainMap,
    containerSeeds: stored.containerSeeds || {},
    containerSettings: stored.containerSettings || {},
    vectorSettings: stored.vectorSettings || {},
    whitelist: stored.whitelist || [],
    autoPrune: stored.autoPrune || { enabled: false, days: 30 }
  };
}

async function handleImportSettings(data) {
  if (!data || !data.containerSeeds) return { ok: false, error: "Invalid data" };
  await browser.storage.local.set({
    containerSeeds: data.containerSeeds,
    containerSettings: data.containerSettings || {},
    vectorSettings: data.vectorSettings || {},
    whitelist: data.whitelist || [],
    autoPrune: data.autoPrune || { enabled: false, days: 30 }
  });
  cachedWhitelist = data.whitelist || [];
  if (data.domainMap) {
    domainMap = data.domainMap;
    await saveDomainMap();
  }
  await registerAllKnownContainers();
  await updateBadge();
  return { ok: true };
}

// --- Auto-Prune ---

async function handleGetAutoPruneSettings() {
  const stored = await browser.storage.local.get("autoPrune");
  return stored.autoPrune || { enabled: false, days: 30 };
}

async function handleSetAutoPruneSettings(settings) {
  await browser.storage.local.set({ autoPrune: settings });
  return { ok: true };
}

async function handleGetContainerVectors(cookieStoreId) {
  const stored = await browser.storage.local.get(["vectorSettings", "containerSettings"]);
  const globalVectors = stored.vectorSettings || {};
  const containerSettings = stored.containerSettings || {};
  const containerVectors = containerSettings[cookieStoreId]?.vectors || {};
  return { global: globalVectors, overrides: containerVectors };
}

async function handleSetContainerVectors(cookieStoreId, vectors) {
  const stored = await browser.storage.local.get(["containerSettings", "containerSeeds"]);
  const settings = stored.containerSettings || {};
  settings[cookieStoreId] = { ...settings[cookieStoreId], vectors };
  await browser.storage.local.set({ containerSettings: settings });

  // Re-register the content script with updated vectors
  const seeds = stored.containerSeeds || {};
  if (seeds[cookieStoreId] && settings[cookieStoreId]?.enabled !== false) {
    await buildProfileAndRegister(cookieStoreId, seeds[cookieStoreId]);
  }
  return { ok: true };
}

async function runAutoPrune() {
  const stored = await browser.storage.local.get("autoPrune");
  const settings = stored.autoPrune || { enabled: false, days: 30 };
  if (!settings.enabled) return;

  const tabs = await browser.tabs.query({});
  const activeContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Track last activity per container
  const actStored = await browser.storage.local.get("containerActivity");
  const activity = actStored.containerActivity || {};
  const now = Date.now();
  const cutoff = now - (settings.days * 24 * 60 * 60 * 1000);

  for (const cid of managedContainerIds) {
    if (activeContainers.has(cid)) {
      activity[cid] = now; // update last active
    } else if (!activity[cid]) {
      activity[cid] = now; // first seen, set to now
    } else if (activity[cid] < cutoff) {
      // Inactive beyond threshold — prune
      try {
        await browser.contextualIdentities.remove(cid);
      } catch(e) {}
    }
  }
  await browser.storage.local.set({ containerActivity: activity });
}

// --- Container Lifecycle ---

browser.contextualIdentities.onRemoved.addListener(async ({ contextualIdentity }) => {
  const cid = contextualIdentity.cookieStoreId;
  managedContainerIds.delete(cid);
  delete containerProfiles[cid];
  if (registeredScripts[cid]) {
    try { await registeredScripts[cid].unregister(); } catch(e) {}
    delete registeredScripts[cid];
  }
  for (const [domain, cookieStoreId] of Object.entries(domainMap)) {
    if (cookieStoreId === cid) {
      delete domainMap[domain];
    }
  }
  await saveDomainMap();
});

// --- HTTP Header Spoofing ---
// Modifies User-Agent and Accept-Language headers to match each container's
// spoofed profile, preventing server-side detection of JS/HTTP header mismatch.

function formatAcceptLanguage(languages) {
  if (!languages || languages.length === 0) return "en-US,en;q=0.5";
  return languages.map((lang, i) => {
    if (i === 0) return lang;
    const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
    return `${lang};q=${q}`;
  }).join(",");
}

// Auth domains where UA spoofing breaks login flows
const AUTH_BYPASS_DOMAINS = ["accounts.google.com", "accounts.youtube.com"];

browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    // cookieStoreId is available in Firefox 77+ webRequest details
    const profile = containerProfiles[details.cookieStoreId];
    if (!profile) return {};

    // Skip UA spoofing on auth domains so login isn't rejected
    try {
      const host = new URL(details.url).hostname;
      if (AUTH_BYPASS_DOMAINS.includes(host)) return {};
    } catch(e) {}

    const headers = details.requestHeaders;
    // Map platform to Client Hints platform name
    const platformMap = {
      "Win32": "Windows", "Linux x86_64": "Linux", "MacIntel": "macOS"
    };
    const chPlatform = platformMap[profile.platform] || "Unknown";

    for (let i = headers.length - 1; i >= 0; i--) {
      const name = headers[i].name.toLowerCase();
      if (name === "user-agent") {
        headers[i].value = profile.userAgent;
      } else if (name === "accept-language") {
        headers[i].value = formatAcceptLanguage(profile.languages);
      } else if (name === "sec-ch-ua" || name === "sec-ch-ua-full-version-list") {
        // Firefox doesn't normally send these, but strip if present
        headers.splice(i, 1);
      } else if (name === "sec-ch-ua-platform") {
        headers[i].value = `"${chPlatform}"`;
      } else if (name === "sec-ch-ua-mobile") {
        headers[i].value = "?0";
      }
    }
    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// --- Init ---

async function init() {
  await loadDomainMap();
  const stored = await browser.storage.local.get(["containerSeeds", "whitelist"]);
  const seeds = stored.containerSeeds || {};
  for (const cid of Object.keys(seeds)) {
    managedContainerIds.add(cid);
  }
  cachedWhitelist = stored.whitelist || [];
  await registerAllKnownContainers();
  await updateBadge();

  // Run auto-prune on startup and every 6 hours
  await runAutoPrune();
  setInterval(runAutoPrune, 6 * 60 * 60 * 1000);
}

init();

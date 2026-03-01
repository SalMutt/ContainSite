// ContainSite — Background Script
// Every site gets its own container. Auth redirects stay in the originating container.

const registeredScripts = {}; // cookieStoreId -> RegisteredContentScript
let injectSourceCache = null;
let domainMap = {};   // baseDomain -> cookieStoreId
let pendingTabs = {}; // tabId -> true (tabs being redirected)
let tabOrigins = {};  // tabId -> cookieStoreId (tracks which container a tab was assigned to)

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
    const profile = generateFingerprintProfile(seed);
    await registerForContainer(cookieStoreId, profile);
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

  const profile = generateFingerprintProfile(seeds[cookieStoreId]);
  await registerForContainer(cookieStoreId, profile);

  return cookieStoreId;
}

// tabId -> baseDomain — tabs we just created, skip only for the same domain
const createdByUs = {};

// Reverse lookup: find what domain a container was created for
function getContainerDomain(cookieStoreId) {
  for (const [domain, cid] of Object.entries(domainMap)) {
    if (cid === cookieStoreId) return domain;
  }
  return null;
}

// Handle a tab that needs to be in a container for a given domain
async function assignTabToContainer(tabId, url, baseDomain) {
  // Skip tabs we just created — but only for the domain we created them for
  if (createdByUs[tabId] === baseDomain) return;
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
      // It's our container but wrong domain — reassign to correct container
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
  delete tabOrigins[tabId];
});

// --- Message Handling (from popup) ---

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "getContainerList") {
    return handleGetContainerList();
  }
  if (message.type === "toggleContainer") {
    return handleToggle(message.cookieStoreId, message.enabled);
  }
  if (message.type === "regenerateFingerprint") {
    return handleRegenerate(message.cookieStoreId);
  }
  if (message.type === "regenerateAll") {
    return handleRegenerateAll();
  }
  if (message.type === "resetAll") {
    return handleResetAll();
  }
  if (message.type === "pruneContainers") {
    return handlePruneContainers();
  }
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

  return containers.map(c => ({
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
      const profile = generateFingerprintProfile(seeds[cookieStoreId]);
      await registerForContainer(cookieStoreId, profile);
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
    const profile = generateFingerprintProfile(seeds[cookieStoreId]);
    await registerForContainer(cookieStoreId, profile);
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

  // Remove all ContainSite-managed containers
  const containers = await browser.contextualIdentities.query({});
  const ourContainerIds = new Set(Object.values(domainMap));
  for (const c of containers) {
    if (ourContainerIds.has(c.cookieStoreId)) {
      try { await browser.contextualIdentities.remove(c.cookieStoreId); } catch(e) {}
    }
  }

  // Clear all storage
  domainMap = {};
  pendingTabs = {};
  tabOrigins = {};
  managedContainerIds.clear();
  await browser.storage.local.clear();

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
      // onRemoved listener handles domainMap + managedContainerIds cleanup
    }
  }
  return { pruned };
}

// --- Container Lifecycle ---

browser.contextualIdentities.onRemoved.addListener(async ({ contextualIdentity }) => {
  const cid = contextualIdentity.cookieStoreId;
  managedContainerIds.delete(cid);
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

// --- Init ---

async function init() {
  await loadDomainMap();
  // Populate managedContainerIds from stored seeds
  const stored = await browser.storage.local.get("containerSeeds");
  const seeds = stored.containerSeeds || {};
  for (const cid of Object.keys(seeds)) {
    managedContainerIds.add(cid);
  }
  await registerAllKnownContainers();
}

init();

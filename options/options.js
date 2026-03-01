const VECTORS = {
  canvas:      "Canvas",
  webgl:       "WebGL",
  audio:       "Audio",
  navigator:   "Navigator",
  screen:      "Screen",
  timezone:    "Timezone",
  webrtc:      "WebRTC",
  fonts:       "Fonts",
  clientRects: "Client Rects",
  plugins:     "Plugins",
  battery:     "Battery",
  connection:  "Connection"
};

// --- Vector Settings ---

async function loadVectors() {
  const settings = await browser.runtime.sendMessage({ type: "getVectorSettings" });
  const grid = document.getElementById("vector-grid");
  grid.innerHTML = "";

  for (const [key, label] of Object.entries(VECTORS)) {
    const item = document.createElement("div");
    item.className = "vector-item";

    const span = document.createElement("span");
    span.className = "vector-label";
    span.textContent = label;
    item.appendChild(span);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "toggle";
    toggle.checked = settings[key] !== false;
    toggle.addEventListener("change", async () => {
      settings[key] = toggle.checked;
      toggle.disabled = true;
      await browser.runtime.sendMessage({ type: "setVectorSettings", vectorSettings: settings });
      toggle.disabled = false;
    });
    item.appendChild(toggle);

    grid.appendChild(item);
  }
}

// --- Whitelist ---

let currentWhitelist = [];

async function loadWhitelist() {
  currentWhitelist = await browser.runtime.sendMessage({ type: "getWhitelist" });
  renderWhitelist();
}

function renderWhitelist() {
  const list = document.getElementById("wl-list");
  list.innerHTML = "";

  for (const domain of currentWhitelist) {
    const chip = document.createElement("span");
    chip.className = "wl-chip";
    chip.textContent = domain;

    const btn = document.createElement("button");
    btn.textContent = "\u00d7";
    btn.title = "Remove";
    btn.addEventListener("click", async () => {
      currentWhitelist = currentWhitelist.filter(d => d !== domain);
      await browser.runtime.sendMessage({ type: "setWhitelist", whitelist: currentWhitelist });
      renderWhitelist();
    });
    chip.appendChild(btn);
    list.appendChild(chip);
  }
}

document.getElementById("wl-add").addEventListener("click", addWhitelistEntry);
document.getElementById("wl-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWhitelistEntry();
});

async function addWhitelistEntry() {
  const input = document.getElementById("wl-input");
  let domain = input.value.trim().toLowerCase();

  // Strip protocol and path
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Strip www.
  domain = domain.replace(/^www\./, "");

  if (!domain || !domain.includes(".")) return;
  if (currentWhitelist.includes(domain)) { input.value = ""; return; }

  currentWhitelist.push(domain);
  await browser.runtime.sendMessage({ type: "setWhitelist", whitelist: currentWhitelist });
  input.value = "";
  renderWhitelist();
}

// --- Containers ---

async function loadContainers() {
  const containers = await browser.runtime.sendMessage({ type: "getContainerList" });
  const tbody = document.getElementById("container-tbody");
  const empty = document.getElementById("no-containers");
  tbody.innerHTML = "";

  // Only show containers that have a seed (managed by us)
  const ours = containers.filter(c => c.hasSeed);

  if (ours.length === 0) {
    empty.hidden = false;
    document.getElementById("container-table").hidden = true;
    return;
  }

  empty.hidden = true;
  document.getElementById("container-table").hidden = false;

  ours.sort((a, b) => (a.domain || a.name).localeCompare(b.domain || b.name));

  for (const c of ours) {
    const tr = document.createElement("tr");

    // Color dot
    const tdDot = document.createElement("td");
    const dot = document.createElement("span");
    dot.className = `dot dot-${c.color}`;
    tdDot.appendChild(dot);
    tr.appendChild(tdDot);

    // Domain
    const tdDomain = document.createElement("td");
    tdDomain.textContent = c.domain || c.name;
    tr.appendChild(tdDomain);

    // Enabled toggle
    const tdToggle = document.createElement("td");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "toggle";
    toggle.checked = c.enabled;
    toggle.addEventListener("change", async () => {
      await browser.runtime.sendMessage({
        type: "toggleContainer",
        cookieStoreId: c.cookieStoreId,
        enabled: toggle.checked
      });
    });
    tdToggle.appendChild(toggle);
    tr.appendChild(tdToggle);

    // Actions
    const tdActions = document.createElement("td");
    tdActions.className = "td-actions";

    const regen = document.createElement("button");
    regen.className = "btn-icon";
    regen.textContent = "New";
    regen.title = "Generate new fingerprint";
    regen.addEventListener("click", async () => {
      regen.textContent = "...";
      await browser.runtime.sendMessage({ type: "regenerateFingerprint", cookieStoreId: c.cookieStoreId });
      regen.textContent = "OK";
      setTimeout(() => { regen.textContent = "New"; }, 800);
    });
    tdActions.appendChild(regen);

    const del = document.createElement("button");
    del.className = "btn-del";
    del.textContent = "Del";
    del.title = "Delete container";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete container for ${c.domain || c.name}? Cookies and data for this site will be lost.`)) return;
      del.textContent = "...";
      await browser.runtime.sendMessage({ type: "deleteContainer", cookieStoreId: c.cookieStoreId });
      loadContainers();
    });
    tdActions.appendChild(del);

    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
}

// --- Bulk Actions ---

document.getElementById("regen-all").addEventListener("click", async (e) => {
  e.target.textContent = "Regenerating...";
  await browser.runtime.sendMessage({ type: "regenerateAll" });
  e.target.textContent = "Done!";
  setTimeout(() => { e.target.textContent = "Regenerate All Fingerprints"; }, 800);
});

document.getElementById("prune").addEventListener("click", async (e) => {
  e.target.textContent = "Pruning...";
  const result = await browser.runtime.sendMessage({ type: "pruneContainers" });
  e.target.textContent = `Removed ${result.pruned}`;
  setTimeout(() => {
    e.target.textContent = "Prune Unused";
    loadContainers();
  }, 1200);
});

document.getElementById("reset").addEventListener("click", async (e) => {
  if (!confirm("Remove all ContainSite containers and data? You will need to log in to all sites again.")) return;
  e.target.textContent = "Resetting...";
  await browser.runtime.sendMessage({ type: "resetAll" });
  e.target.textContent = "Done!";
  setTimeout(() => {
    e.target.textContent = "Reset All";
    loadContainers();
  }, 1200);
});

// --- Init ---

async function init() {
  const manifest = browser.runtime.getManifest();
  document.getElementById("version").textContent = `v${manifest.version}`;
  await Promise.all([loadVectors(), loadWhitelist(), loadContainers()]);
}

init();

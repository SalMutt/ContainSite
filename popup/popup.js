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

// Vectors forced by Cloudflare-safe mode (true = forced on, false = forced off)
const CF_SAFE_VECTORS = {
  canvas: true, audio: true, fonts: true, clientRects: true,
  timezone: true, navigator: true, webrtc: true, battery: true,
  webgl: false, screen: false, plugins: false, connection: false
};

async function loadContainers() {
  const containers = await browser.runtime.sendMessage({ type: "getContainerList" });
  const list = document.getElementById("container-list");
  list.innerHTML = "";

  for (const c of containers) {
    const row = document.createElement("div");
    row.className = "row";

    const dot = document.createElement("span");
    dot.className = `dot dot-${c.color}`;
    row.appendChild(dot);

    const nameWrap = document.createElement("div");
    nameWrap.className = "name";
    const name = document.createElement("div");
    name.className = "name-primary";
    name.textContent = c.name;
    nameWrap.appendChild(name);
    if (c.domain) {
      const domain = document.createElement("div");
      domain.className = "name-domain";
      domain.textContent = c.domain;
      nameWrap.appendChild(domain);
    }
    row.appendChild(nameWrap);

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
    row.appendChild(toggle);

    const shield = document.createElement("button");
    shield.className = "shield" + (c.cloudflareSafe ? " active" : "");
    shield.textContent = "\u{1F6E1}";
    shield.title = "Cloudflare-safe mode \u2014 reduces spoofing to avoid bot detection";
    shield.addEventListener("click", async () => {
      const newVal = !shield.classList.contains("active");
      shield.classList.toggle("active", newVal);
      await browser.runtime.sendMessage({
        type: "toggleCloudflareSafe",
        cookieStoreId: c.cookieStoreId,
        enabled: newVal
      });
      c.cloudflareSafe = newVal;
      // If vector panel is open, refresh it to show locked state
      const panel = row.nextElementSibling;
      if (panel && panel.classList.contains("vector-panel")) {
        panel.remove();
        gear.classList.remove("active");
        toggleSettings(c.cookieStoreId, row, gear, newVal);
      }
    });
    row.appendChild(shield);

    const gear = document.createElement("button");
    gear.className = "gear";
    gear.textContent = "\u2699";
    gear.title = "Vector settings";
    gear.addEventListener("click", () => toggleSettings(c.cookieStoreId, row, gear, c.cloudflareSafe));
    row.appendChild(gear);

    const regen = document.createElement("button");
    regen.className = "regen";
    regen.textContent = "New";
    regen.title = "Generate new fingerprint";
    regen.addEventListener("click", async () => {
      regen.textContent = "...";
      await browser.runtime.sendMessage({
        type: "regenerateFingerprint",
        cookieStoreId: c.cookieStoreId
      });
      regen.textContent = "OK";
      setTimeout(() => { regen.textContent = "New"; }, 800);
    });
    row.appendChild(regen);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "\u00D7";
    del.title = "Delete container";
    del.addEventListener("click", () => {
      // Show inline confirmation
      const existing = row.nextElementSibling;
      if (existing && existing.classList.contains("confirm-bar")) {
        existing.remove();
        return;
      }
      // Remove any open panels
      if (existing && existing.classList.contains("vector-panel")) existing.remove();

      const bar = document.createElement("div");
      bar.className = "confirm-bar";
      const msg = document.createElement("span");
      msg.className = "confirm-msg";
      msg.textContent = `Delete "${c.name}"?`;
      bar.appendChild(msg);

      const yes = document.createElement("button");
      yes.className = "confirm-yes";
      yes.textContent = "Delete";
      yes.addEventListener("click", async () => {
        await browser.runtime.sendMessage({
          type: "deleteContainer",
          cookieStoreId: c.cookieStoreId
        });
        bar.remove();
        row.remove();
      });
      bar.appendChild(yes);

      const no = document.createElement("button");
      no.className = "confirm-no";
      no.textContent = "Cancel";
      no.addEventListener("click", () => bar.remove());
      bar.appendChild(no);

      row.after(bar);
    });
    row.appendChild(del);

    list.appendChild(row);
  }
}

async function toggleSettings(cookieStoreId, row, gearBtn, cloudflareSafe) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("vector-panel")) {
    existing.remove();
    gearBtn.classList.remove("active");
    return;
  }

  gearBtn.classList.add("active");

  const panel = document.createElement("div");
  panel.className = "vector-panel";

  if (cloudflareSafe) {
    const note = document.createElement("div");
    note.className = "cf-note";
    note.textContent = "\u{1F6E1} Cloudflare-safe mode active \u2014 some vectors are locked";
    panel.appendChild(note);
  }

  const { global, overrides } = await browser.runtime.sendMessage({
    type: "getContainerVectors",
    cookieStoreId
  });

  for (const [key, label] of Object.entries(VECTORS)) {
    const item = document.createElement("div");
    item.className = "vector-row";

    const span = document.createElement("span");
    span.className = "vector-label";
    span.textContent = label;

    const locked = cloudflareSafe && CF_SAFE_VECTORS[key] !== undefined;

    const hasOverride = overrides[key] !== undefined && overrides[key] !== null;
    const globalEnabled = global[key] !== false;
    const effectiveValue = locked ? CF_SAFE_VECTORS[key] : (hasOverride ? overrides[key] : globalEnabled);

    if (locked) {
      span.classList.add("vector-locked");
      span.title = CF_SAFE_VECTORS[key]
        ? "Kept enabled by Cloudflare-safe mode"
        : "Disabled by Cloudflare-safe mode (creates detectable mismatches)";
    }
    item.appendChild(span);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "toggle toggle-sm";
    toggle.checked = effectiveValue;
    if (locked) {
      toggle.disabled = true;
      toggle.classList.add("locked");
    } else if (!hasOverride) {
      toggle.classList.add("inherited");
    }

    toggle.addEventListener("change", async () => {
      overrides[key] = toggle.checked;
      toggle.classList.remove("inherited");
      await browser.runtime.sendMessage({
        type: "setContainerVectors",
        cookieStoreId,
        vectors: overrides
      });
    });
    item.appendChild(toggle);

    const resetBtn = document.createElement("button");
    resetBtn.className = "vector-reset";
    resetBtn.textContent = "\u21A9";
    resetBtn.title = "Reset to global default";
    if (!hasOverride || locked) resetBtn.style.visibility = "hidden";
    resetBtn.addEventListener("click", async () => {
      delete overrides[key];
      toggle.checked = globalEnabled;
      toggle.classList.add("inherited");
      resetBtn.style.visibility = "hidden";
      await browser.runtime.sendMessage({
        type: "setContainerVectors",
        cookieStoreId,
        vectors: overrides
      });
    });
    item.appendChild(resetBtn);

    panel.appendChild(item);
  }

  row.after(panel);
}

document.getElementById("regen-all").addEventListener("click", async (e) => {
  e.target.textContent = "Regenerating...";
  await browser.runtime.sendMessage({ type: "regenerateAll" });
  e.target.textContent = "Done!";
  setTimeout(() => { e.target.textContent = "Regenerate All"; }, 800);
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

document.getElementById("reset").addEventListener("click", (e) => {
  const actions = e.target.closest(".actions");
  const existing = actions.querySelector(".confirm-bar");
  if (existing) { existing.remove(); return; }

  const bar = document.createElement("div");
  bar.className = "confirm-bar";
  const msg = document.createElement("span");
  msg.className = "confirm-msg";
  msg.textContent = "Remove all containers and data?";
  bar.appendChild(msg);

  const yes = document.createElement("button");
  yes.className = "confirm-yes";
  yes.textContent = "Reset";
  yes.addEventListener("click", async () => {
    bar.remove();
    e.target.textContent = "Resetting...";
    await browser.runtime.sendMessage({ type: "resetAll" });
    e.target.textContent = "Done!";
    setTimeout(() => {
      e.target.textContent = "Reset All";
      loadContainers();
    }, 1200);
  });
  bar.appendChild(yes);

  const no = document.createElement("button");
  no.className = "confirm-no";
  no.textContent = "Cancel";
  no.addEventListener("click", () => bar.remove());
  bar.appendChild(no);

  actions.appendChild(bar);
});

document.getElementById("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const rows = document.querySelectorAll("#container-list .row");
  for (const row of rows) {
    const text = row.textContent.toLowerCase();
    row.classList.toggle("hidden", q && !text.includes(q));
  }
});

loadContainers();

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

    list.appendChild(row);
  }
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

document.getElementById("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const rows = document.querySelectorAll("#container-list .row");
  for (const row of rows) {
    const text = row.textContent.toLowerCase();
    row.classList.toggle("hidden", q && !text.includes(q));
  }
});

loadContainers();

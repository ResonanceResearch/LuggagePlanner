const CONFIG = window.LUGGAGE_APP_CONFIG || {};
const STORAGE = {
  apiUrl: "packwise-api-url",
  token: "packwise-access-token",
  activeTrip: "packwise-active-trip"
};

const state = {
  apiBaseUrl: normalizeUrl(localStorage.getItem(STORAGE.apiUrl) || CONFIG.apiBaseUrl || ""),
  token: localStorage.getItem(STORAGE.token) || sessionStorage.getItem(STORAGE.token) || "",
  categories: [],
  items: [],
  trips: [],
  activeTripId: localStorage.getItem(STORAGE.activeTrip) || "",
  tripDetail: null,
  selectedCategory: "all",
  itemSearch: "",
  managerCategories: [],
  managerItems: [],
  showArchived: false,
  managerTab: "categories",
  tripDialogMode: "create",
  destinationItemId: null,
  busyCount: 0,
  dragPayload: null
};

const el = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((node) => [node.id, node])
);

const BAG_ICONS = {
  carry_on: "🧳",
  checked_luggage: "🧰",
  personal_item: "🎒",
  medication_kit: "💊",
  custom: "📦"
};

init();

function init() {
  bindEvents();
  populateConnectionForm();
  renderConnectionStatus(false);

  if (state.apiBaseUrl && state.token) {
    loadBootstrap().catch(handleError);
  } else {
    renderEmptyState();
    queueMicrotask(() => openDialog(el.connectionDialog));
  }
}

function bindEvents() {
  el.newTripBtn.addEventListener("click", () => openTripDialog("create"));
  el.mobileNewTripBtn.addEventListener("click", () => openTripDialog("create"));
  el.emptyCreateTripBtn.addEventListener("click", () => openTripDialog("create"));
  el.editTripBtn.addEventListener("click", () => openTripDialog("edit"));
  el.duplicateTripBtn.addEventListener("click", () => openTripDialog("duplicate"));
  el.archiveTripBtn.addEventListener("click", archiveOrRestoreCurrentTrip);

  el.sidebarOpenBtn.addEventListener("click", openSidebar);
  el.sidebarCloseBtn.addEventListener("click", closeSidebar);
  el.sidebarBackdrop.addEventListener("click", closeSidebar);

  el.archivedToggleBtn.addEventListener("click", toggleArchivedTrips);
  el.connectionBtn.addEventListener("click", () => {
    populateConnectionForm();
    openDialog(el.connectionDialog);
  });
  el.connectionForm.addEventListener("submit", saveConnection);
  el.testConnectionBtn.addEventListener("click", testConnection);

  el.tripForm.addEventListener("submit", saveTrip);
  document.querySelectorAll('input[name="travelMode"]').forEach((radio) => {
    radio.addEventListener("change", renderTravelerNamesVisibility);
  });

  el.itemSearch.addEventListener("input", () => {
    state.itemSearch = el.itemSearch.value.trim().toLowerCase();
    renderItemLibrary();
  });
  el.addItemBtn.addEventListener("click", () => openItemDialog());
  el.itemForm.addEventListener("submit", saveItem);
  el.archiveItemBtn.addEventListener("click", archiveCurrentItem);

  el.manageLibraryBtn.addEventListener("click", openLibraryManager);
  el.categoriesTabBtn.addEventListener("click", () => setManagerTab("categories"));
  el.itemsTabBtn.addEventListener("click", () => setManagerTab("items"));
  el.showArchivedInput.addEventListener("change", async () => {
    state.showArchived = el.showArchivedInput.checked;
    await loadManagerLibrary();
  });
  el.managerItemSearch.addEventListener("input", renderItemManager);
  el.categoryForm.addEventListener("submit", createCategory);

  el.addBagBtn.addEventListener("click", () => openBagDialog());
  el.bagForm.addEventListener("submit", saveBag);
  el.bagSharedInput.addEventListener("change", renderBagOwnerVisibility);
  el.deleteBagBtn.addEventListener("click", deleteCurrentBag);

  el.manageTravelersBtn.addEventListener("click", openTravelersManager);
  el.travelerForm.addEventListener("submit", addTraveler);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  document.querySelector("[data-close-library]").addEventListener("click", () => el.libraryDialog.close());
  document.querySelector("[data-close-travelers]").addEventListener("click", () => el.travelersDialog.close());
  document.querySelector("[data-close-destination]").addEventListener("click", () => el.destinationDialog.close());

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (!el.workspace.classList.contains("hidden")) el.itemSearch.focus();
    }
  });
}

async function loadBootstrap({ keepTrip = true } = {}) {
  setBusy(true, "Loading packing plans…");
  try {
    const data = await api("/api/bootstrap");
    state.categories = data.categories || [];
    state.items = data.items || [];
    state.trips = data.trips || [];
    renderConnectionStatus(true);
    renderTripLists();

    let desiredId = keepTrip ? state.activeTripId : "";
    if (!desiredId || !state.trips.some((trip) => trip.id === desiredId)) {
      desiredId = state.trips.find((trip) => trip.status === "active")?.id || state.trips[0]?.id || "";
    }

    if (desiredId) {
      await selectTrip(desiredId, { skipBusy: true });
    } else {
      state.tripDetail = null;
      renderEmptyState();
    }
  } finally {
    setBusy(false);
  }
}

async function selectTrip(tripId, { skipBusy = false } = {}) {
  if (!skipBusy) setBusy(true, "Opening trip…");
  try {
    state.activeTripId = tripId;
    localStorage.setItem(STORAGE.activeTrip, tripId);
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(tripId)}`);
    state.selectedCategory = "all";
    state.itemSearch = "";
    el.itemSearch.value = "";
    renderTripLists();
    renderWorkspace();
    closeSidebar();
  } finally {
    if (!skipBusy) setBusy(false);
  }
}

function renderEmptyState() {
  el.emptyState.classList.remove("hidden");
  el.workspace.classList.add("hidden");
  renderTripLists();
}

function renderWorkspace() {
  const detail = state.tripDetail;
  if (!detail) return renderEmptyState();

  el.emptyState.classList.add("hidden");
  el.workspace.classList.remove("hidden");

  const { trip, travelers, bags, placements } = detail;
  el.tripModeLabel.textContent = trip.travel_mode === "family" ? "Family trip" : "Solo trip";
  el.tripTitle.textContent = trip.name;
  document.title = `${trip.name} — Packwise`;

  const meta = [];
  if (trip.destination) meta.push(`<span>📍 ${escapeHtml(trip.destination)}</span>`);
  const dateText = formatDateRange(trip.start_date, trip.end_date);
  if (dateText) meta.push(`<span>📅 ${escapeHtml(dateText)}</span>`);
  meta.push(`<span>👥 ${travelers.length} ${travelers.length === 1 ? "traveller" : "travellers"}</span>`);
  if (trip.status === "archived") meta.push(`<span>🗄 Archived</span>`);
  el.tripMeta.innerHTML = meta.join("");

  const totalUnits = placements.reduce((sum, placement) => sum + Number(placement.quantity || 1), 0);
  const packedUnits = placements.reduce((sum, placement) => sum + (placement.is_packed ? Number(placement.quantity || 1) : 0), 0);
  const percent = totalUnits ? Math.round((packedUnits / totalUnits) * 100) : 0;
  el.statItems.textContent = String(totalUnits);
  el.statPacked.textContent = String(packedUnits);
  el.statBags.textContent = String(bags.length);
  el.progressBar.style.width = `${percent}%`;
  el.progressLabel.textContent = `${percent}% ready`;
  el.archiveTripBtn.title = trip.status === "archived" ? "Restore trip" : "Archive trip";
  el.archiveTripBtn.setAttribute("aria-label", el.archiveTripBtn.title);

  renderCategoryChips();
  renderItemLibrary();
  renderBagGroups();
}

function renderTripLists() {
  const activeTrips = state.trips.filter((trip) => trip.status === "active");
  const archivedTrips = state.trips.filter((trip) => trip.status === "archived");
  el.activeTripList.innerHTML = activeTrips.length
    ? activeTrips.map(renderTripNavItem).join("")
    : `<div class="trip-nav-meta" style="padding:.45rem .35rem">No active trips</div>`;
  el.archivedTripList.innerHTML = archivedTrips.length
    ? archivedTrips.map(renderTripNavItem).join("")
    : `<div class="trip-nav-meta" style="padding:.45rem .35rem">No previous trips</div>`;

  document.querySelectorAll(".trip-nav-item").forEach((button) => {
    button.addEventListener("click", () => selectTrip(button.dataset.tripId).catch(handleError));
  });
}

function renderTripNavItem(trip) {
  const date = trip.start_date ? formatShortDate(trip.start_date) : "Dates not set";
  const destination = trip.destination ? ` · ${escapeHtml(trip.destination)}` : "";
  return `
    <button class="trip-nav-item ${trip.id === state.activeTripId ? "active" : ""}" type="button" data-trip-id="${escapeAttr(trip.id)}">
      <span class="trip-nav-title">${escapeHtml(trip.name)}</span>
      <span class="trip-nav-meta">${escapeHtml(date)}${destination}</span>
    </button>
  `;
}

function renderCategoryChips() {
  const activeCategories = state.categories.filter((category) => !category.archived_at);
  const chips = [
    `<button class="category-chip ${state.selectedCategory === "all" ? "active" : ""}" type="button" data-category-id="all">All</button>`,
    ...activeCategories.map((category) => `
      <button class="category-chip ${state.selectedCategory === category.id ? "active" : ""}" type="button" data-category-id="${escapeAttr(category.id)}">
        ${escapeHtml(category.icon)} ${escapeHtml(category.name)}
      </button>
    `)
  ];
  el.categoryChips.innerHTML = chips.join("");
  el.categoryChips.querySelectorAll(".category-chip").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCategory = button.dataset.categoryId;
      renderCategoryChips();
      renderItemLibrary();
    });
  });
}

function renderItemLibrary() {
  if (!state.tripDetail) return;
  const categoriesById = new Map(state.categories.map((category) => [category.id, category]));
  const tripQuantities = new Map();
  for (const placement of state.tripDetail.placements) {
    tripQuantities.set(placement.item_id, (tripQuantities.get(placement.item_id) || 0) + Number(placement.quantity || 1));
  }

  const filtered = state.items.filter((item) => {
    if (item.archived_at) return false;
    const categoryMatches = state.selectedCategory === "all" || item.category_id === state.selectedCategory;
    const category = categoriesById.get(item.category_id);
    const haystack = `${item.name} ${category?.name || ""} ${item.notes || ""}`.toLowerCase();
    return categoryMatches && (!state.itemSearch || haystack.includes(state.itemSearch));
  });

  if (!filtered.length) {
    el.itemLibrary.innerHTML = `<div class="item-empty">No items match this view.</div>`;
    return;
  }

  el.itemLibrary.innerHTML = filtered.map((item) => {
    const category = categoriesById.get(item.category_id);
    const already = tripQuantities.get(item.id) || 0;
    return `
      <article class="library-item" draggable="true" data-item-id="${escapeAttr(item.id)}">
        <div class="library-item-main">
          <div class="library-item-name">
            <span>${escapeHtml(item.name)}</span>
            ${item.is_essential ? '<span class="essential-badge">Essential</span>' : ""}
          </div>
          <div class="library-item-meta">
            ${escapeHtml(category?.icon || "📦")} ${escapeHtml(category?.name || "Uncategorised")}
            ${item.default_quantity > 1 ? ` · default ×${item.default_quantity}` : ""}
            ${already ? ` · in trip ×${already}` : ""}
          </div>
        </div>
        <button class="add-to-bag-button" type="button" aria-label="Choose a bag for ${escapeAttr(item.name)}" data-add-item="${escapeAttr(item.id)}">＋</button>
      </article>
    `;
  }).join("");

  el.itemLibrary.querySelectorAll(".library-item").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      card.classList.add("dragging");
      const payload = { kind: "library-item", itemId: card.dataset.itemId };
      state.dragPayload = payload;
      event.dataTransfer.effectAllowed = "copy";
      writeDragPayload(event.dataTransfer, payload);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      clearDragState();
    });
  });
  el.itemLibrary.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => openDestinationDialog(button.dataset.addItem));
  });
}

function renderBagGroups() {
  const detail = state.tripDetail;
  if (!detail) return;
  const placementsByBag = groupBy(detail.placements, (placement) => placement.bag_id);
  const bagsByOwner = groupBy(detail.bags, (bag) => bag.owner_traveler_id || "shared");
  const groups = [];

  const sharedBags = bagsByOwner.get("shared") || [];
  if (sharedBags.length) {
    groups.push(renderBagGroup("Shared luggage", "shared", 7, sharedBags, placementsByBag));
  }
  for (const traveler of detail.travelers) {
    const bags = bagsByOwner.get(traveler.id) || [];
    if (bags.length) groups.push(renderBagGroup(traveler.name, traveler.id, traveler.color_index, bags, placementsByBag));
  }

  el.bagGroups.innerHTML = groups.length
    ? groups.join("")
    : `<section class="panel" style="padding:1.5rem;text-align:center;color:var(--muted)">No bags yet. Add a bag to start planning.</section>`;

  bindBagInteractions();
}

function renderBagGroup(title, ownerKey, colorIndex, bags, placementsByBag) {
  return `
    <section class="bag-group" data-owner-key="${escapeAttr(ownerKey)}">
      <div class="bag-group-heading"><span class="traveler-dot c${Number(colorIndex) % 8}"></span><h3>${escapeHtml(title)}</h3></div>
      <div class="bag-grid">
        ${bags.map((bag) => renderBagCard(bag, placementsByBag.get(bag.id) || [])).join("")}
      </div>
    </section>
  `;
}

function renderBagCard(bag, placements) {
  const packedCount = placements.filter((placement) => placement.is_packed).length;
  const subtitleBits = [bag.owner_name || (bag.is_shared ? "Shared" : "Unassigned")];
  if (bag.capacity_note) subtitleBits.push(bag.capacity_note);
  if (placements.length) subtitleBits.push(`${packedCount}/${placements.length} packed`);

  return `
    <article class="bag-card" data-bag-id="${escapeAttr(bag.id)}">
      <header class="bag-card-header">
        <div class="bag-title-row">
          <div class="bag-icon">${BAG_ICONS[bag.bag_type] || BAG_ICONS.custom}</div>
          <div style="min-width:0">
            <div class="bag-title">${escapeHtml(bag.name)}</div>
            <div class="bag-subtitle">${escapeHtml(subtitleBits.join(" · "))}</div>
          </div>
        </div>
        <button class="bag-edit-button" type="button" aria-label="Edit ${escapeAttr(bag.name)}" data-edit-bag="${escapeAttr(bag.id)}">•••</button>
      </header>
      <div class="bag-drop-zone">
        ${placements.length ? `<div class="placement-list">${placements.map(renderPlacement).join("")}</div>` : '<div class="bag-empty">Drop items here</div>'}
      </div>
    </article>
  `;
}

function renderPlacement(placement) {
  return `
    <div class="placement-item ${placement.is_packed ? "packed" : ""}" draggable="true" data-placement-id="${escapeAttr(placement.id)}">
      <input class="pack-check" type="checkbox" ${placement.is_packed ? "checked" : ""} aria-label="Mark ${escapeAttr(placement.item_name)} packed" data-pack-id="${escapeAttr(placement.id)}">
      <div class="placement-main">
        <div class="placement-name">${escapeHtml(placement.item_name)}</div>
        <div class="placement-meta">${escapeHtml(placement.category_icon || "📦")} ${escapeHtml(placement.category_name || "")}</div>
      </div>
      <div class="placement-actions">
        <div class="quantity-control" aria-label="Quantity">
          <button type="button" data-qty-action="decrease" data-placement-id="${escapeAttr(placement.id)}" aria-label="Decrease quantity">−</button>
          <span>${Number(placement.quantity || 1)}</span>
          <button type="button" data-qty-action="increase" data-placement-id="${escapeAttr(placement.id)}" aria-label="Increase quantity">＋</button>
        </div>
        <button class="remove-placement" type="button" data-remove-placement="${escapeAttr(placement.id)}" aria-label="Remove ${escapeAttr(placement.item_name)} from trip">×</button>
      </div>
    </div>
  `;
}

function bindBagInteractions() {
  el.bagGroups.querySelectorAll(".bag-card").forEach((bagCard) => {
    bagCard.addEventListener("dragenter", (event) => {
      event.preventDefault();
      bagCard.classList.add("drag-over");
    });
    bagCard.addEventListener("dragover", (event) => {
      event.preventDefault();
      const kind = state.dragPayload?.kind;
      event.dataTransfer.dropEffect = kind === "library-item" ? "copy" : "move";
      bagCard.classList.add("drag-over");
    });
    bagCard.addEventListener("dragleave", (event) => {
      if (!bagCard.contains(event.relatedTarget)) bagCard.classList.remove("drag-over");
    });
    bagCard.addEventListener("drop", async (event) => {
      event.preventDefault();
      bagCard.classList.remove("drag-over");
      try {
        const payload = readDragPayload(event.dataTransfer) || state.dragPayload;
        if (!payload) throw new Error("The dragged item could not be identified. Please try again.");
        if (payload.kind === "library-item") await addItemToBag(payload.itemId, bagCard.dataset.bagId);
        if (payload.kind === "placement") await movePlacement(payload.placementId, bagCard.dataset.bagId);
      } catch (error) {
        handleError(error);
      } finally {
        clearDragState();
      }
    });
  });

  el.bagGroups.querySelectorAll("[data-edit-bag]").forEach((button) => {
    button.addEventListener("click", () => openBagDialog(button.dataset.editBag));
  });
  el.bagGroups.querySelectorAll(".placement-item").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      card.classList.add("dragging");
      const payload = { kind: "placement", placementId: card.dataset.placementId };
      state.dragPayload = payload;
      event.dataTransfer.effectAllowed = "move";
      writeDragPayload(event.dataTransfer, payload);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      clearDragState();
    });
  });
  el.bagGroups.querySelectorAll("[data-pack-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => updatePlacement(checkbox.dataset.packId, { isPacked: checkbox.checked }));
  });
  el.bagGroups.querySelectorAll("[data-qty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const placement = state.tripDetail.placements.find((row) => row.id === button.dataset.placementId);
      if (!placement) return;
      const delta = button.dataset.qtyAction === "increase" ? 1 : -1;
      const next = Math.max(1, Number(placement.quantity) + delta);
      if (next !== Number(placement.quantity)) updatePlacement(placement.id, { quantity: next });
    });
  });
  el.bagGroups.querySelectorAll("[data-remove-placement]").forEach((button) => {
    button.addEventListener("click", () => removePlacement(button.dataset.removePlacement));
  });
}

function writeDragPayload(dataTransfer, payload) {
  const serialized = JSON.stringify(payload);
  dataTransfer.setData("application/x-packwise-item", serialized);
  dataTransfer.setData("text/plain", serialized);
}

function readDragPayload(dataTransfer) {
  const serialized = dataTransfer.getData("application/x-packwise-item") || dataTransfer.getData("text/plain");
  if (!serialized) return null;
  return JSON.parse(serialized);
}

function clearDragState() {
  state.dragPayload = null;
  el.bagGroups?.querySelectorAll(".drag-over").forEach((card) => card.classList.remove("drag-over"));
}

async function addItemToBag(itemId, bagId) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Item not found.");
  setBusy(true, "Adding item…");
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/placements`, {
      method: "POST",
      body: { itemId, bagId, quantity: Number(item.default_quantity || 1) }
    });
    updateTripSummaryFromDetail();
    renderWorkspace();
    toast(`${item.name} added.`);
  } finally {
    setBusy(false);
  }
}

async function movePlacement(placementId, bagId) {
  const placement = state.tripDetail.placements.find((entry) => entry.id === placementId);
  if (!placement || placement.bag_id === bagId) return;
  await updatePlacement(placementId, { bagId }, "Item moved.");
}

async function updatePlacement(placementId, changes, successMessage = "") {
  setBusy(true, "Updating item…");
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/placements/${encodeURIComponent(placementId)}`, {
      method: "PATCH",
      body: changes
    });
    updateTripSummaryFromDetail();
    renderWorkspace();
    if (successMessage) toast(successMessage);
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function removePlacement(placementId) {
  const placement = state.tripDetail.placements.find((entry) => entry.id === placementId);
  if (!placement) return;
  if (!window.confirm(`Remove “${placement.item_name}” from this trip?`)) return;
  setBusy(true, "Removing item…");
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/placements/${encodeURIComponent(placementId)}`, { method: "DELETE" });
    updateTripSummaryFromDetail();
    renderWorkspace();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

function openDestinationDialog(itemId) {
  if (!state.tripDetail?.bags.length) {
    toast("Add a bag first.", true);
    return;
  }
  const item = state.items.find((entry) => entry.id === itemId);
  state.destinationItemId = itemId;
  el.destinationDialogTitle.textContent = item ? `Pack ${item.name}` : "Choose a bag";
  el.destinationList.innerHTML = state.tripDetail.bags.map((bag) => `
    <button class="destination-button" type="button" data-destination-bag="${escapeAttr(bag.id)}">
      <div class="bag-icon">${BAG_ICONS[bag.bag_type] || BAG_ICONS.custom}</div>
      <div><strong>${escapeHtml(bag.name)}</strong><span>${escapeHtml(bag.owner_name || (bag.is_shared ? "Shared" : "Unassigned"))}</span></div>
    </button>
  `).join("");
  el.destinationList.querySelectorAll("[data-destination-bag]").forEach((button) => {
    button.addEventListener("click", async () => {
      el.destinationDialog.close();
      try {
        await addItemToBag(state.destinationItemId, button.dataset.destinationBag);
      } catch (error) {
        handleError(error);
      }
    });
  });
  openDialog(el.destinationDialog);
}

function openTripDialog(mode) {
  state.tripDialogMode = mode;
  el.tripForm.reset();
  el.tripIdInput.value = "";
  const modeFieldset = el.travelModeFieldset;

  if (mode === "create") {
    el.tripDialogEyebrow.textContent = "New packing plan";
    el.tripDialogTitle.textContent = "Create a trip";
    el.saveTripBtn.textContent = "Create trip";
    modeFieldset.classList.remove("hidden");
    document.querySelector('input[name="travelMode"][value="solo"]').checked = true;
  } else {
    const trip = state.tripDetail?.trip;
    if (!trip) return;
    el.tripIdInput.value = trip.id;
    el.tripNameInput.value = mode === "duplicate" ? `${trip.name} — next trip` : trip.name;
    el.tripDestinationInput.value = trip.destination || "";
    el.tripStartInput.value = mode === "duplicate" ? "" : (trip.start_date || "");
    el.tripEndInput.value = mode === "duplicate" ? "" : (trip.end_date || "");
    el.tripNotesInput.value = trip.notes || "";
    modeFieldset.classList.add("hidden");
    el.travelerNamesField.classList.add("hidden");

    if (mode === "edit") {
      el.tripDialogEyebrow.textContent = "Trip details";
      el.tripDialogTitle.textContent = "Edit trip";
      el.saveTripBtn.textContent = "Save changes";
    } else {
      el.tripDialogEyebrow.textContent = "Reuse saved layout";
      el.tripDialogTitle.textContent = "Create from this trip";
      el.saveTripBtn.textContent = "Create copied trip";
    }
  }

  renderTravelerNamesVisibility();
  openDialog(el.tripDialog);
  queueMicrotask(() => el.tripNameInput.focus());
}

function renderTravelerNamesVisibility() {
  if (state.tripDialogMode !== "create") {
    el.travelerNamesField.classList.add("hidden");
    return;
  }
  const mode = document.querySelector('input[name="travelMode"]:checked')?.value || "solo";
  el.travelerNamesField.classList.toggle("hidden", mode !== "family");
}

async function saveTrip(event) {
  event.preventDefault();
  const payload = {
    name: el.tripNameInput.value,
    destination: el.tripDestinationInput.value,
    startDate: el.tripStartInput.value || null,
    endDate: el.tripEndInput.value || null,
    notes: el.tripNotesInput.value
  };

  setBusy(true, "Saving trip…");
  try {
    let detail;
    if (state.tripDialogMode === "create") {
      payload.travelMode = document.querySelector('input[name="travelMode"]:checked')?.value || "solo";
      payload.travelerNames = payload.travelMode === "family"
        ? el.travelerNamesInput.value.split(/\n+/).map((name) => name.trim()).filter(Boolean)
        : ["Me"];
      detail = await api("/api/trips", { method: "POST", body: payload });
    } else if (state.tripDialogMode === "edit") {
      detail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}`, { method: "PATCH", body: payload });
    } else {
      detail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/duplicate`, {
        method: "POST",
        body: { name: payload.name, startDate: payload.startDate, endDate: payload.endDate }
      });
      detail = await api(`/api/trips/${encodeURIComponent(detail.trip.id)}`, {
        method: "PATCH",
        body: { destination: payload.destination, notes: payload.notes }
      });
    }

    el.tripDialog.close();
    state.activeTripId = detail.trip.id;
    state.tripDetail = detail;
    localStorage.setItem(STORAGE.activeTrip, state.activeTripId);
    await refreshBootstrapWithoutTripFetch();
    renderWorkspace();
    toast(state.tripDialogMode === "edit" ? "Trip updated." : "Trip created.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function archiveOrRestoreCurrentTrip() {
  const trip = state.tripDetail?.trip;
  if (!trip) return;
  const restoring = trip.status === "archived";
  const message = restoring
    ? `Restore “${trip.name}” to active trips?`
    : `Archive “${trip.name}”? Its bags and packing layout will remain available under Previous trips.`;
  if (!window.confirm(message)) return;

  setBusy(true, restoring ? "Restoring trip…" : "Archiving trip…");
  try {
    if (restoring) {
      state.tripDetail = await api(`/api/trips/${encodeURIComponent(trip.id)}`, { method: "PATCH", body: { status: "active" } });
    } else {
      await api(`/api/trips/${encodeURIComponent(trip.id)}`, { method: "DELETE" });
      state.tripDetail.trip.status = "archived";
    }
    await refreshBootstrapWithoutTripFetch();
    renderWorkspace();
    toast(restoring ? "Trip restored." : "Trip archived.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

function openItemDialog(itemId = "") {
  el.itemForm.reset();
  fillCategorySelect(el.itemCategoryInput);
  el.itemIdInput.value = itemId;
  const item = itemId
    ? (state.managerItems.find((entry) => entry.id === itemId) || state.items.find((entry) => entry.id === itemId))
    : null;

  if (item) {
    el.itemDialogTitle.textContent = "Edit item";
    el.itemNameInput.value = item.name;
    el.itemCategoryInput.value = item.category_id;
    el.itemQuantityInput.value = item.default_quantity || 1;
    el.itemEssentialInput.checked = Boolean(item.is_essential);
    el.itemNotesInput.value = item.notes || "";
    el.archiveItemBtn.classList.toggle("hidden", Boolean(item.archived_at));
  } else {
    el.itemDialogTitle.textContent = "Add an item";
    el.itemQuantityInput.value = "1";
    el.archiveItemBtn.classList.add("hidden");
    if (state.selectedCategory !== "all") el.itemCategoryInput.value = state.selectedCategory;
  }
  openDialog(el.itemDialog);
  queueMicrotask(() => el.itemNameInput.focus());
}

async function saveItem(event) {
  event.preventDefault();
  const id = el.itemIdInput.value;
  const payload = {
    name: el.itemNameInput.value,
    categoryId: el.itemCategoryInput.value,
    defaultQuantity: Number(el.itemQuantityInput.value || 1),
    isEssential: el.itemEssentialInput.checked,
    notes: el.itemNotesInput.value
  };
  setBusy(true, "Saving item…");
  try {
    if (id) await api(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
    else await api("/api/items", { method: "POST", body: payload });
    el.itemDialog.close();
    await loadLibraryIntoState();
    if (el.libraryDialog.open) await loadManagerLibrary();
    renderCategoryChips();
    renderItemLibrary();
    toast(id ? "Item updated." : "Item added to the library.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function archiveCurrentItem() {
  const id = el.itemIdInput.value;
  const item = state.managerItems.find((entry) => entry.id === id) || state.items.find((entry) => entry.id === id);
  if (!id || !item || !window.confirm(`Archive “${item.name}”? Existing trips will keep it.`)) return;
  setBusy(true, "Archiving item…");
  try {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    el.itemDialog.close();
    await loadLibraryIntoState();
    if (el.libraryDialog.open) await loadManagerLibrary();
    renderCategoryChips();
    renderItemLibrary();
    toast("Item archived.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function openLibraryManager() {
  state.managerTab = "categories";
  state.showArchived = false;
  el.showArchivedInput.checked = false;
  setManagerTab("categories");
  openDialog(el.libraryDialog);
  await loadManagerLibrary();
}

async function loadManagerLibrary() {
  try {
    const data = await api(`/api/library?includeArchived=${state.showArchived ? "1" : "0"}`);
    state.managerCategories = data.categories || [];
    state.managerItems = data.items || [];
    renderCategoryManager();
    renderItemManager();
  } catch (error) {
    handleError(error);
  }
}

function setManagerTab(tab) {
  state.managerTab = tab;
  el.categoriesTabBtn.classList.toggle("active", tab === "categories");
  el.itemsTabBtn.classList.toggle("active", tab === "items");
  el.categoryManagerView.classList.toggle("hidden", tab !== "categories");
  el.itemManagerView.classList.toggle("hidden", tab !== "items");
}

function renderCategoryManager() {
  const itemCountByCategory = new Map();
  for (const item of state.managerItems) {
    if (!item.archived_at) itemCountByCategory.set(item.category_id, (itemCountByCategory.get(item.category_id) || 0) + 1);
  }
  el.categoryManagerList.innerHTML = state.managerCategories.map((category) => `
    <div class="manager-row ${category.archived_at ? "archived" : ""}">
      <div class="manager-row-main">
        <div class="manager-row-title">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</div>
        <div class="manager-row-meta">${itemCountByCategory.get(category.id) || 0} active items${category.is_system ? " · built in" : ""}${category.archived_at ? " · archived" : ""}</div>
      </div>
      <div class="manager-row-actions">
        <button type="button" data-edit-category="${escapeAttr(category.id)}">Edit</button>
        ${category.archived_at
          ? `<button type="button" data-restore-category="${escapeAttr(category.id)}">Restore</button>`
          : (!category.is_system ? `<button class="danger" type="button" data-archive-category="${escapeAttr(category.id)}">Archive</button>` : "")}
      </div>
    </div>
  `).join("") || `<div class="item-empty">No categories found.</div>`;

  el.categoryManagerList.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => editCategory(button.dataset.editCategory)));
  el.categoryManagerList.querySelectorAll("[data-archive-category]").forEach((button) => button.addEventListener("click", () => archiveCategory(button.dataset.archiveCategory)));
  el.categoryManagerList.querySelectorAll("[data-restore-category]").forEach((button) => button.addEventListener("click", () => restoreCategory(button.dataset.restoreCategory)));
}

async function createCategory(event) {
  event.preventDefault();
  setBusy(true, "Adding category…");
  try {
    await api("/api/categories", {
      method: "POST",
      body: { name: el.categoryNameInput.value, icon: el.categoryIconInput.value || "📦" }
    });
    el.categoryForm.reset();
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderCategoryChips();
    toast("Category added.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function editCategory(id) {
  const category = state.managerCategories.find((entry) => entry.id === id);
  if (!category) return;
  const name = window.prompt("Category name", category.name);
  if (name === null) return;
  const icon = window.prompt("Category icon", category.icon || "📦");
  if (icon === null) return;
  setBusy(true, "Updating category…");
  try {
    await api(`/api/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: { name, icon } });
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderCategoryChips();
    renderItemLibrary();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function archiveCategory(id) {
  const category = state.managerCategories.find((entry) => entry.id === id);
  if (!category || !window.confirm(`Archive “${category.name}”? The category must contain no active items.`)) return;
  try {
    await api(`/api/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderCategoryChips();
  } catch (error) {
    handleError(error);
  }
}

async function restoreCategory(id) {
  try {
    await api(`/api/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: { archived: false } });
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderCategoryChips();
  } catch (error) {
    handleError(error);
  }
}

function renderItemManager() {
  const query = el.managerItemSearch.value.trim().toLowerCase();
  const categoriesById = new Map(state.managerCategories.map((category) => [category.id, category]));
  const filtered = state.managerItems.filter((item) => {
    const category = categoriesById.get(item.category_id);
    return !query || `${item.name} ${category?.name || ""}`.toLowerCase().includes(query);
  });
  el.itemManagerList.innerHTML = filtered.map((item) => {
    const category = categoriesById.get(item.category_id);
    return `
      <div class="manager-row ${item.archived_at ? "archived" : ""}">
        <div class="manager-row-main">
          <div class="manager-row-title">${escapeHtml(item.name)} ${item.is_essential ? '<span class="essential-badge">Essential</span>' : ""}</div>
          <div class="manager-row-meta">${escapeHtml(category?.icon || "📦")} ${escapeHtml(category?.name || "Unknown")}${item.archived_at ? " · archived" : ""}</div>
        </div>
        <div class="manager-row-actions">
          ${item.archived_at
            ? `<button type="button" data-restore-item="${escapeAttr(item.id)}">Restore</button>`
            : `<button type="button" data-edit-item="${escapeAttr(item.id)}">Edit</button><button class="danger" type="button" data-manager-archive-item="${escapeAttr(item.id)}">Archive</button>`}
        </div>
      </div>
    `;
  }).join("") || `<div class="item-empty">No items found.</div>`;

  el.itemManagerList.querySelectorAll("[data-edit-item]").forEach((button) => button.addEventListener("click", () => openItemDialog(button.dataset.editItem)));
  el.itemManagerList.querySelectorAll("[data-manager-archive-item]").forEach((button) => button.addEventListener("click", () => managerArchiveItem(button.dataset.managerArchiveItem)));
  el.itemManagerList.querySelectorAll("[data-restore-item]").forEach((button) => button.addEventListener("click", () => restoreItem(button.dataset.restoreItem)));
}

async function managerArchiveItem(id) {
  const item = state.managerItems.find((entry) => entry.id === id);
  if (!item || !window.confirm(`Archive “${item.name}”? Existing trips will keep it.`)) return;
  try {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderItemLibrary();
  } catch (error) {
    handleError(error);
  }
}

async function restoreItem(id) {
  try {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: { archived: false } });
    await loadLibraryIntoState();
    await loadManagerLibrary();
    renderItemLibrary();
  } catch (error) {
    handleError(error);
  }
}

function openBagDialog(bagId = "") {
  if (!state.tripDetail) return;
  el.bagForm.reset();
  el.bagIdInput.value = bagId;
  fillTravelerSelect();
  const bag = state.tripDetail.bags.find((entry) => entry.id === bagId);
  if (bag) {
    el.bagDialogTitle.textContent = "Edit bag";
    el.bagNameInput.value = bag.name;
    el.bagTypeInput.value = bag.bag_type;
    el.bagSharedInput.checked = Boolean(bag.is_shared);
    el.bagOwnerInput.value = bag.owner_traveler_id || "";
    el.bagCapacityInput.value = bag.capacity_note || "";
    el.deleteBagBtn.classList.remove("hidden");
  } else {
    el.bagDialogTitle.textContent = "Add a bag";
    el.bagTypeInput.value = "carry_on";
    el.bagOwnerInput.value = state.tripDetail.travelers[0]?.id || "";
    el.deleteBagBtn.classList.add("hidden");
  }
  renderBagOwnerVisibility();
  openDialog(el.bagDialog);
  queueMicrotask(() => el.bagNameInput.focus());
}

function fillTravelerSelect() {
  el.bagOwnerInput.innerHTML = state.tripDetail.travelers.map((traveler) => `
    <option value="${escapeAttr(traveler.id)}">${escapeHtml(traveler.name)}</option>
  `).join("");
}

function renderBagOwnerVisibility() {
  el.bagOwnerField.classList.toggle("hidden", el.bagSharedInput.checked);
}

async function saveBag(event) {
  event.preventDefault();
  const id = el.bagIdInput.value;
  const payload = {
    name: el.bagNameInput.value,
    bagType: el.bagTypeInput.value,
    isShared: el.bagSharedInput.checked,
    ownerTravelerId: el.bagSharedInput.checked ? null : el.bagOwnerInput.value,
    capacityNote: el.bagCapacityInput.value
  };
  setBusy(true, "Saving bag…");
  try {
    state.tripDetail = await api(
      id
        ? `/api/trips/${encodeURIComponent(state.activeTripId)}/bags/${encodeURIComponent(id)}`
        : `/api/trips/${encodeURIComponent(state.activeTripId)}/bags`,
      { method: id ? "PATCH" : "POST", body: payload }
    );
    el.bagDialog.close();
    updateTripSummaryFromDetail();
    renderWorkspace();
    toast(id ? "Bag updated." : "Bag added.");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function deleteCurrentBag() {
  const id = el.bagIdInput.value;
  const bag = state.tripDetail.bags.find((entry) => entry.id === id);
  if (!bag) return;
  const count = state.tripDetail.placements.filter((placement) => placement.bag_id === id).length;
  const suffix = count ? ` This will also remove ${count} planned item${count === 1 ? "" : "s"} from the trip.` : "";
  if (!window.confirm(`Delete “${bag.name}”?${suffix}`)) return;
  setBusy(true, "Deleting bag…");
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/bags/${encodeURIComponent(id)}`, { method: "DELETE" });
    el.bagDialog.close();
    updateTripSummaryFromDetail();
    renderWorkspace();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

function openTravelersManager() {
  renderTravelerManager();
  openDialog(el.travelersDialog);
}

function renderTravelerManager() {
  el.travelerManagerList.innerHTML = state.tripDetail.travelers.map((traveler) => `
    <div class="manager-row">
      <div class="manager-row-main">
        <div class="manager-row-title"><span class="traveler-dot c${traveler.color_index % 8}" style="display:inline-block;margin-right:.4rem"></span>${escapeHtml(traveler.name)}</div>
        <div class="manager-row-meta">${state.tripDetail.bags.filter((bag) => bag.owner_traveler_id === traveler.id).length} assigned bags</div>
      </div>
      <div class="manager-row-actions">
        <button type="button" data-edit-traveler="${escapeAttr(traveler.id)}">Rename</button>
        ${state.tripDetail.travelers.length > 1 ? `<button class="danger" type="button" data-delete-traveler="${escapeAttr(traveler.id)}">Remove</button>` : ""}
      </div>
    </div>
  `).join("");
  el.travelerManagerList.querySelectorAll("[data-edit-traveler]").forEach((button) => button.addEventListener("click", () => renameTraveler(button.dataset.editTraveler)));
  el.travelerManagerList.querySelectorAll("[data-delete-traveler]").forEach((button) => button.addEventListener("click", () => deleteTraveler(button.dataset.deleteTraveler)));
}

async function addTraveler(event) {
  event.preventDefault();
  const name = el.travelerNameInput.value.trim();
  if (!name) return;
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/travelers`, { method: "POST", body: { name } });
    el.travelerForm.reset();
    renderTravelerManager();
    renderWorkspace();
  } catch (error) {
    handleError(error);
  }
}

async function renameTraveler(id) {
  const traveler = state.tripDetail.travelers.find((entry) => entry.id === id);
  if (!traveler) return;
  const name = window.prompt("Traveller name", traveler.name);
  if (!name || name.trim() === traveler.name) return;
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/travelers/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
    renderTravelerManager();
    renderWorkspace();
  } catch (error) {
    handleError(error);
  }
}

async function deleteTraveler(id) {
  const traveler = state.tripDetail.travelers.find((entry) => entry.id === id);
  if (!traveler || !window.confirm(`Remove ${traveler.name}? Their bags will become shared.`)) return;
  try {
    state.tripDetail = await api(`/api/trips/${encodeURIComponent(state.activeTripId)}/travelers/${encodeURIComponent(id)}`, { method: "DELETE" });
    renderTravelerManager();
    renderWorkspace();
  } catch (error) {
    handleError(error);
  }
}

async function loadLibraryIntoState() {
  const data = await api("/api/library");
  state.categories = data.categories || [];
  state.items = data.items || [];
}

async function refreshBootstrapWithoutTripFetch() {
  const data = await api("/api/bootstrap");
  state.categories = data.categories || [];
  state.items = data.items || [];
  state.trips = data.trips || [];
  renderTripLists();
}

function updateTripSummaryFromDetail() {
  if (!state.tripDetail) return;
  const { trip, bags, placements } = state.tripDetail;
  const summary = state.trips.find((entry) => entry.id === trip.id);
  if (summary) {
    Object.assign(summary, trip, {
      bag_count: bags.length,
      placement_count: placements.length,
      packed_count: placements.filter((entry) => entry.is_packed).length
    });
  }
  renderTripLists();
}

function populateConnectionForm() {
  el.apiUrlInput.value = state.apiBaseUrl;
  el.accessTokenInput.value = state.token;
  el.rememberTokenInput.checked = Boolean(localStorage.getItem(STORAGE.token));
  el.connectionTestMessage.classList.add("hidden");
}

async function testConnection() {
  const apiUrl = normalizeUrl(el.apiUrlInput.value);
  const token = el.accessTokenInput.value.trim();
  el.connectionTestMessage.className = "inline-message";
  el.connectionTestMessage.textContent = "Testing…";
  try {
    await rawApi(apiUrl, token, "/api/bootstrap");
    el.connectionTestMessage.textContent = "Connection successful.";
  } catch (error) {
    el.connectionTestMessage.classList.add("error");
    el.connectionTestMessage.textContent = error.message;
  }
}

async function saveConnection(event) {
  event.preventDefault();
  const apiUrl = normalizeUrl(el.apiUrlInput.value);
  const token = el.accessTokenInput.value.trim();
  if (!apiUrl || !token) return;

  setBusy(true, "Connecting…");
  try {
    await rawApi(apiUrl, token, "/api/bootstrap");
    state.apiBaseUrl = apiUrl;
    state.token = token;
    localStorage.setItem(STORAGE.apiUrl, apiUrl);
    if (el.rememberTokenInput.checked) {
      localStorage.setItem(STORAGE.token, token);
      sessionStorage.removeItem(STORAGE.token);
    } else {
      sessionStorage.setItem(STORAGE.token, token);
      localStorage.removeItem(STORAGE.token);
    }
    el.connectionDialog.close();
    await loadBootstrap();
    toast("Connected to Cloudflare.");
  } catch (error) {
    handleError(error);
    el.connectionTestMessage.className = "inline-message error";
    el.connectionTestMessage.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function renderConnectionStatus(online) {
  el.connectionStatus.classList.toggle("online", online);
  el.connectionStatus.querySelector("span:last-child").textContent = online ? "Cloudflare connected" : "Not connected";
}

async function api(path, options = {}) {
  return rawApi(state.apiBaseUrl, state.token, path, options);
}

async function rawApi(baseUrl, token, path, options = {}) {
  if (!baseUrl) throw new Error("Worker API URL is not configured.");
  const response = await fetch(`${normalizeUrl(baseUrl)}${path}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}.`);
  return data;
}

function fillCategorySelect(select) {
  const categories = state.categories.filter((category) => !category.archived_at);
  select.innerHTML = categories.map((category) => `<option value="${escapeAttr(category.id)}">${escapeHtml(category.icon)} ${escapeHtml(category.name)}</option>`).join("");
}

function toggleArchivedTrips() {
  const isHidden = el.archivedTripList.classList.toggle("hidden");
  el.archivedToggleBtn.setAttribute("aria-expanded", String(!isHidden));
  el.archiveChevron.textContent = isHidden ? "›" : "⌄";
}

function openSidebar() {
  el.sidebar.classList.add("open");
  el.sidebarBackdrop.classList.add("visible");
}

function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.sidebarBackdrop.classList.remove("visible");
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function setBusy(active, message = "Working…") {
  state.busyCount += active ? 1 : -1;
  state.busyCount = Math.max(0, state.busyCount);
  let overlay = document.getElementById("loadingOverlay");
  if (state.busyCount > 0) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "loadingOverlay";
      overlay.className = "loading-overlay";
      overlay.innerHTML = `<div class="loading-pill"></div>`;
      document.body.appendChild(overlay);
    }
    overlay.querySelector(".loading-pill").textContent = message;
  } else {
    overlay?.remove();
  }
}

function toast(message, isError = false) {
  const node = document.createElement("div");
  node.className = `toast${isError ? " error" : ""}`;
  node.textContent = message;
  el.toastRegion.appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function handleError(error) {
  console.error(error);
  const message = error?.message || "Something went wrong.";
  toast(message, true);
  if (/access token|not configured|failed to fetch|networkerror/i.test(message)) renderConnectionStatus(false);
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function formatDateRange(start, end) {
  if (!start && !end) return "";
  if (start && end) return `${formatLongDate(start)} – ${formatLongDate(end)}`;
  return formatLongDate(start || end);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function groupBy(items, keyFunction) {
  const map = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

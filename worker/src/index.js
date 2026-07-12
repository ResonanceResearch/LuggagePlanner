const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const BAG_TYPES = new Set(["carry_on", "checked_luggage", "personal_item", "medication_kit", "custom"]);
const TRAVEL_MODES = new Set(["solo", "family"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "luggage-planner-api", databaseBound: Boolean(env.DB) }, 200, corsHeaders);
    }

    if (!env.DB) {
      return json({ error: "D1 binding DB is not configured." }, 503, corsHeaders);
    }

    const authError = authorize(request, env);
    if (authError) return json({ error: authError.message }, authError.status, corsHeaders);

    try {
      const result = await routeRequest(request, env.DB, url);
      return json(result.body, result.status ?? 200, corsHeaders);
    } catch (error) {
      console.error(error);
      const normalized = normalizeError(error);
      return json({ error: normalized.message, details: normalized.details }, normalized.status, corsHeaders);
    }
  }
};

async function routeRequest(request, db, url) {
  const { pathname, searchParams } = url;
  const method = request.method.toUpperCase();

  if (pathname === "/api/bootstrap" && method === "GET") {
    return { body: await getBootstrap(db) };
  }

  if (pathname === "/api/library" && method === "GET") {
    const includeArchived = searchParams.get("includeArchived") === "1";
    return { body: await getLibrary(db, includeArchived) };
  }

  if (pathname === "/api/categories" && method === "POST") {
    return { body: await createCategory(db, await readJson(request)), status: 201 };
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch && method === "PATCH") {
    return { body: await updateCategory(db, decodeURIComponent(categoryMatch[1]), await readJson(request)) };
  }
  if (categoryMatch && method === "DELETE") {
    return { body: await archiveCategory(db, decodeURIComponent(categoryMatch[1])) };
  }

  if (pathname === "/api/items" && method === "POST") {
    return { body: await createItem(db, await readJson(request)), status: 201 };
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && method === "PATCH") {
    return { body: await updateItem(db, decodeURIComponent(itemMatch[1]), await readJson(request)) };
  }
  if (itemMatch && method === "DELETE") {
    return { body: await archiveItem(db, decodeURIComponent(itemMatch[1])) };
  }

  if (pathname === "/api/trips" && method === "POST") {
    return { body: await createTrip(db, await readJson(request)), status: 201 };
  }

  const duplicateMatch = pathname.match(/^\/api\/trips\/([^/]+)\/duplicate$/);
  if (duplicateMatch && method === "POST") {
    return { body: await duplicateTrip(db, decodeURIComponent(duplicateMatch[1]), await readJson(request, true)), status: 201 };
  }

  const tripMatch = pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (tripMatch && method === "GET") {
    return { body: await getTripDetail(db, decodeURIComponent(tripMatch[1])) };
  }
  if (tripMatch && method === "PATCH") {
    return { body: await updateTrip(db, decodeURIComponent(tripMatch[1]), await readJson(request)) };
  }
  if (tripMatch && method === "DELETE") {
    return { body: await archiveTrip(db, decodeURIComponent(tripMatch[1])) };
  }

  const travelersCollection = pathname.match(/^\/api\/trips\/([^/]+)\/travelers$/);
  if (travelersCollection && method === "POST") {
    return { body: await createTraveler(db, decodeURIComponent(travelersCollection[1]), await readJson(request)), status: 201 };
  }

  const travelerMatch = pathname.match(/^\/api\/trips\/([^/]+)\/travelers\/([^/]+)$/);
  if (travelerMatch && method === "PATCH") {
    return {
      body: await updateTraveler(db, decodeURIComponent(travelerMatch[1]), decodeURIComponent(travelerMatch[2]), await readJson(request))
    };
  }
  if (travelerMatch && method === "DELETE") {
    return { body: await deleteTraveler(db, decodeURIComponent(travelerMatch[1]), decodeURIComponent(travelerMatch[2])) };
  }

  const bagsCollection = pathname.match(/^\/api\/trips\/([^/]+)\/bags$/);
  if (bagsCollection && method === "POST") {
    return { body: await createBag(db, decodeURIComponent(bagsCollection[1]), await readJson(request)), status: 201 };
  }

  const bagMatch = pathname.match(/^\/api\/trips\/([^/]+)\/bags\/([^/]+)$/);
  if (bagMatch && method === "PATCH") {
    return { body: await updateBag(db, decodeURIComponent(bagMatch[1]), decodeURIComponent(bagMatch[2]), await readJson(request)) };
  }
  if (bagMatch && method === "DELETE") {
    return { body: await deleteBag(db, decodeURIComponent(bagMatch[1]), decodeURIComponent(bagMatch[2])) };
  }

  const placementsCollection = pathname.match(/^\/api\/trips\/([^/]+)\/placements$/);
  if (placementsCollection && method === "POST") {
    return { body: await addPlacement(db, decodeURIComponent(placementsCollection[1]), await readJson(request)), status: 201 };
  }

  const placementMatch = pathname.match(/^\/api\/trips\/([^/]+)\/placements\/([^/]+)$/);
  if (placementMatch && method === "PATCH") {
    return {
      body: await updatePlacement(db, decodeURIComponent(placementMatch[1]), decodeURIComponent(placementMatch[2]), await readJson(request))
    };
  }
  if (placementMatch && method === "DELETE") {
    return { body: await deletePlacement(db, decodeURIComponent(placementMatch[1]), decodeURIComponent(placementMatch[2])) };
  }

  throw httpError(404, "Route not found.");
}

async function getBootstrap(db) {
  const [library, tripsResult] = await Promise.all([
    getLibrary(db, false),
    db.prepare(`
      SELECT
        t.*,
        (SELECT COUNT(*) FROM bags b WHERE b.trip_id = t.id) AS bag_count,
        (SELECT COUNT(*) FROM trip_items ti WHERE ti.trip_id = t.id) AS placement_count,
        (SELECT COALESCE(SUM(CASE WHEN ti.is_packed = 1 THEN 1 ELSE 0 END), 0)
           FROM trip_items ti WHERE ti.trip_id = t.id) AS packed_count
      FROM trips t
      ORDER BY CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
               COALESCE(t.start_date, '9999-12-31') ASC,
               t.created_at DESC
    `).all()
  ]);
  return { ...library, trips: tripsResult.results ?? [] };
}

async function getLibrary(db, includeArchived) {
  const archiveClause = includeArchived ? "" : "WHERE archived_at IS NULL";
  const [categoriesResult, itemsResult] = await db.batch([
    db.prepare(`SELECT * FROM categories ${archiveClause} ORDER BY sort_order, name COLLATE NOCASE`),
    db.prepare(`SELECT * FROM items ${archiveClause} ORDER BY name COLLATE NOCASE`)
  ]);
  return {
    categories: categoriesResult.results ?? [],
    items: itemsResult.results ?? []
  };
}

async function createCategory(db, body) {
  const name = requiredText(body.name, "Category name", 80);
  const icon = optionalText(body.icon, 12) || "📦";
  const sortOrder = integer(body.sortOrder, 0, 100000, 999);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO categories (id, name, icon, sort_order, is_system)
    VALUES (?, ?, ?, ?, 0)
  `).bind(id, name, icon, sortOrder).run();
  return getOne(db, "SELECT * FROM categories WHERE id = ?", id);
}

async function updateCategory(db, id, body) {
  const current = await mustGet(db, "SELECT * FROM categories WHERE id = ?", id, "Category not found.");
  const name = body.name === undefined ? current.name : requiredText(body.name, "Category name", 80);
  const icon = body.icon === undefined ? current.icon : (optionalText(body.icon, 12) || "📦");
  const sortOrder = body.sortOrder === undefined ? current.sort_order : integer(body.sortOrder, 0, 100000, current.sort_order);
  const archivedAt = body.archived === undefined ? current.archived_at : (body.archived ? nowIso() : null);

  await db.prepare(`
    UPDATE categories SET name = ?, icon = ?, sort_order = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, icon, sortOrder, archivedAt, id).run();
  return getOne(db, "SELECT * FROM categories WHERE id = ?", id);
}

async function archiveCategory(db, id) {
  const category = await mustGet(db, "SELECT * FROM categories WHERE id = ?", id, "Category not found.");
  if (category.is_system) throw httpError(400, "Built-in categories cannot be archived, but they can be renamed.");
  const count = await getOne(db, "SELECT COUNT(*) AS count FROM items WHERE category_id = ? AND archived_at IS NULL", id);
  if (Number(count.count) > 0) throw httpError(409, "Move or archive the active items in this category first.");
  await db.prepare("UPDATE categories SET archived_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nowIso(), id).run();
  return { ok: true };
}

async function createItem(db, body) {
  const name = requiredText(body.name, "Item name", 120);
  const categoryId = requiredText(body.categoryId, "Category", 80);
  await mustGet(db, "SELECT id FROM categories WHERE id = ? AND archived_at IS NULL", categoryId, "Active category not found.");
  const id = crypto.randomUUID();
  const quantity = integer(body.defaultQuantity, 1, 999, 1);
  const essential = Boolean(body.isEssential) ? 1 : 0;
  const notes = optionalText(body.notes, 500);
  await db.prepare(`
    INSERT INTO items (id, name, category_id, notes, default_quantity, is_essential)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, categoryId, notes, quantity, essential).run();
  return getOne(db, "SELECT * FROM items WHERE id = ?", id);
}

async function updateItem(db, id, body) {
  const current = await mustGet(db, "SELECT * FROM items WHERE id = ?", id, "Item not found.");
  const name = body.name === undefined ? current.name : requiredText(body.name, "Item name", 120);
  const categoryId = body.categoryId === undefined ? current.category_id : requiredText(body.categoryId, "Category", 80);
  await mustGet(db, "SELECT id FROM categories WHERE id = ? AND archived_at IS NULL", categoryId, "Active category not found.");
  const notes = body.notes === undefined ? current.notes : optionalText(body.notes, 500);
  const quantity = body.defaultQuantity === undefined
    ? current.default_quantity
    : integer(body.defaultQuantity, 1, 999, current.default_quantity);
  const essential = body.isEssential === undefined ? current.is_essential : (Boolean(body.isEssential) ? 1 : 0);
  const archivedAt = body.archived === undefined ? current.archived_at : (body.archived ? nowIso() : null);

  await db.prepare(`
    UPDATE items
    SET name = ?, category_id = ?, notes = ?, default_quantity = ?, is_essential = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, categoryId, notes, quantity, essential, archivedAt, id).run();
  return getOne(db, "SELECT * FROM items WHERE id = ?", id);
}

async function archiveItem(db, id) {
  await mustGet(db, "SELECT id FROM items WHERE id = ?", id, "Item not found.");
  await db.prepare("UPDATE items SET archived_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nowIso(), id).run();
  return { ok: true };
}

async function createTrip(db, body) {
  const name = requiredText(body.name, "Trip name", 120);
  const destination = optionalText(body.destination, 160);
  const startDate = nullableDate(body.startDate, "Start date");
  const endDate = nullableDate(body.endDate, "End date");
  if (startDate && endDate && endDate < startDate) throw httpError(400, "End date cannot be before start date.");
  const travelMode = TRAVEL_MODES.has(body.travelMode) ? body.travelMode : "solo";
  const notes = optionalText(body.notes, 1500);
  let travelerNames = Array.isArray(body.travelerNames)
    ? body.travelerNames.map((value) => optionalText(value, 80)).filter(Boolean)
    : [];
  if (travelerNames.length === 0) travelerNames = travelMode === "solo" ? ["Me"] : ["Traveller 1", "Traveller 2"];
  if (travelerNames.length > 20) throw httpError(400, "A trip can have at most 20 travellers.");

  const tripId = crypto.randomUUID();
  const statements = [
    db.prepare(`
      INSERT INTO trips (id, name, destination, start_date, end_date, travel_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(tripId, name, destination, startDate, endDate, travelMode, notes)
  ];

  const travelers = travelerNames.map((travelerName, index) => ({
    id: crypto.randomUUID(), name: travelerName, sortOrder: index
  }));

  for (const traveler of travelers) {
    statements.push(db.prepare(`
      INSERT INTO travelers (id, trip_id, name, color_index, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).bind(traveler.id, tripId, traveler.name, traveler.sortOrder % 8, traveler.sortOrder));
  }

  let bagOrder = 0;
  if (travelMode === "family") {
    for (const traveler of travelers) {
      statements.push(makeBagStatement(db, tripId, traveler.id, `${traveler.name} — Carry-on`, "carry_on", 0, bagOrder++));
      statements.push(makeBagStatement(db, tripId, traveler.id, `${traveler.name} — Personal item`, "personal_item", 0, bagOrder++));
    }
    statements.push(makeBagStatement(db, tripId, null, "Shared luggage", "checked_luggage", 1, bagOrder++));
    statements.push(makeBagStatement(db, tripId, null, "Shared medication kit", "medication_kit", 1, bagOrder++));
  } else {
    const ownerId = travelers[0].id;
    statements.push(makeBagStatement(db, tripId, ownerId, "Carry-on", "carry_on", 0, bagOrder++));
    statements.push(makeBagStatement(db, tripId, ownerId, "Checked luggage", "checked_luggage", 0, bagOrder++));
    statements.push(makeBagStatement(db, tripId, ownerId, "Personal item", "personal_item", 0, bagOrder++));
    statements.push(makeBagStatement(db, tripId, ownerId, "Medication kit", "medication_kit", 0, bagOrder++));
  }

  await runStatementBatches(db, statements);
  return getTripDetail(db, tripId);
}

function makeBagStatement(db, tripId, ownerId, name, bagType, isShared, sortOrder) {
  return db.prepare(`
    INSERT INTO bags (id, trip_id, owner_traveler_id, name, bag_type, is_shared, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), tripId, ownerId, name, bagType, isShared, sortOrder);
}

async function getTripDetail(db, tripId) {
  const trip = await mustGet(db, "SELECT * FROM trips WHERE id = ?", tripId, "Trip not found.");
  const [travelersResult, bagsResult, placementsResult] = await db.batch([
    db.prepare("SELECT * FROM travelers WHERE trip_id = ? ORDER BY sort_order, name COLLATE NOCASE").bind(tripId),
    db.prepare(`
      SELECT b.*, tr.name AS owner_name
      FROM bags b
      LEFT JOIN travelers tr ON tr.id = b.owner_traveler_id
      WHERE b.trip_id = ?
      ORDER BY b.sort_order, b.name COLLATE NOCASE
    `).bind(tripId),
    db.prepare(`
      SELECT ti.*, i.name AS item_name, i.category_id, i.is_essential, c.name AS category_name, c.icon AS category_icon
      FROM trip_items ti
      JOIN items i ON i.id = ti.item_id
      JOIN categories c ON c.id = i.category_id
      WHERE ti.trip_id = ?
      ORDER BY i.name COLLATE NOCASE
    `).bind(tripId)
  ]);
  return {
    trip,
    travelers: travelersResult.results ?? [],
    bags: bagsResult.results ?? [],
    placements: placementsResult.results ?? []
  };
}

async function updateTrip(db, tripId, body) {
  const current = await mustGet(db, "SELECT * FROM trips WHERE id = ?", tripId, "Trip not found.");
  const name = body.name === undefined ? current.name : requiredText(body.name, "Trip name", 120);
  const destination = body.destination === undefined ? current.destination : optionalText(body.destination, 160);
  const startDate = body.startDate === undefined ? current.start_date : nullableDate(body.startDate, "Start date");
  const endDate = body.endDate === undefined ? current.end_date : nullableDate(body.endDate, "End date");
  if (startDate && endDate && endDate < startDate) throw httpError(400, "End date cannot be before start date.");
  const notes = body.notes === undefined ? current.notes : optionalText(body.notes, 1500);
  const status = body.status === undefined ? current.status : (body.status === "archived" ? "archived" : "active");

  await db.prepare(`
    UPDATE trips
    SET name = ?, destination = ?, start_date = ?, end_date = ?, notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, destination, startDate, endDate, notes, status, tripId).run();
  return getTripDetail(db, tripId);
}

async function archiveTrip(db, tripId) {
  await mustGet(db, "SELECT id FROM trips WHERE id = ?", tripId, "Trip not found.");
  await db.prepare("UPDATE trips SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(tripId).run();
  return { ok: true };
}

async function duplicateTrip(db, tripId, body) {
  const source = await getTripDetail(db, tripId);
  const newTripId = crypto.randomUUID();
  const name = optionalText(body?.name, 120) || `${source.trip.name} — copy`;
  const startDate = body?.startDate === undefined ? null : nullableDate(body.startDate, "Start date");
  const endDate = body?.endDate === undefined ? null : nullableDate(body.endDate, "End date");
  if (startDate && endDate && endDate < startDate) throw httpError(400, "End date cannot be before start date.");

  const statements = [
    db.prepare(`
      INSERT INTO trips (id, name, destination, start_date, end_date, travel_mode, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(newTripId, name, source.trip.destination, startDate, endDate, source.trip.travel_mode, source.trip.notes)
  ];

  const travelerMap = new Map();
  for (const traveler of source.travelers) {
    const newId = crypto.randomUUID();
    travelerMap.set(traveler.id, newId);
    statements.push(db.prepare(`
      INSERT INTO travelers (id, trip_id, name, color_index, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).bind(newId, newTripId, traveler.name, traveler.color_index, traveler.sort_order));
  }

  const bagMap = new Map();
  for (const bag of source.bags) {
    const newId = crypto.randomUUID();
    bagMap.set(bag.id, newId);
    statements.push(db.prepare(`
      INSERT INTO bags (id, trip_id, owner_traveler_id, name, bag_type, is_shared, capacity_note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId,
      newTripId,
      bag.owner_traveler_id ? travelerMap.get(bag.owner_traveler_id) ?? null : null,
      bag.name,
      bag.bag_type,
      bag.is_shared,
      bag.capacity_note,
      bag.sort_order
    ));
  }

  for (const placement of source.placements) {
    statements.push(db.prepare(`
      INSERT INTO trip_items (id, trip_id, item_id, bag_id, quantity, is_packed, notes)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).bind(crypto.randomUUID(), newTripId, placement.item_id, bagMap.get(placement.bag_id), placement.quantity, placement.notes));
  }

  await runStatementBatches(db, statements);
  return getTripDetail(db, newTripId);
}

async function createTraveler(db, tripId, body) {
  await mustGet(db, "SELECT id FROM trips WHERE id = ?", tripId, "Trip not found.");
  const name = requiredText(body.name, "Traveller name", 80);
  const maxOrder = await getOne(db, "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM travelers WHERE trip_id = ?", tripId);
  const sortOrder = Number(maxOrder.max_order) + 1;
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO travelers (id, trip_id, name, color_index, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, tripId, name, sortOrder % 8, sortOrder).run();
  return getTripDetail(db, tripId);
}

async function updateTraveler(db, tripId, travelerId, body) {
  const current = await mustGet(
    db,
    "SELECT * FROM travelers WHERE id = ? AND trip_id = ?",
    [travelerId, tripId],
    "Traveller not found."
  );
  const name = body.name === undefined ? current.name : requiredText(body.name, "Traveller name", 80);
  const sortOrder = body.sortOrder === undefined ? current.sort_order : integer(body.sortOrder, 0, 1000, current.sort_order);
  await db.prepare("UPDATE travelers SET name = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND trip_id = ?")
    .bind(name, sortOrder, travelerId, tripId).run();
  return getTripDetail(db, tripId);
}

async function deleteTraveler(db, tripId, travelerId) {
  await mustGet(db, "SELECT id FROM travelers WHERE id = ? AND trip_id = ?", [travelerId, tripId], "Traveller not found.");
  const count = await getOne(db, "SELECT COUNT(*) AS count FROM travelers WHERE trip_id = ?", tripId);
  if (Number(count.count) <= 1) throw httpError(409, "A trip must keep at least one traveller.");
  await db.batch([
    db.prepare(`
      UPDATE bags
      SET owner_traveler_id = NULL, is_shared = 1, updated_at = CURRENT_TIMESTAMP
      WHERE trip_id = ? AND owner_traveler_id = ?
    `).bind(tripId, travelerId),
    db.prepare("DELETE FROM travelers WHERE id = ? AND trip_id = ?").bind(travelerId, tripId)
  ]);
  return getTripDetail(db, tripId);
}

async function createBag(db, tripId, body) {
  await mustGet(db, "SELECT id FROM trips WHERE id = ?", tripId, "Trip not found.");
  const name = requiredText(body.name, "Bag name", 100);
  const bagType = BAG_TYPES.has(body.bagType) ? body.bagType : "custom";
  const isShared = Boolean(body.isShared) ? 1 : 0;
  const ownerId = isShared ? null : (body.ownerTravelerId || null);
  if (ownerId) {
    await mustGet(db, "SELECT id FROM travelers WHERE id = ? AND trip_id = ?", [ownerId, tripId], "Bag owner not found.");
  }
  const maxOrder = await getOne(db, "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM bags WHERE trip_id = ?", tripId);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO bags (id, trip_id, owner_traveler_id, name, bag_type, is_shared, capacity_note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, tripId, ownerId, name, bagType, isShared, optionalText(body.capacityNote, 160), Number(maxOrder.max_order) + 1).run();
  return getTripDetail(db, tripId);
}

async function updateBag(db, tripId, bagId, body) {
  const current = await mustGet(db, "SELECT * FROM bags WHERE id = ? AND trip_id = ?", [bagId, tripId], "Bag not found.");
  const name = body.name === undefined ? current.name : requiredText(body.name, "Bag name", 100);
  const bagType = body.bagType === undefined ? current.bag_type : (BAG_TYPES.has(body.bagType) ? body.bagType : "custom");
  const isShared = body.isShared === undefined ? current.is_shared : (Boolean(body.isShared) ? 1 : 0);
  let ownerId = body.ownerTravelerId === undefined ? current.owner_traveler_id : (body.ownerTravelerId || null);
  if (isShared) ownerId = null;
  if (ownerId) {
    await mustGet(db, "SELECT id FROM travelers WHERE id = ? AND trip_id = ?", [ownerId, tripId], "Bag owner not found.");
  }
  const capacityNote = body.capacityNote === undefined ? current.capacity_note : optionalText(body.capacityNote, 160);
  const sortOrder = body.sortOrder === undefined ? current.sort_order : integer(body.sortOrder, 0, 1000, current.sort_order);
  await db.prepare(`
    UPDATE bags
    SET name = ?, bag_type = ?, is_shared = ?, owner_traveler_id = ?, capacity_note = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND trip_id = ?
  `).bind(name, bagType, isShared, ownerId, capacityNote, sortOrder, bagId, tripId).run();
  return getTripDetail(db, tripId);
}

async function deleteBag(db, tripId, bagId) {
  await mustGet(db, "SELECT id FROM bags WHERE id = ? AND trip_id = ?", [bagId, tripId], "Bag not found.");
  await db.prepare("DELETE FROM bags WHERE id = ? AND trip_id = ?").bind(bagId, tripId).run();
  return getTripDetail(db, tripId);
}

async function addPlacement(db, tripId, body) {
  await mustGet(db, "SELECT id FROM trips WHERE id = ?", tripId, "Trip not found.");
  const itemId = requiredText(body.itemId, "Item", 80);
  const bagId = requiredText(body.bagId, "Bag", 80);
  const quantity = integer(body.quantity, 1, 999, 1);
  await mustGet(db, "SELECT id FROM items WHERE id = ? AND archived_at IS NULL", itemId, "Active item not found.");
  await mustGet(db, "SELECT id FROM bags WHERE id = ? AND trip_id = ?", [bagId, tripId], "Bag not found.");

  await db.prepare(`
    INSERT INTO trip_items (id, trip_id, item_id, bag_id, quantity, is_packed, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(trip_id, item_id, bag_id)
    DO UPDATE SET quantity = trip_items.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
  `).bind(crypto.randomUUID(), tripId, itemId, bagId, quantity, optionalText(body.notes, 500)).run();
  return getTripDetail(db, tripId);
}

async function updatePlacement(db, tripId, placementId, body) {
  const current = await mustGet(
    db,
    "SELECT * FROM trip_items WHERE id = ? AND trip_id = ?",
    [placementId, tripId],
    "Packed item not found."
  );
  const quantity = body.quantity === undefined ? current.quantity : integer(body.quantity, 1, 999, current.quantity);
  const packed = body.isPacked === undefined ? current.is_packed : (Boolean(body.isPacked) ? 1 : 0);
  const notes = body.notes === undefined ? current.notes : optionalText(body.notes, 500);
  const bagId = body.bagId === undefined ? current.bag_id : requiredText(body.bagId, "Bag", 80);
  await mustGet(db, "SELECT id FROM bags WHERE id = ? AND trip_id = ?", [bagId, tripId], "Destination bag not found.");

  if (bagId !== current.bag_id) {
    const existing = await getOne(db, "SELECT * FROM trip_items WHERE trip_id = ? AND item_id = ? AND bag_id = ?", [tripId, current.item_id, bagId]);
    if (existing) {
      await db.batch([
        db.prepare(`
          UPDATE trip_items
          SET quantity = quantity + ?, is_packed = CASE WHEN ? = 1 THEN 1 ELSE is_packed END, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(quantity, packed, existing.id),
        db.prepare("DELETE FROM trip_items WHERE id = ?").bind(placementId)
      ]);
    } else {
      await db.prepare(`
        UPDATE trip_items
        SET bag_id = ?, quantity = ?, is_packed = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND trip_id = ?
      `).bind(bagId, quantity, packed, notes, placementId, tripId).run();
    }
  } else {
    await db.prepare(`
      UPDATE trip_items
      SET quantity = ?, is_packed = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND trip_id = ?
    `).bind(quantity, packed, notes, placementId, tripId).run();
  }
  return getTripDetail(db, tripId);
}

async function deletePlacement(db, tripId, placementId) {
  await mustGet(db, "SELECT id FROM trip_items WHERE id = ? AND trip_id = ?", [placementId, tripId], "Packed item not found.");
  await db.prepare("DELETE FROM trip_items WHERE id = ? AND trip_id = ?").bind(placementId, tripId).run();
  return getTripDetail(db, tripId);
}


async function runStatementBatches(db, statements, chunkSize = 50) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

function authorize(request, env) {
  if (!env.APP_ACCESS_TOKEN) {
    return { status: 503, message: "Worker secret APP_ACCESS_TOKEN is not configured." };
  }
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !constantTimeEqual(provided, env.APP_ACCESS_TOKEN)) {
    return { status: 401, message: "Invalid or missing access token." };
  }
  return null;
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return mismatch === 0;
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const configured = String(env.ALLOWED_ORIGIN || "").trim();
  const allowed = new Set(configured.split(",").map((entry) => entry.trim()).filter(Boolean));
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowOrigin = allowed.has("*") ? "*" : (allowed.has(origin) || local ? origin : (allowed.values().next().value || "null"));
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

async function readJson(request, allowEmpty = false) {
  const text = await request.text();
  if (!text.trim()) {
    if (allowEmpty) return {};
    throw httpError(400, "A JSON request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error?.status) return error;
  const message = String(error?.message || error || "Unexpected error.");
  if (/UNIQUE constraint failed/i.test(message)) return httpError(409, "That name already exists in this location.");
  if (/FOREIGN KEY constraint failed/i.test(message)) return httpError(409, "This record is still in use and cannot be removed.");
  return httpError(500, "Unexpected server error.", message);
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, `${label} is required.`);
  if (text.length > maxLength) throw httpError(400, `${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw httpError(400, `Text must be ${maxLength} characters or fewer.`);
  return text;
}

function integer(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw httpError(400, `Number must be a whole value between ${min} and ${max}.`);
  }
  return number;
}

function nullableDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, `${label} must use YYYY-MM-DD.`);
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

async function getOne(db, sql, params = []) {
  const values = Array.isArray(params) ? params : [params];
  return db.prepare(sql).bind(...values).first();
}

async function mustGet(db, sql, params, message) {
  const row = await getOne(db, sql, params);
  if (!row) throw httpError(404, message);
  return row;
}


const express = require("express");
const db = require("./database");
const { requireAdmin } = require("./admin-auth");

const router = express.Router();

function validText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function optionalText(value, maxLength) {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= maxLength)
  );
}

// Public: list published events.
router.get("/events", (req, res) => {
  const events = db.prepare(`
    SELECT id, title, description, event_date, location, poster_url
    FROM church_events
    WHERE published = 1
    ORDER BY event_date ASC
  `).all();

  res.json({ success: true, events });
});

// Public: list published announcements.
router.get("/announcements", (req, res) => {
  const announcements = db.prepare(`
    SELECT id, title, message, poster_url, created_at
    FROM church_announcements
    WHERE published = 1
    ORDER BY created_at DESC
  `).all();

  res.json({ success: true, announcements });
});

// Admin: create an event. New events remain unpublished.
router.post("/events", requireAdmin, (req, res) => {
  const { title, description = "", event_date, location = "", poster_url = "" } =
    req.body || {};

  if (
    !validText(title, 150) ||
    !validText(event_date, 40) ||
    !optionalText(description, 5000) ||
    !optionalText(location, 200) ||
    !optionalText(poster_url, 1000)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a title, event date, and valid optional fields.",
    });
  }

  const result = db.prepare(`
    INSERT INTO church_events
      (title, description, event_date, location, poster_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description.trim(),
    event_date.trim(),
    location.trim(),
    poster_url.trim()
  );

  res.status(201).json({
    success: true,
    message: "Event saved as unpublished.",
    id: result.lastInsertRowid,
  });
});

// Admin: create an announcement. New announcements remain unpublished.
router.post("/announcements", requireAdmin, (req, res) => {
  const { title, message, poster_url = "" } = req.body || {};

  if (
    !validText(title, 150) ||
    !validText(message, 5000) ||
    !optionalText(poster_url, 1000)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a title, message, and valid poster URL.",
    });
  }

  const result = db.prepare(`
    INSERT INTO church_announcements (title, message, poster_url)
    VALUES (?, ?, ?)
  `).run(title.trim(), message.trim(), poster_url.trim());

  res.status(201).json({
    success: true,
    message: "Announcement saved as unpublished.",
    id: result.lastInsertRowid,
  });
});

// Admin: list all events, including unpublished drafts.
router.get("/admin/events", requireAdmin, (req, res) => {
  const events = db.prepare(`
    SELECT * FROM church_events ORDER BY created_at DESC
  `).all();

  res.json({ success: true, events });
});

// Admin: list all announcements, including unpublished drafts.
router.get("/admin/announcements", requireAdmin, (req, res) => {
  const announcements = db.prepare(`
    SELECT * FROM church_announcements ORDER BY created_at DESC
  `).all();

  res.json({ success: true, announcements });
});


function setPublishedStatus(table, id, published, res) {
  const recordId = Number(id);

  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid content ID.",
    });
  }

  if (typeof published !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Published must be true or false.",
    });
  }

  const result = db.prepare(`
    UPDATE ${table}
    SET published = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(published ? 1 : 0, recordId);

  if (result.changes === 0) {
    return res.status(404).json({
      success: false,
      message: "Content not found.",
    });
  }

  return res.json({
    success: true,
    message: published ? "Content published." : "Content unpublished.",
  });
}

// Admin: publish or unpublish an event.
router.patch("/events/:id/publish", requireAdmin, (req, res) => {
  setPublishedStatus(
    "church_events",
    req.params.id,
    req.body?.published,
    res
  );
});

// Admin: publish or unpublish an announcement.
router.patch("/announcements/:id/publish", requireAdmin, (req, res) => {
  setPublishedStatus(
    "church_announcements",
    req.params.id,
    req.body?.published,
    res
  );
});

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Admin: edit an existing event.
router.put("/events/:id", requireAdmin, (req, res) => {
  const id = validId(req.params.id);
  const { title, description, event_date, location, poster_url } = req.body || {};

  if (
    !id ||
    !validText(title, 150) ||
    !validText(event_date, 40) ||
    !optionalText(description, 5000) ||
    !optionalText(location, 200) ||
    !optionalText(poster_url, 1000)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid ID, title, event date, and optional fields.",
    });
  }

  const result = db.prepare(`
    UPDATE church_events
    SET title = ?, description = ?, event_date = ?,
        location = ?, poster_url = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title.trim(),
    (description || "").trim(),
    event_date.trim(),
    (location || "").trim(),
    (poster_url || "").trim(),
    id
  );

  if (!result.changes) {
    return res.status(404).json({ success: false, message: "Event not found." });
  }

  res.json({ success: true, message: "Event updated." });
});

// Admin: edit an existing announcement.
router.put("/announcements/:id", requireAdmin, (req, res) => {
  const id = validId(req.params.id);
  const { title, message, poster_url } = req.body || {};

  if (
    !id ||
    !validText(title, 150) ||
    !validText(message, 5000) ||
    !optionalText(poster_url, 1000)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid ID, title, message, and poster URL.",
    });
  }

  const result = db.prepare(`
    UPDATE church_announcements
    SET title = ?, message = ?, poster_url = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title.trim(), message.trim(), (poster_url || "").trim(), id);

  if (!result.changes) {
    return res.status(404).json({
      success: false,
      message: "Announcement not found.",
    });
  }

  res.json({ success: true, message: "Announcement updated." });
});

// Admin: delete an event.
router.delete("/events/:id", requireAdmin, (req, res) => {
  const id = validId(req.params.id);

  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid event ID." });
  }

  const result = db.prepare("DELETE FROM church_events WHERE id = ?").run(id);

  if (!result.changes) {
    return res.status(404).json({ success: false, message: "Event not found." });
  }

  res.json({ success: true, message: "Event deleted." });
});

// Admin: delete an announcement.
router.delete("/announcements/:id", requireAdmin, (req, res) => {
  const id = validId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid announcement ID.",
    });
  }

  const result = db.prepare(
    "DELETE FROM church_announcements WHERE id = ?"
  ).run(id);

  if (!result.changes) {
    return res.status(404).json({
      success: false,
      message: "Announcement not found.",
    });
  }

  res.json({ success: true, message: "Announcement deleted." });
});

module.exports = router;

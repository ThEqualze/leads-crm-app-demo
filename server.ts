import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("leads.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'New',
    value REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    meeting_date DATETIME NOT NULL,
    notes TEXT,
    is_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS lead_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes - Leads
  app.get("/api/leads", (req, res) => {
    try {
      const leads = db.prepare("SELECT * FROM leads ORDER BY updated_at DESC").all();
      res.json(leads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  app.get("/api/leads/:id/notes", (req, res) => {
    const { id } = req.params;
    try {
      const notes = db.prepare("SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC").all(id);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lead notes" });
    }
  });

  app.post("/api/leads/:id/notes", (req, res) => {
    const { id } = req.params;
    const { content, type } = req.body;
    try {
      const info = db.prepare(`
        INSERT INTO lead_notes (lead_id, content, type)
        VALUES (?, ?, ?)
      `).run(id, content, type || 'general');

      const newNote = db.prepare("SELECT * FROM lead_notes WHERE id = ?").get(info.lastInsertRowid);
      res.status(201).json(newNote);
    } catch (error) {
      res.status(500).json({ error: "Failed to create lead note" });
    }
  });

  // API Routes - Meetings
  app.get("/api/meetings", (req, res) => {
    try {
      const meetings = db.prepare(`
        SELECT m.*, l.name as lead_name, l.company as lead_company 
        FROM meetings m
        JOIN leads l ON m.lead_id = l.id
        ORDER BY m.meeting_date ASC
      `).all();
      res.json(meetings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch meetings" });
    }
  });

  app.post("/api/meetings", (req, res) => {
    const { lead_id, title, meeting_date, notes } = req.body;
    try {
      const info = db.prepare(`
        INSERT INTO meetings (lead_id, title, meeting_date, notes)
        VALUES (?, ?, ?, ?)
      `).run(lead_id, title, meeting_date, notes || '');

      if (notes) {
        db.prepare(`
          INSERT INTO lead_notes (lead_id, content, type)
          VALUES (?, ?, ?)
        `).run(lead_id, `Meeting Scheduled: ${title}\n\nNotes: ${notes}`, 'meeting');
      }

      const newMeeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(info.lastInsertRowid);
      res.status(201).json(newMeeting);
    } catch (error) {
      res.status(500).json({ error: "Failed to create meeting" });
    }
  });

  app.put("/api/meetings/:id", (req, res) => {
    const { id } = req.params;
    const { title, meeting_date, notes, is_completed } = req.body;
    try {
      const oldMeeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);

      db.prepare(`
        UPDATE meetings 
        SET title = ?, meeting_date = ?, notes = ?, is_completed = ?
        WHERE id = ?
      `).run(title, meeting_date, notes, is_completed ? 1 : 0, id);

      // If notes changed or meeting completed, add to log
      if (notes && notes !== oldMeeting.notes) {
        db.prepare(`
          INSERT INTO lead_notes (lead_id, content, type)
          VALUES (?, ?, ?)
        `).run(oldMeeting.lead_id, `Meeting Update: ${title}\n\nNotes: ${notes}`, 'meeting');
      } else if (is_completed && !oldMeeting.is_completed) {
        db.prepare(`
          INSERT INTO lead_notes (lead_id, content, type)
          VALUES (?, ?, ?)
        `).run(oldMeeting.lead_id, `Meeting Completed: ${title}`, 'meeting');
      }

      const updatedMeeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
      res.json(updatedMeeting);
    } catch (error) {
      res.status(500).json({ error: "Failed to update meeting" });
    }
  });

  app.delete("/api/meetings/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete meeting" });
    }
  });

  app.post("/api/leads", (req, res) => {
    const { name, company, email, phone, status, value, notes } = req.body;
    try {
      const info = db.prepare(`
        INSERT INTO leads (name, company, email, phone, status, value, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(name, company, email, phone, status || 'New', value || 0, notes || '');

      const leadId = info.lastInsertRowid;
      if (notes) {
        db.prepare(`
          INSERT INTO lead_notes (lead_id, content, type)
          VALUES (?, ?, ?)
        `).run(leadId, notes, 'general');
      }

      const newLead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
      res.status(201).json(newLead);
    } catch (error) {
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  app.put("/api/leads/:id", (req, res) => {
    const { id } = req.params;
    const { name, company, email, phone, status, value, notes } = req.body;
    try {
      const oldLead = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);

      db.prepare(`
        UPDATE leads 
        SET name = ?, company = ?, email = ?, phone = ?, status = ?, value = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, company, email, phone, status, value, notes, id);

      if (notes && notes !== oldLead.notes) {
        db.prepare(`
          INSERT INTO lead_notes (lead_id, content, type)
          VALUES (?, ?, ?)
        `).run(id, notes, 'general');
      }

      const updatedLead = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
      res.json(updatedLead);
    } catch (error) {
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  app.delete("/api/leads/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM leads WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete lead" });
    }
  });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "admin123");
  if (!ADMIN_PASSWORD && process.env.NODE_ENV === "production") {
    throw new Error("FATAL: ADMIN_PASSWORD environment variable must be set in production.");
  }

  function timingSafeCompare(a: string, b: string): boolean {
    if (!a || !b) return false;
    const hashA = crypto.createHash("sha256").update(a).digest();
    const hashB = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }

  function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    let token = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    } else if (req.headers["x-admin-password"]) {
      token = String(req.headers["x-admin-password"]).trim();
    }

    if (!token || !timingSafeCompare(token, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: "Unauthorized: Invalid admin credentials" });
    }

    next();
  }

  function sanitizeCsvField(value: any): string {
    if (value === null || value === undefined) {
      return '""';
    }
    let str = String(value);
    // Neutralize formula injection (=, +, -, @, \t, \r), checking trimmed string for leading triggers
    if (/^[=+\-@\t\r]/.test(str.trim())) {
      str = "'" + str;
    }
    // Escape internal double quotes
    return `"${str.replace(/"/g, '""')}"`;
  }

  app.post("/api/admin/import", requireAdminAuth, (req, res) => {
    const { leads } = req.body;

    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: "leads must be an array" });
    }

    if (leads.length === 0) {
      return res.status(400).json({ error: "leads array cannot be empty" });
    }

    const MAX_BATCH_SIZE = 500;
    if (leads.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Import payload exceeds maximum batch size of ${MAX_BATCH_SIZE} leads`,
      });
    }

    const ALLOWED_STATUSES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      if (!lead || typeof lead !== "object") {
        return res.status(400).json({ error: `Invalid lead at index ${i}: must be an object` });
      }
      if (!lead.name || typeof lead.name !== "string" || !lead.name.trim()) {
        return res.status(400).json({ error: `Invalid lead at index ${i}: name is required and must be non-empty` });
      }
      if (lead.status && !ALLOWED_STATUSES.includes(lead.status)) {
        return res.status(400).json({ error: `Invalid status at index ${i}: must be one of ${ALLOWED_STATUSES.join(", ")}` });
      }
    }

    try {
      const insertStmt = db.prepare(`
        INSERT INTO leads (name, company, email, phone, status, value, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertNoteStmt = db.prepare(`
        INSERT INTO lead_notes (lead_id, content, type)
        VALUES (?, ?, ?)
      `);

      const insertMany = db.transaction((leadList: any[]) => {
        const results = [];
        for (const lead of leadList) {
          const notesContent = lead.notes ? String(lead.notes) : "";
          const info = insertStmt.run(
            lead.name.trim(),
            lead.company ? String(lead.company).trim() : null,
            lead.email ? String(lead.email).trim() : null,
            lead.phone ? String(lead.phone).trim() : null,
            lead.status || "New",
            typeof lead.value === "number" && !isNaN(lead.value) ? lead.value : 0,
            notesContent
          );
          const leadId = info.lastInsertRowid;
          results.push(leadId);

          if (notesContent.trim()) {
            insertNoteStmt.run(leadId, notesContent.trim(), "general");
          }
        }
        return results;
      });

      const importedIds = insertMany(leads);

      console.log(`[import] Bulk import complete: ${importedIds.length} leads imported successfully`);
      res.status(201).json({
        message: `Successfully imported ${importedIds.length} leads`,
        count: importedIds.length,
        ids: importedIds,
      });
    } catch (error: any) {
      console.error("[import] Error performing bulk import:", error);
      res.status(500).json({ error: "Import failed" });
    }
  });

  app.get("/api/admin/export", requireAdminAuth, (req, res) => {
    try {
      const leads = db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();

      const requestedFilename = typeof req.query.filename === "string" ? req.query.filename : "leads_export.csv";
      const safeBasename = path.basename(requestedFilename).replace(/[^a-zA-Z0-9_\-.]/g, "") || "leads_export.csv";
      const finalFilename = safeBasename.endsWith(".csv") ? safeBasename : `${safeBasename}.csv`;

      const headers = "id,name,company,email,phone,status,value,notes,created_at\n";
      const rows = leads
        .map((l: any) => [
          l.id,
          sanitizeCsvField(l.name),
          sanitizeCsvField(l.company),
          sanitizeCsvField(l.email),
          sanitizeCsvField(l.phone),
          sanitizeCsvField(l.status),
          typeof l.value === "number" ? l.value : 0,
          sanitizeCsvField(l.notes),
          sanitizeCsvField(l.created_at),
        ].join(","))
        .join("\n");

      console.log(`[export] Exported ${leads.length} leads to ${finalFilename}`);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${finalFilename}"`);
      res.send(headers + rows);
    } catch (error: any) {
      console.error("[export] Error generating export:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.get("/api/admin/stats", requireAdminAuth, (req, res) => {
    try {
      const totalLeads = db.prepare("SELECT COUNT(*) as count FROM leads").get() as any;
      const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM leads GROUP BY status").all();
      const totalValue = db.prepare("SELECT SUM(value) as total FROM leads").get() as any;
      const recentLeads = db.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 10").all();
      const totalMeetings = db.prepare("SELECT COUNT(*) as count FROM meetings").get() as any;

      console.log(`[stats] Stats retrieved: total=${totalLeads.count}, meetings=${totalMeetings.count}`);

      res.json({
        total_leads: totalLeads.count,
        leads_by_status: byStatus,
        total_pipeline_value: totalValue.total || 0,
        recent_leads: recentLeads,
        total_meetings: totalMeetings.count,
      });
    } catch (error: any) {
      console.error("[stats] Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

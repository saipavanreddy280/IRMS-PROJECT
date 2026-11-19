
const express = require("express");
const router = express.Router();

const Incident = require("../models/Incident.cjs");
const Notification = require("../models/Notification.cjs");
const { requireAuth } = require("../middleware/auth.cjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { escapeRegex } = require("../utils/search.cjs");

router.use(requireAuth);

async function notify(req, incidentId, title, message) {
  await Notification.create({
    recipient: req.user._id,
    incidentId,
    title,
    message
  });
}

// ======================================
// UPLOAD FOLDER
// ======================================

const uploadDir = path.join(__dirname, "../uploads");

fs.mkdirSync(uploadDir, { recursive: true });

// ======================================
// MULTER STORAGE
// ======================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    cb(null, Date.now() + "-" + safeName);
  }
});

// ======================================
// FILE VALIDATION
// ======================================

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|png|jpg|jpeg|txt|log)$/i.test(
      file.originalname
    );

    if (allowed) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF, PNG, JPG, TXT and LOG files are allowed"
        )
      );
    }
  }
});

// ======================================
// GET ALL INCIDENTS
// ======================================

router.get("/", async (req, res) => {
  try {
    const filter = {};
    for (const field of ["status", "priority", "type", "assignedTo"]) {
      if (typeof req.query[field] === "string" && req.query[field].trim()) {
        filter[field] = req.query[field].trim();
      }
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const query = new RegExp(escapeRegex(req.query.q.trim()), "i");
      filter.$or = [{ id: query }, { title: query }, { type: query }, { description: query }, { assignedTo: query }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
      if (Number.isNaN(filter.createdAt.$gte?.getTime()) || Number.isNaN(filter.createdAt.$lte?.getTime())) {
        return res.status(400).json({ message: "Invalid date filter" });
      }
    }

    let query = Incident.find(filter).sort({ createdAt: -1 });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 200);
    const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
    if (limit) query = query.skip(skip).limit(limit);
    const incidents = await query;

    res.status(200).json(incidents);

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

// ======================================
// GET SINGLE INCIDENT
// ======================================

router.get("/:id", async (req, res) => {
  try {
    const incident = await Incident.findOne({
      id: req.params.id
    });

    if (!incident) {
      return res.status(404).json({
        message: "Incident not found"
      });
    }

    res.status(200).json(incident);

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

// ======================================
// CREATE INCIDENT
// ======================================

router.post("/", async (req, res) => {
  try {
    const {
      id,
      title,
      type,
      priority,
      status,
      description,
      evidence
    } = req.body;

    if (!id || !title || !type || !priority) {
      return res.status(400).json({
        message: "Please provide ID, title, type and priority"
      });
    }

    const existingIncident = await Incident.findOne({ id });

    if (existingIncident) {
      return res.status(409).json({
        message: "Incident ID already exists"
      });
    }

    const incident = new Incident({
      id,
      title,
      type,
      priority,
      status: status || "Open",
      description: description || "",
      evidence: evidence || "",
      createdBy: req.user._id,
      timeline: [{
        action: "Incident Registered",
        details: `${title} was registered.`,
        actor: req.user.name
      }]
    });

    const savedIncident = await incident.save();
    await notify(req, savedIncident.id, "Incident created", `${savedIncident.id} — ${savedIncident.title}`);

    res.status(201).json(savedIncident);

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Incident ID already exists" });
    }
    res.status(400).json({
      message: error.message
    });
  }
});

// ======================================
// UPLOAD EVIDENCE
// ======================================

router.post("/:id/evidence", (req, res) => {

  upload.single("evidence")(req, res, async (uploadError) => {

    if (uploadError) {
      return res.status(400).json({
        message: uploadError.message
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Please select an evidence file"
        });
      }

      const incident = await Incident.findOne({
        id: req.params.id
      });

      if (!incident) {
        fs.unlink(req.file.path, () => {});

        return res.status(404).json({
          message: "Incident not found"
        });
      }

      incident.evidence = req.file.originalname;

      incident.evidencePath =
        "/uploads/" + req.file.filename;

      incident.evidenceUploadedAt = new Date();

      incident.chainOfCustody.push({
        action: "Evidence Uploaded",
        fileName: req.file.originalname,
        date: new Date(),
        details: "Evidence file uploaded and recorded in IRMS."
      });
      incident.timeline.push({
        action: "Evidence Uploaded",
        details: `Evidence file ${req.file.originalname} was uploaded.`,
        actor: req.user.name
      });

      await incident.save();
      await notify(req, incident.id, "Evidence uploaded", `${req.file.originalname} was attached to ${incident.id}`);

      res.status(200).json({
        message: "Evidence uploaded successfully",
        incident
      });

    } catch (error) {
      res.status(500).json({
        message: error.message
      });
    }
  });
});

// ======================================
// TASK ASSIGNMENT
// ======================================

router.put("/:id/assign", async (req, res) => {
  try {
    const { assignedTo, taskStatus } = req.body;

    if (!assignedTo || !assignedTo.trim()) {
      return res.status(400).json({
        message: "Please select a team member"
      });
    }

    const incident = await Incident.findOne({
      id: req.params.id
    });

    if (!incident) {
      return res.status(404).json({
        message: "Incident not found"
      });
    }

    const previousAssignedTo = incident.assignedTo;

    incident.assignedTo = assignedTo.trim();

    incident.assignedBy = req.user.name;

    incident.assignedAt = new Date();

    incident.taskStatus = taskStatus || "Assigned";

    incident.chainOfCustody.push({
      action: "Task Assigned",
      fileName: "",
      date: new Date(),
      details:
        "Incident assigned to " +
        assignedTo.trim() +
        (previousAssignedTo
          ? " (previously assigned to " + previousAssignedTo + ")"
          : "")
    });
    incident.timeline.push({
      action: "Task Assigned",
      details: `Assigned to ${assignedTo.trim()} with task status ${incident.taskStatus}.`,
      actor: req.user.name
    });

    await incident.save();
    await notify(req, incident.id, "Incident assigned", `${incident.id} was assigned to ${incident.assignedTo}`);

    res.status(200).json({
      message: "Task assigned successfully",
      incident
    });

  } catch (error) {
    res.status(400).json({
      message: error.message
    });
  }
});

// ======================================
// UPDATE INCIDENT
// ======================================

router.put("/:id", async (req, res) => {
  try {
    const allowedFields = [
      "title",
      "type",
      "priority",
      "status",
      "description",
      "taskStatus"
    ];

    const updates = {};

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const incident = await Incident.findOne({ id: req.params.id });

    if (!incident) {
      return res.status(404).json({
        message: "Incident not found"
      });
    }

    const changes = Object.entries(updates)
      .filter(([field, value]) => incident[field] !== value)
      .map(([field, value]) => `${field}: ${incident[field]} → ${value}`);
    if (!changes.length) {
      return res.status(200).json({ message: "No changes made", incident });
    }
    Object.assign(incident, updates);
    incident.timeline.push({
      action: "Incident Updated",
      details: changes.join("; "),
      actor: req.user.name
    });
    await incident.save();
    await notify(req, incident.id, "Incident updated", `${incident.id}: ${changes.join("; ")}`);

    res.status(200).json({
      message: "Incident updated successfully",
      incident
    });

  } catch (error) {
    res.status(400).json({
      message: error.message
    });
  }
});

// ======================================
// DELETE INCIDENT
// ======================================

router.delete("/:id", async (req, res) => {
  try {
    const incident = await Incident.findOneAndDelete({
      id: req.params.id
    });

    if (!incident) {
      return res.status(404).json({
        message: "Incident not found"
      });
    }

    // Delete uploaded evidence file if it exists
    if (incident.evidencePath) {
      const fileName = path.basename(incident.evidencePath);
      const filePath = path.join(uploadDir, fileName);

      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
    }

    res.status(200).json({
      message: "Incident deleted successfully"
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

module.exports = router;

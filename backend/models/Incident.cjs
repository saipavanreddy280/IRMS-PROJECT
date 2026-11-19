
const mongoose = require("mongoose");

const chainOfCustodySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    fileName: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    details: { type: String, default: "" }
  },
  { _id: false }
);

const timelineEventSchema = new mongoose.Schema({
  action: { type: String, required: true },
  details: { type: String, default: "" },
  actor: { type: String, default: "" },
  date: { type: Date, default: Date.now }
}, { _id: false });

const incidentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    title: {
      type: String,
      required: true,
      trim: true
    },

    type: {
      type: String,
      required: true
    },

    priority: {
      type: String,
      required: true,
      enum: ["Low", "Medium", "High", "Critical"]
    },

    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved"],
      default: "Open"
    },

    description: {
      type: String,
      default: ""
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    timeline: {
      type: [timelineEventSchema],
      default: []
    },

    // EVIDENCE INFORMATION
    evidence: {
      type: String,
      default: ""
    },

    evidencePath: {
      type: String,
      default: ""
    },

    evidenceUploadedAt: {
      type: Date,
      default: null
    },

    // CHAIN OF CUSTODY
    chainOfCustody: {
      type: [chainOfCustodySchema],
      default: []
    },

    // TASK ASSIGNMENT
    assignedTo: {
      type: String,
      default: ""
    },

    assignedBy: {
      type: String,
      default: "Admin User"
    },

    assignedAt: {
      type: Date,
      default: null
    },

    taskStatus: {
      type: String,
      enum: ["Not Assigned", "Assigned", "In Progress", "Completed"],
      default: "Not Assigned"
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Incident", incidentSchema);

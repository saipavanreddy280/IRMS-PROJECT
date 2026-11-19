
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env")
});
const { requireAuth } = require("./middleware/auth.cjs");

const app = express();

// ======================================
// MIDDLEWARE
// ======================================

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

// ======================================
// STATIC EVIDENCE FILES
// ======================================

app.use(
  "/uploads",
  requireAuth,
  express.static(path.join(__dirname, "uploads"))
);

// ======================================
// INCIDENT ROUTES
// ======================================

const incidentRoutes = require("./routes/incidentRoutes.cjs");
const authRoutes = require("./routes/authRoutes.cjs");
const notificationRoutes = require("./routes/notificationRoutes.cjs");

app.use("/api/auth", authRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/notifications", requireAuth, notificationRoutes);

app.get("/api/analytics", requireAuth, async (req, res, next) => {
  try {
    const Incident = require("./models/Incident.cjs");
    const [total, byStatus, byPriority, byType] = await Promise.all([
      Incident.countDocuments(),
      Incident.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Incident.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Incident.aggregate([{ $group: { _id: "$type", count: { $sum: 1 } } }])
    ]);
    return res.json({ total, byStatus, byPriority, byType });
  } catch (error) {
    return next(error);
  }
});

// ======================================
// HOME ROUTE
// ======================================

app.get("/", (req, res) => {
  res.send("IRMS Backend is Running!");
});

// ======================================
// HEALTH CHECK
// ======================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "IRMS Backend Connected Successfully",
    database:
      mongoose.connection.readyState === 1
        ? "Connected"
        : "Disconnected"
  });
});

// ======================================
// NOT FOUND ROUTE
// ======================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found"
  });
});

// ======================================
// ERROR HANDLER
// ======================================

app.use((error, req, res, next) => {
  console.error("Server Error:", error.message);

  const status = error.name === "ValidationError"
    ? 400
    : error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  res.status(status).json({
    success: false,
    message: status < 500 ? error.message : "Internal Server Error"
  });
});

// ======================================
// MONGODB CONNECTION
// ======================================

const PORT = process.env.PORT || 5000;

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is missing in backend/.env");
  process.exitCode = 1;
} else {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      console.log("MongoDB Connected Successfully!");

      app.listen(PORT, () => {
        console.log(`IRMS Server running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("MongoDB Connection Error:", error.message);
      process.exitCode = 1;
    });
}

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const User = require("./models/User.cjs");
const { hashPassword, verifyPassword } = require("./utils/password.cjs");

async function seedAdmin() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The local Admin seed requires NODE_ENV=development.");
  }
  if (process.env.ALLOW_ADMIN_SEED !== "true") {
    throw new Error("Set ALLOW_ADMIN_SEED=true to explicitly enable the local Admin seed.");
  }

  const email = (process.env.ADMIN_SEED_EMAIL || "admin@irms.local").trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_SEED_EMAIL must be a valid email address.");
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error("Set ADMIN_SEED_PASSWORD to a password between 12 and 128 characters.");
  }
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in backend/.env.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const existing = await User.findOne({ email }).select("+passwordHash");
  if (existing) {
    if (existing.role !== "Admin") {
      throw new Error(`Account ${email} already exists and is not an Admin; no changes were made.`);
    }
    if (!verifyPassword(password, existing.passwordHash)) {
      throw new Error(`Admin account ${email} already exists with a different password; no changes were made.`);
    }
    console.log(`Admin account ${email} already exists and the supplied password matches.`);
    return;
  }

  await User.create({
    name: "IRMS Admin",
    email,
    role: "Admin",
    passwordHash: hashPassword(password)
  });
  console.log(`Created local Admin account: ${email}`);
}

seedAdmin()
  .catch((error) => {
    console.error("Admin seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch (error) {
        console.error("MongoDB disconnect failed:", error.message);
        process.exitCode = 1;
      }
    }
  });

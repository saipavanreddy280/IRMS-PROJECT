const express = require("express");
const User = require("../models/User.cjs");
const { createToken, requireAuth } = require("../middleware/auth.cjs");
const { hashPassword, verifyPassword } = require("../utils/password.cjs");

const router = express.Router();
const passwordPattern = /^[\s\S]{8,128}$/;

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}

router.post("/register", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !passwordPattern.test(password)) {
      return res.status(400).json({ message: "Enter a name, valid email, and password of 8–128 characters" });
    }

    const user = await User.create({ name, email, passwordHash: hashPassword(password) });
    return res.status(201).json({ token: createToken(user._id), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "An account with this email already exists" });
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 128) {
      return res.status(400).json({ message: "Enter a valid email and password" });
    }
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: "Email or password is incorrect" });
    }
    return res.json({ token: createToken(user._id), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;

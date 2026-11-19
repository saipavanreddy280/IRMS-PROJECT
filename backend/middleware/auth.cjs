const crypto = require("crypto");
const User = require("../models/User.cjs");

const secret = process.env.JWT_SECRET || crypto.randomBytes(48).toString("base64url");
if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is unset; active sessions will be invalidated when the server restarts");
}
const tokenLifetimeSeconds = 60 * 60 * 12;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: String(userId),
    iat: now,
    exp: now + tokenLifetimeSeconds
  }));
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const body = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload.sub || !Number.isInteger(payload.exp) || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const user = await User.findById(payload.sub).select("_id name email role");
    if (!user) return res.status(401).json({ message: "Session is no longer valid" });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { createToken, requireAuth };

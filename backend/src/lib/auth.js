import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";

const scryptAsync = promisify(crypto.scrypt);
const tokenTtlMs = 1000 * 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", env.AUTH_SESSION_SECRET).update(value).digest("base64url");
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${key.toString("base64url")}`;
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;

  const [algorithm, salt, storedKey] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;

  const key = await scryptAsync(password, salt, 64);
  const storedBuffer = Buffer.from(storedKey, "base64url");

  return storedBuffer.length === key.length && crypto.timingSafeEqual(storedBuffer, key);
}

export function createSessionToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    exp: Date.now() + tokenTtlMs,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;

  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = sign(encodedPayload);

  if (
    !signature ||
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getBearerToken(req) {
  const authorization = req.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

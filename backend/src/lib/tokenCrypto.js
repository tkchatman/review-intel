import crypto from "node:crypto";
import { env } from "../config/env.js";

const tokenPrefix = "enc:v1:";
const algorithm = "aes-256-gcm";
const key = crypto.createHash("sha256").update(env.AUTH_SESSION_SECRET).digest();

export function encryptToken(token) {
  if (!token || token.startsWith(tokenPrefix)) {
    return token;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${tokenPrefix}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptToken(token) {
  if (!token || !token.startsWith(tokenPrefix)) {
    return token;
  }

  const [ivValue, authTagValue, encryptedValue] = token.slice(tokenPrefix.length).split(":");
  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

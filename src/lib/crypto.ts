import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

function encryptionKey() {
  const key = Buffer.from(getEnv().TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64");
  return key;
}

export function encryptToken(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Token criptografado inválido");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function sign(value: string) {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(value).digest("base64url");
}

export function verifySignature(value: string, signature: string) {
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * AES-256-GCM encryption for integration credentials stored in the DB.
 * Key is derived from SESSION_SECRET so rotating the secret invalidates
 * all stored credentials (acceptable for credentials the user can re-enter).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { db } from "@workspace/db";
import { integrationCredentialsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const ALGO = "aes-256-gcm";
const SALT = "tapboss-integration-creds-v1";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // SESSION_SECRET is required at startup (enforced in index.ts). If we reach
    // here without it something has gone very wrong — throw rather than silently
    // encrypting with a predictable key.
    throw new Error("SESSION_SECRET is required for credential encryption.");
  }
  return scryptSync(secret, SALT, 32);
}

export function encryptValue(plaintext: string): { encryptedValue: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: Buffer.concat([encrypted, authTag]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptValue(encryptedHex: string, ivHex: string): string {
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(encryptedHex, "hex");
  const authTag = data.subarray(-16);
  const encrypted = data.subarray(0, -16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Save a set of credentials for a connection. Upserts by (connectionId, envName). */
export async function saveCredentials(
  connectionId: number,
  companyId: number,
  platformKey: string,
  creds: Record<string, string>,
): Promise<void> {
  for (const [envName, value] of Object.entries(creds)) {
    if (!value) continue;
    const { encryptedValue, iv } = encryptValue(value);
    const [existing] = await db
      .select({ id: integrationCredentialsTable.id })
      .from(integrationCredentialsTable)
      .where(and(
        eq(integrationCredentialsTable.connectionId, connectionId),
        eq(integrationCredentialsTable.envName, envName),
      )).limit(1);
    if (existing) {
      await db.update(integrationCredentialsTable)
        .set({ encryptedValue, iv, updatedAt: new Date() })
        .where(eq(integrationCredentialsTable.id, existing.id));
    } else {
      await db.insert(integrationCredentialsTable).values({
        connectionId, companyId, platformKey, envName, encryptedValue, iv,
      });
    }
  }
}

/** Load decrypted credentials for a connection, keyed by env var name. */
export async function loadCredentials(connectionId: number): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(integrationCredentialsTable)
    .where(eq(integrationCredentialsTable.connectionId, connectionId));
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.envName] = decryptValue(row.encryptedValue, row.iv);
    } catch {
      // corrupted or key-rotated — skip silently
    }
  }
  return out;
}

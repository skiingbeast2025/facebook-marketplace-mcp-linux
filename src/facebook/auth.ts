import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type { FacebookCookie } from "./types.js";

const CHROME_SALT = "saltysalt";
const CHROME_ITERATIONS = 1003;
const CHROME_KEY_LENGTH = 16;
const CHROME_IV = Buffer.alloc(16, " ");

function getChromePassword(): string {
  try {
    return execSync(
      'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
      { stdio: ["pipe", "pipe", "pipe"] }
    )
      .toString()
      .trim();
  } catch {
    throw new Error(
      "Failed to get Chrome password from Keychain. " +
        "Make sure Chrome is installed and you approve the Keychain prompt."
    );
  }
}

function deriveChromeKey(password: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    CHROME_SALT,
    CHROME_ITERATIONS,
    CHROME_KEY_LENGTH,
    "sha1"
  );
}

function decryptCookieValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return "";

  // Check for v10 prefix (macOS Chrome encryption)
  const prefix = encrypted.slice(0, 3).toString("ascii");
  if (prefix !== "v10") {
    // Not encrypted or unknown format
    return encrypted.toString("utf8");
  }

  const data = encrypted.slice(3);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, CHROME_IV);
  decipher.setAutoPadding(false);

  let decoded = Buffer.concat([decipher.update(data), decipher.final()]);

  // Remove PKCS7 padding
  const padding = decoded[decoded.length - 1];
  if (padding && padding > 0 && padding <= 16) {
    decoded = decoded.slice(0, decoded.length - padding);
  }

  // Chrome prepends a 32-byte header to cookie values before encrypting.
  // Skip it to get the actual value.
  if (decoded.length > 32) {
    decoded = decoded.slice(32);
  }

  return decoded.toString("utf8");
}

function getCookieDbPath(profile = "Default"): string {
  return path.join(
    os.homedir(),
    "Library/Application Support/Google/Chrome",
    profile,
    "Cookies"
  );
}

function extractMacChromeCookies(
  domain: string,
  profile = "Default"
): FacebookCookie[] {
  const cookiePath = getCookieDbPath(profile);

  // Chrome locks the DB while running — copy it first
  const tmpPath = path.join(os.tmpdir(), `chrome_cookies_${Date.now()}`);
  try {
    execSync(`cp "${cookiePath}" "${tmpPath}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `Failed to copy Chrome cookie DB from ${cookiePath}. ` +
        "Make sure Chrome is installed and the profile exists."
    );
  }

  const password = getChromePassword();
  const key = deriveChromeKey(password);

  let db: Database.Database;
  try {
    db = new Database(tmpPath, { readonly: true });
  } catch {
    throw new Error(`Failed to open cookie database at ${tmpPath}`);
  }

  try {
    const rows = db
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly
         FROM cookies
         WHERE host_key LIKE ?`
      )
      .all(`%${domain}`) as Array<{
      host_key: string;
      name: string;
      value: string;
      encrypted_value: Buffer;
      path: string;
      expires_utc: number;
      is_secure: number;
      is_httponly: number;
    }>;

    return rows.map((row) => {
      let value = row.value;
      if (
        !value &&
        row.encrypted_value &&
        row.encrypted_value.length > 0
      ) {
        value = decryptCookieValue(row.encrypted_value, key);
      }
      return {
        host: row.host_key,
        name: row.name,
        value,
        path: row.path,
        expires: row.expires_utc,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
      };
    });
  } finally {
    db.close();
    try {
      execSync(`rm -f "${tmpPath}"`, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // cleanup failure is non-fatal
    }
  }
}

export function parseCookieInput(raw: string): FacebookCookie[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Parse JSON format (e.g. from Cookie-Editor / EditThisCookie export)
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item.name === "string")
          .map((item) => ({
            host: item.domain || ".facebook.com",
            name: item.name,
            value: String(item.value ?? ""),
            path: item.path || "/",
            expires: item.expirationDate || 0,
            secure: item.secure ?? true,
            httpOnly: item.httpOnly ?? true,
          }));
      } else if (typeof parsed === "object") {
        return Object.entries(parsed).map(([key, val]) => ({
          host: ".facebook.com",
          name: key,
          value: String(val ?? ""),
          path: "/",
          expires: 0,
          secure: true,
          httpOnly: true,
        }));
      }
    } catch {
      // Not JSON, continue to header string parsing
    }
  }

  // Parse standard cookie string: "c_user=123; xs=abc; ..."
  return trimmed
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) return null;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      return {
        host: ".facebook.com",
        name,
        value,
        path: "/",
        expires: 0,
        secure: true,
        httpOnly: true,
      };
    })
    .filter((c): c is FacebookCookie => c !== null && c.name.length > 0);
}

export function extractChromeCookies(
  domain: string,
  profile = "Default"
): FacebookCookie[] {
  // 1. Check environment variable (string or JSON)
  if (process.env.FB_COOKIES) {
    const cookies = parseCookieInput(process.env.FB_COOKIES);
    if (cookies.length > 0) return cookies;
  }

  // 2. Check cookie file path
  if (process.env.FB_COOKIES_FILE) {
    const filePath = path.resolve(process.env.FB_COOKIES_FILE);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const cookies = parseCookieInput(fileContent);
      if (cookies.length > 0) return cookies;
    } else {
      throw new Error(`FB_COOKIES_FILE does not exist at: ${filePath}`);
    }
  }

  // 3. macOS Keychain fallback
  if (process.platform === "darwin") {
    return extractMacChromeCookies(domain, profile);
  }

  // 4. Linux / Windows without cookies provided
  throw new Error(
    "No Facebook cookies found.\n" +
      "Automatic Chrome Keychain extraction is only supported on macOS.\n" +
      "On Linux and Windows, provide your session cookies using the FB_COOKIES environment variable\n" +
      "(e.g. FB_COOKIES='c_user=...; xs=...') or by pointing FB_COOKIES_FILE to a cookie file.\n" +
      "See the README for details."
  );
}

export function cookiesToHeader(cookies: FacebookCookie[]): string {
  return cookies
    .map((c) => {
      // Strip non-Latin1 chars — fetch rejects them in Cookie headers
      const safe = c.value.replace(/[^\x00-\xFF]/g, "");
      return `${c.name}=${safe}`;
    })
    .join("; ");
}

export function getCookieValue(
  cookies: FacebookCookie[],
  name: string
): string | undefined {
  return cookies.find((c) => c.name === name)?.value;
}

import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const local = process.argv.includes("--local");
const code = randomBytes(24).toString("hex");
const digest = createHash("sha256").update(code).digest("hex");
const now = new Date();
const expires = new Date(now.getTime() + 7 * 86400_000).toISOString();
mkdirSync(".secrets", { recursive: true, mode: 0o700 });
const sqlFile = resolve(`.secrets/invite-${digest.slice(0,12)}.sql`);
writeFileSync(sqlFile, `INSERT INTO invitations (code_hash, created_at, expires_at) VALUES ('${digest}', '${now.toISOString()}', '${expires}');`, { mode: 0o600 });
try {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "tellumo-control", local ? "--local" : "--remote", "--file", sqlFile], { encoding: "utf8" });
  if (result.status !== 0) { console.error(result.stderr); process.exitCode = 1; }
  else {
    const output = resolve(`.secrets/invitation-${digest.slice(0,12)}.txt`);
    writeFileSync(output, `Whumpo test invitation\nOpen https://whumpo.com/workspace/?signup=true to create your account.\nInvitation code: ${code}\nExpires: ${expires}\nOne use. Do not commit or post this code publicly.\n`, { mode: 0o600 });
    console.log(`Invitation saved to ${output}`);
  }
} finally { unlinkSync(sqlFile); }

import process from "node:process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
// Files are exclusive and gitignored: never overwrite existing deployment credentials.
await mkdir(".secrets", { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString("base64url");
const hash = spawnSync("openssl", ["passwd", "-apr1", "-stdin"], {
  input: password,
  encoding: "utf8",
});
if (hash.status !== 0) throw new Error("openssl passwd failed");
const flags = { flag: "wx", mode: 0o600 };
await writeFile(".secrets/htpasswd", `tester:${hash.stdout.trim()}\n`, { ...flags, mode: 0o644 });
await writeFile(
  ".secrets/tester-login.txt",
  `Username: tester\nPassword: ${password}\n`,
  flags,
);
await writeFile(
  ".secrets/compose.env",
  `POSTGRES_PASSWORD=${randomBytes(32).toString("hex")}\nGATEWAY_TOKEN=${randomBytes(32).toString("hex")}\nWEB_ORIGIN=http://localhost:3080\n`,
  flags,
);
process.stdout.write(
  "Created private container config. Login is saved in .secrets/tester-login.txt; no secrets were printed.\n",
);

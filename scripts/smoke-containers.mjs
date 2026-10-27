import { Buffer } from "node:buffer";
/* global fetch */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import process from "node:process";
const base = process.env.CONTAINER_URL ?? "http://localhost:3080";
const lines = (await readFile(".secrets/tester-login.txt", "utf8")).trim().split("\n");
const authorization = "Basic " + Buffer.from(lines.map(line => line.split(": ")[1]).join(":")).toString("base64");
assert.equal((await fetch(base)).status,401,"Anonymous UI must require login");
const page=await fetch(base,{headers:{authorization}});
assert.equal(page.status,200,"Authenticated UI must load");
assert.match(await page.text(),/roam/i);
const result=await fetch(`${base}/api/chat`,{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({sessionId:"smoke-validation",message:""})});
assert.equal(result.status,400,"Authenticated request must reach validation, not authentication failure");
process.stdout.write("Container smoke passed: anonymous 401, authenticated UI 200, authenticated API validation 400. No model call.\n");

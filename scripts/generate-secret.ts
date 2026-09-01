import { randomBytes } from "node:crypto";

const kind = process.argv[2];
if (kind === "session") console.log(randomBytes(48).toString("base64url"));
else if (kind === "encryption") console.log(randomBytes(32).toString("base64"));
else {
  console.error("Use session ou encryption");
  process.exitCode = 1;
}

import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("frontend", "dist", { recursive: true });
await rm("dist/js/admin.js", { force: true });
await rm("dist/js/payment-config.js", { force: true });

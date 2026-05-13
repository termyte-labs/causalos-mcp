import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectPreconditions } from "../preconditions.js";

describe("precondition collectors", () => {
  it("captures filesystem recursive delete evidence", async () => {
    const facts = await collectPreconditions({
      payload: { command: "rm -rf ./src", args: [], cwd: process.cwd() },
    });

    expect(facts.filesystem).toMatchObject({
      target: "./src",
      recursive: true,
      force: true,
      target_class: "src",
    });
  });

  it("captures unbounded database mutation evidence", async () => {
    const facts = await collectPreconditions({
      payload: { command: "delete from users", args: [] },
    });

    expect(facts.database).toMatchObject({
      verb: "delete",
      table: "users",
      has_where: false,
    });
  });

  it("captures package publish evidence", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "termyte-preconditions-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "demo-package", version: "1.2.3" }),
        "utf-8"
      );

      const facts = await collectPreconditions({
        payload: {
          command: "npm publish",
          args: ["--registry", "https://registry.npmjs.org"],
          cwd: tmpDir,
        },
      });

      expect(facts.package).toMatchObject({
        manager: "npm",
        action: "publish",
        dry_run: false,
        registry: "https://registry.npmjs.org",
        package_name: "demo-package",
        package_version: "1.2.3",
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

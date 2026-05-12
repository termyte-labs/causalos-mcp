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
});

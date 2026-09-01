import { describe, expect, it } from "vitest";
import { parseList } from "./common.ts";

const opts = { sortable: ["holders", "supply", "name"] as const, defaultSort: "holders", max: 200 };

describe("parseList", () => {
  it("accepts a whitelisted sort, falls back otherwise", () => {
    expect(parseList({ sortBy: "supply" }, opts).sortBy).toBe("supply");
    expect(parseList({ sortBy: "nope" }, opts).sortBy).toBe("holders");
    expect(parseList({}, opts).sortBy).toBe("holders");
  });

  it("parses order, defaulting to desc", () => {
    expect(parseList({ order: "asc" }, opts).order).toBe("asc");
    expect(parseList({ order: "ASC" }, opts).order).toBe("asc");
    expect(parseList({ order: "desc" }, opts).order).toBe("desc");
    expect(parseList({ order: "sideways" }, opts).order).toBe("desc");
    expect(parseList({}, opts).order).toBe("desc");
  });

  it("clamps limit and floors offset", () => {
    expect(parseList({ limit: "50" }, opts).limit).toBe(50);
    expect(parseList({ limit: "9999" }, opts).limit).toBe(200); // max
    expect(parseList({ limit: "0" }, opts).limit).toBe(25); // falsy -> default
    expect(parseList({ limit: "-5" }, opts).limit).toBe(1); // clamped up
    expect(parseList({ offset: "-1" }, opts).offset).toBe(0);
    expect(parseList({ offset: "100" }, opts).offset).toBe(100);
    expect(parseList({}, opts).offset).toBe(0);
  });
});

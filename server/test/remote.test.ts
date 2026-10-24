import { describe, expect, it } from "vitest";
import { parseRemote } from "../src/git";

describe("parseRemote", () => {
  it("parses scp-like github", () => {
    expect(parseRemote("git@github.com:o/r.git")).toEqual({ provider: "github", host: "github.com", projectPath: "o/r" });
  });
  it("parses ssh url with port and subgroup", () => {
    expect(parseRemote("ssh://git@git.example.com:776/g/sub/r.git")).toEqual({ provider: "gitlab", host: "git.example.com", projectPath: "g/sub/r" });
  });
  it("parses https gitlab", () => {
    expect(parseRemote("https://gitlab.com/g/r.git")).toEqual({ provider: "gitlab", host: "gitlab.com", projectPath: "g/r" });
  });
  it("handles https with credentials and unknown hosts", () => {
    expect(parseRemote("https://user:pw@example.org/a/b")).toEqual({ provider: "other", host: "example.org", projectPath: "a/b" });
  });
  it("returns null for empty or garbage", () => {
    expect(parseRemote(null)).toBeNull();
    expect(parseRemote("not a url")).toBeNull();
  });
});

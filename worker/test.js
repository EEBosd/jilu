import test from "node:test";
import assert from "node:assert/strict";
import worker, { cleanTrip, sameToken } from "./src/index.js";

const env = {
  GH_OWNER: "EEBosd",
  GH_REPO: "jilu",
  GH_BRANCH: "main",
  GITHUB_TOKEN: "test-token",
  SHARE_TOKEN: "long-private-test-token",
  ALLOWED_ORIGIN: "https://eebosd.github.io"
};

test("requires the complete share link before reading records", async () => {
  const response = await worker.fetch(new Request("https://api.example/api/trips"), env);
  assert.equal(response.status, 401);
});

test("rejects foreign media and invalid dates", () => {
  assert.throws(() => cleanTrip({ title: "Trip", date: "2026-99-99", media: [] }, env));
  assert.throws(() => cleanTrip({ title: "Trip", date: "2026-10-12", media: [{ kind: "photo", url: "https://example.com/photo.jpg" }] }, env));
  assert.equal(sameToken("abc", "abc"), true);
  assert.equal(sameToken("abc", "abd"), false);
});

test("reads the GitHub JSON record file for a valid link", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ sha: "abc", content: btoa("[]") });
  try {
    const response = await worker.fetch(new Request("https://api.example/api/trips", {
      headers: { "X-Share-Token": env.SHARE_TOKEN, "Origin": env.ALLOWED_ORIGIN }
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { trips: [] });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGIN);
  } finally { globalThis.fetch = previousFetch; }
});

test("a new trip is saved to GitHub and appears in the next read", async () => {
  const previousFetch = globalThis.fetch;
  let content = btoa("[]");
  let sha = "initial";
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PUT") {
      const update = JSON.parse(init.body);
      assert.equal(update.sha, sha);
      content = update.content;
      sha = "next";
      return Response.json({ content: { sha } });
    }
    return Response.json({ sha, content });
  };
  const headers = { "X-Share-Token": env.SHARE_TOKEN, "Origin": env.ALLOWED_ORIGIN };
  try {
    const created = await worker.fetch(new Request("https://api.example/api/trips", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "海边", date: "2026-10-12", location: "青岛", notes: "晴天", media: [] })
    }), env);
    assert.equal(created.status, 201);
    const listed = await worker.fetch(new Request("https://api.example/api/trips", { headers }), env);
    const { trips } = await listed.json();
    assert.equal(trips.length, 1);
    assert.equal(trips[0].title, "海边");
  } finally { globalThis.fetch = previousFetch; }
});

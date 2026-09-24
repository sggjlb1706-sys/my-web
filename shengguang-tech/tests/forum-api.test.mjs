import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleForumRequest } from "../server/forum-api.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  return {
    prepare(query) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(query);
          return {
            async first() { return statement.get(...values) || null; },
            async all() { return { results: statement.all(...values) }; },
            async run() { return { meta: { changes: statement.run(...values).changes } }; },
          };
        },
        async first() { return sqlite.prepare(query).get() || null; },
        async all() { return { results: sqlite.prepare(query).all() }; },
      };
    },
    close() { sqlite.close(); },
  };
}

function client(db, cookie = "") {
  return async (path, method = "GET", body) => {
    const headers = { Origin: "http://localhost:8788" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    const request = new Request(`http://localhost:8788/api/forum/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handleForumRequest({ request, env: { FORUM_DB: db, FORUM_BOOTSTRAP_KEY: "a-very-long-local-bootstrap-secret-123" } });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
  };
}

test("invited member can discuss; admin can moderate; anonymous visitors can read", async () => {
  const db = database();
  try {
    const publicRequest = client(db);
    assert.equal((await publicRequest("status")).data.setupRequired, true);
    assert.equal((await publicRequest("topics", "POST", { category: "discussion", title: "测试主题", body: "这是一段长度足够的测试主题正文，用来检查匿名权限。" })).status, 401);
    assert.equal((await publicRequest("bootstrap", "POST", { setupKey: "wrong", username: "管理员", password: "admin-password-123" })).status, 403);

    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    assert.equal(boot.status, 200);
    assert.equal(boot.data.member.role, "admin");
    assert.equal((await publicRequest("status")).data.setupRequired, false);
    assert.equal((await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "另一个管理员", password: "admin-password-123" })).status, 409);

    const adminRequest = client(db, boot.cookie);
    const invitation = await adminRequest("admin/invites", "POST", {});
    assert.equal(invitation.status, 201);
    const registered = await publicRequest("register", "POST", { inviteCode: invitation.data.code, username: "成员甲", password: "member-password-123" });
    assert.equal(registered.status, 200);
    assert.equal((await publicRequest("register", "POST", { inviteCode: invitation.data.code, username: "成员乙", password: "member-password-123" })).status, 403);
    const memberRequest = client(db, registered.cookie);
    assert.equal((await memberRequest("admin/invites", "POST", {})).status, 403);
    assert.equal((await memberRequest("topics", "POST", { category: "notice", title: "普通成员公告", body: "这是一段长度足够的测试主题正文，用来检查公告权限。" })).status, 403);

    const posted = await memberRequest("topics", "POST", { category: "discussion", title: "研究讨论主题", body: "这是一段长度足够的测试主题正文，用来检查发布和搜索。" });
    assert.equal(posted.status, 201);
    const id = posted.data.id;
    assert.equal((await publicRequest("topics?q=研究讨论")).data.total, 1);
    assert.equal((await publicRequest("topics?category=technology")).data.total, 0);
    const secondInvite = await adminRequest("admin/invites", "POST", {});
    const secondMember = await publicRequest("register", "POST", { inviteCode: secondInvite.data.code, username: "成员乙", password: "member-password-456" });
    const otherRequest = client(db, secondMember.cookie);
    assert.equal((await otherRequest(`topics/${id}`, "PATCH", { title: "越权修改主题", body: "这是一段长度足够的越权修改测试正文。" })).status, 403);
    assert.equal((await memberRequest(`topics/${id}`, "PATCH", { title: "修改后的研究讨论", body: "这是成员自己修改主题后的正文，长度足够通过校验。" })).status, 200);
    assert.equal((await publicRequest(`topics/${id}`)).data.topic.title, "修改后的研究讨论");
    assert.equal((await memberRequest(`topics/${id}/replies`, "POST", { body: "我也想参与这个主题。" })).status, 201);
    const detail = await publicRequest(`topics/${id}`);
    assert.equal(detail.data.totalReplies, 1);
    const replyId = detail.data.replies[0].id;
    assert.equal((await otherRequest(`replies/${replyId}`, "PATCH", { body: "越权修改" })).status, 403);
    assert.equal((await memberRequest(`replies/${replyId}`, "PATCH", { body: "修改后的回复。" })).status, 200);
    assert.equal((await publicRequest(`topics/${id}`)).data.replies[0].body, "修改后的回复。");
    assert.equal((await memberRequest("reports", "POST", { targetType: "topic", targetId: id, reason: "测试举报内容" })).status, 201);
    assert.equal((await adminRequest("admin/reports")).data.reports.length, 1);
    assert.equal((await adminRequest(`admin/topics/${id}/lock`, "POST", {})).status, 200);
    assert.equal((await memberRequest(`topics/${id}/replies`, "POST", { body: "主题关闭后不能回复。" })).status, 403);
    assert.equal((await memberRequest(`replies/${replyId}`, "DELETE")).status, 200);
    assert.equal((await publicRequest(`topics/${id}`)).data.totalReplies, 0);
    assert.equal((await adminRequest(`admin/topics/${id}`, "DELETE")).status, 200);
    assert.equal((await publicRequest(`topics/${id}`)).status, 404);
    assert.equal((await publicRequest("topics")).data.total, 0);

    assert.equal((await publicRequest("login", "POST", { username: "成员甲", password: "wrong-password" })).status, 401);
    assert.equal((await publicRequest("login", "POST", { username: "成员甲", password: "member-password-123" })).status, 200);
    assert.equal((await memberRequest("logout", "POST", {})).status, 200);
    assert.equal((await memberRequest("me")).data.member, null);
  } finally {
    db.close();
  }
});

test("mutation from a foreign origin is rejected", async () => {
  const request = new Request("https://example.com/api/forum/login", {
    method: "POST", headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "x", password: "y" }),
  });
  const response = await handleForumRequest({ request, env: { FORUM_DB: {} } });
  assert.equal(response.status, 403);
});

test("only failed logins count toward the temporary limit", async () => {
  const db = database();
  try {
    const request = client(db);
    await request("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    for (let index = 0; index < 11; index += 1) {
      assert.equal((await request("login", "POST", { username: "管理员", password: "admin-password-123" })).status, 200);
    }
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await request("login", "POST", { username: "管理员", password: "wrong-password-123" })).status, 401);
    }
    assert.equal((await request("login", "POST", { username: "管理员", password: "admin-password-123" })).status, 429);
  } finally {
    db.close();
  }
});

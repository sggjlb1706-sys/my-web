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
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM forum_invites").first()).total, 0);
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

test("new accounts stay within the Cloudflare PBKDF2 limit", async () => {
  const db = database();
  const deriveBits = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = function (algorithm, ...args) {
    if (algorithm.iterations > 100000) throw new DOMException("PBKDF2 iteration limit exceeded", "NotSupportedError");
    return deriveBits.call(this, algorithm, ...args);
  };
  try {
    const publicRequest = client(db);
    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    assert.equal(boot.status, 200);
    assert.equal((await publicRequest("login", "POST", { username: "管理员", password: "admin-password-123" })).status, 200);
    const invitation = await client(db, boot.cookie)("admin/invites", "POST", {});
    const registered = await publicRequest("register", "POST", { inviteCode: invitation.data.code, username: "成员甲", password: "member-password-123" });
    assert.equal(registered.status, 200);
    assert.equal((await publicRequest("login", "POST", { username: "成员甲", password: "member-password-123" })).status, 200);
  } finally {
    crypto.subtle.deriveBits = deriveBits;
    db.close();
  }
});

test("existing accounts with unversioned salts can still log in locally", async () => {
  const db = database();
  try {
    const salt = "00112233445566778899aabbccddeeff";
    const password = "legacy-password-123";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Buffer.from(salt, "hex"), iterations: 120000, hash: "SHA-256" }, key, 256);
    await db.prepare("INSERT INTO forum_members (id, username, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'member', ?)")
      .bind(crypto.randomUUID(), "旧成员", salt, Buffer.from(bits).toString("hex"), Date.now()).run();
    assert.equal((await client(db)("login", "POST", { username: "旧成员", password })).status, 200);
  } finally {
    db.close();
  }
});

test("only admins can pin up to three visible topics, and pinned topics sort first", async () => {
  const db = database();
  try {
    const publicRequest = client(db);
    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    const adminRequest = client(db, boot.cookie);
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const [index, id] of ids.entries()) {
      await db.prepare("INSERT INTO forum_topics (id, author_id, category, title, body, created_at, updated_at) VALUES (?, ?, 'discussion', ?, ?, ?, ?)")
        .bind(id, boot.data.member.id, `主题${index}`, "这是一个测试主题正文，长度足够。", index + 1, index + 1).run();
    }
    assert.equal((await publicRequest(`admin/topics/${ids[0]}/pin`, "POST", { pinned: true })).status, 403);
    for (const id of ids.slice(0, 3)) {
      assert.equal((await adminRequest(`admin/topics/${id}/pin`, "POST", { pinned: true })).status, 200);
    }
    assert.equal((await adminRequest(`admin/topics/${ids[3]}/pin`, "POST", { pinned: true })).status, 409);
    assert.deepEqual((await publicRequest("topics")).data.topics.map((topic) => topic.id), [ids[2], ids[1], ids[0], ids[3]]);
    assert.equal((await publicRequest(`topics/${ids[0]}`)).data.topic.isPinned, 1);
    assert.equal((await adminRequest(`admin/topics/${ids[0]}/pin`, "POST", { pinned: false })).status, 200);
    assert.equal((await adminRequest(`admin/topics/${ids[3]}/pin`, "POST", { pinned: true })).status, 200);
    assert.equal((await adminRequest(`admin/topics/${ids[3]}`, "DELETE")).status, 200);
    assert.equal((await db.prepare("SELECT is_pinned AS isPinned FROM forum_topics WHERE id = ?").bind(ids[3]).first()).isPinned, 0);
  } finally {
    db.close();
  }
});

test("members can change a unique public nickname without changing their login", async () => {
  const db = database();
  try {
    const publicRequest = client(db);
    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    const invitation = await client(db, boot.cookie)("admin/invites", "POST", {});
    const registered = await publicRequest("register", "POST", { inviteCode: invitation.data.code, username: "member-one", password: "member-password-123" });
    const memberRequest = client(db, registered.cookie);
    const posted = await memberRequest("topics", "POST", { category: "discussion", title: "昵称测试主题", body: "这是一个测试主题正文，长度足够验证昵称变化。" });
    assert.equal((await memberRequest("me", "PATCH", { displayName: "管理员" })).status, 409);
    assert.equal((await memberRequest("me", "PATCH", { displayName: "New-Name" })).status, 200);
    assert.equal((await memberRequest("me")).data.member.username, "member-one");
    assert.equal((await publicRequest(`topics/${posted.data.id}`)).data.topic.author, "New-Name");
    assert.equal((await publicRequest("login", "POST", { username: "member-one", password: "member-password-123" })).status, 200);
    assert.equal((await publicRequest("login", "POST", { username: "New-Name", password: "member-password-123" })).status, 401);
    const secondInvite = await client(db, boot.cookie)("admin/invites", "POST", {});
    assert.equal((await publicRequest("register", "POST", { inviteCode: secondInvite.data.code, username: "new-name", password: "member-password-456" })).status, 409);
  } finally {
    db.close();
  }
});

test("automatic cleanup removes only expired temporary records", async () => {
  const db = database();
  try {
    const publicRequest = client(db);
    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    const now = Date.now();
    for (const [code, expiresAt] of [["expired", now - 1000], ["active", now + 60000]]) {
      await db.prepare("INSERT INTO forum_invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(code, boot.data.member.id, now - 10000, expiresAt).run();
      await db.prepare("INSERT INTO forum_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(code, boot.data.member.id, now - 10000, expiresAt).run();
      await db.prepare("INSERT INTO forum_login_limits (bucket, attempts, reset_at) VALUES (?, 1, ?)")
        .bind(code, expiresAt).run();
    }
    await client(db, boot.cookie)("admin/invites", "POST", {});
    for (const table of ["forum_invites", "forum_sessions", "forum_login_limits"]) {
      assert.equal((await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${table === "forum_login_limits" ? "bucket" : table === "forum_sessions" ? "token_hash" : "code_hash"} = 'expired'`).first()).total, 0);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${table === "forum_login_limits" ? "bucket" : table === "forum_sessions" ? "token_hash" : "code_hash"} = 'active'`).first()).total, 1);
    }
  } finally {
    db.close();
  }
});

test("production migration preserves existing members and posts", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE forum_members (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE);
      CREATE TABLE forum_topics (id TEXT PRIMARY KEY, category TEXT NOT NULL, is_hidden INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      INSERT INTO forum_members (id, username) VALUES ('m1', '旧成员');
      INSERT INTO forum_topics (id, category, updated_at) VALUES ('t1', 'discussion', 1);
    `);
    sqlite.exec(readFileSync(new URL("../db/migrations/001_forum_controls.sql", import.meta.url), "utf8"));
    assert.equal(sqlite.prepare("SELECT display_name FROM forum_members WHERE id = 'm1'").get().display_name, "旧成员");
    assert.equal(sqlite.prepare("SELECT is_pinned FROM forum_topics WHERE id = 't1'").get().is_pinned, 0);
  } finally {
    sqlite.close();
  }
});

test("topic and reply LaTeX remain editable source text", async () => {
  const db = database();
  try {
    const publicRequest = client(db);
    const boot = await publicRequest("bootstrap", "POST", { setupKey: "a-very-long-local-bootstrap-secret-123", username: "管理员", password: "admin-password-123" });
    const adminRequest = client(db, boot.cookie);
    const body = String.raw`公式测试：\(E=mc^2\) 与 \[\int_0^1 x^2\,dx\]。`;
    const posted = await adminRequest("topics", "POST", { category: "technology", title: "公式主题测试", body });
    assert.equal(posted.status, 201);
    const reply = String.raw`回复 \(\alpha+\beta\)`;
    assert.equal((await adminRequest(`topics/${posted.data.id}/replies`, "POST", { body: reply })).status, 201);
    const detail = await publicRequest(`topics/${posted.data.id}`);
    assert.equal(detail.data.topic.body, body);
    assert.equal(detail.data.replies[0].body, reply);
  } finally {
    db.close();
  }
});

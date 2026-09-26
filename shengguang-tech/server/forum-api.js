import { handleSaintLightRequest } from "./saint-light-api.js";

const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const PAGE_SIZE = 20;
const REPLY_PAGE_SIZE = 40;
const PASSWORD_ITERATIONS = 100000;
const LEGACY_PASSWORD_ITERATIONS = 120000;
const CATEGORIES = new Set(["notice", "technology", "discussion"]);
const DISCUSSION_SECTIONS = new Set(["academic", "entertainment", "general"]);
const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{2,24}$/u;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unhex(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (pair) => parseInt(pair, 16));
}

async function sha256(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function passwordHash(password, salt) {
  const prefix = `${PASSWORD_ITERATIONS}:`;
  const current = salt.startsWith(prefix);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: unhex(current ? salt.slice(prefix.length) : salt),
      iterations: current ? PASSWORD_ITERATIONS : LEGACY_PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

function secureEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomHex(length = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}

function cookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `forum_session=${token}; Path=/api/forum; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function sessionMember(db, request) {
  const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)forum_session=([^;]+)/)?.[1];
  if (!token) return null;
  return db.prepare(`
    SELECT m.id, m.username, COALESCE(m.display_name, m.username) AS displayName, m.role FROM forum_sessions s
    JOIN forum_members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await sha256(token), Date.now()).first();
}

async function issueSession(db, request, member) {
  const token = randomHex(32);
  const now = Date.now();
  await db.prepare("INSERT INTO forum_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), member.id, now, now + SESSION_DAYS * 86400000).run();
  return json({ member }, 200, { "Set-Cookie": cookie(request, token, SESSION_DAYS * 86400) });
}

async function readBody(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("请提交 JSON 数据。");
  const raw = await request.text();
  if (raw.length > 20000) throw new Error("内容过长。");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("提交格式不正确。");
  }
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength + 1) : "";
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function pageNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 10000) : 1;
}

async function cleanupTransientData(db, now = Date.now()) {
  await db.prepare("DELETE FROM forum_invites WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM forum_sessions WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM forum_login_limits WHERE reset_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM forum_password_resets WHERE expires_at <= ?").bind(now).run();
  await db.prepare("DELETE FROM forum_ai_limits WHERE reset_at <= ?").bind(now).run();
}

async function loginLimited(db, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = await sha256(`login:${ip}`);
  const result = await db.prepare("SELECT attempts, reset_at AS resetAt FROM forum_login_limits WHERE bucket = ?").bind(bucket).first();
  return Boolean(result && result.resetAt > Date.now() && result.attempts >= 10);
}

async function recordLoginFailure(db, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = await sha256(`login:${ip}`);
  const now = Date.now();
  await db.prepare(`
    INSERT INTO forum_login_limits (bucket, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      attempts = CASE WHEN reset_at < ? THEN 1 ELSE attempts + 1 END,
      reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END
  `).bind(bucket, now + 15 * 60000, now, now).run();
}

function requireMember(member) {
  return member ? null : fail("请先登录成员账号。", 401);
}

function requireAdmin(member) {
  return member?.role === "admin" ? null : fail("只有管理员可以执行此操作。", 403);
}

async function handleAuth(context, db, segments, member) {
  const { request, env } = context;
  const [action] = segments;
  if (action === "status" && request.method === "GET") {
    const admin = await db.prepare("SELECT id FROM forum_members WHERE role = 'admin' LIMIT 1").first();
    return json({ setupRequired: !admin, setupEnabled: Boolean(env.FORUM_BOOTSTRAP_KEY) });
  }
  if (action === "me" && request.method === "GET") return json({ member });
  if (action === "me" && request.method === "PATCH") {
    const denied = requireMember(member);
    if (denied) return denied;
    const body = await readBody(request);
    const displayName = cleanText(body.displayName, 24);
    if (!USERNAME_PATTERN.test(displayName)) return fail("昵称需为 2–24 字，可使用中英文、数字及 _ . -。", 400);
    const taken = await db.prepare("SELECT id FROM forum_members WHERE COALESCE(display_name, username) = ? COLLATE NOCASE AND id <> ?")
      .bind(displayName, member.id).first();
    if (taken) return fail("该昵称已被使用。", 409);
    try {
      await db.prepare("UPDATE forum_members SET display_name = ? WHERE id = ?").bind(displayName, member.id).run();
    } catch {
      return fail("该昵称已被使用。", 409);
    }
    return json({ member: { ...member, displayName } });
  }
  if (action === "bootstrap" && request.method === "POST") {
    if (!env.FORUM_BOOTSTRAP_KEY || env.FORUM_BOOTSTRAP_KEY.length < 24) return fail("管理员初始化密钥尚未配置。", 503);
    const body = await readBody(request);
    const supplied = cleanText(body.setupKey, 256);
    if (!secureEqual(supplied, env.FORUM_BOOTSTRAP_KEY)) return fail("初始化密钥不正确。", 403);
    const username = cleanText(body.username, 24);
    if (!USERNAME_PATTERN.test(username) || !validPassword(body.password)) return fail("姓名需为 2–24 字，密码至少 12 位。");
    const id = crypto.randomUUID();
    const salt = `${PASSWORD_ITERATIONS}:${randomHex()}`;
    const hash = await passwordHash(body.password, salt);
    const result = await db.prepare(`
      INSERT INTO forum_members (id, username, display_name, password_salt, password_hash, role, created_at)
      SELECT ?, ?, ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM forum_members WHERE role = 'admin')
    `).bind(id, username, username, salt, hash, Date.now()).run();
    if (!result.meta.changes) return fail("管理员已经建立。", 409);
    return issueSession(db, request, { id, username, displayName: username, role: "admin" });
  }
  if (action === "register" && request.method === "POST") {
    const body = await readBody(request);
    const code = cleanText(body.inviteCode, 100);
    const username = cleanText(body.username, 24);
    if (!USERNAME_PATTERN.test(username) || !validPassword(body.password) || !/^[a-f0-9]{40}$/i.test(code)) {
      return fail("请填写有效的邀请码、姓名和至少 12 位的密码。");
    }
    const codeHash = await sha256(code.toLowerCase());
    const invite = await db.prepare(`
      SELECT i.code_hash FROM forum_invites i
      LEFT JOIN forum_members m ON m.invite_hash = i.code_hash
      WHERE i.code_hash = ? AND i.expires_at > ? AND m.id IS NULL
    `).bind(codeHash, Date.now()).first();
    if (!invite) return fail("邀请码无效、已使用或已过期。", 403);
    const id = crypto.randomUUID();
    const salt = `${PASSWORD_ITERATIONS}:${randomHex()}`;
    const hash = await passwordHash(body.password, salt);
    try {
      await db.prepare(`
        INSERT INTO forum_members (id, username, display_name, password_salt, password_hash, invite_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'member', ?)
      `).bind(id, username, username, salt, hash, codeHash, Date.now()).run();
    } catch {
      return fail("登录名或昵称已存在，或邀请码已经使用。", 409);
    }
    await db.prepare("DELETE FROM forum_invites WHERE code_hash = ?").bind(codeHash).run();
    await cleanupTransientData(db);
    return issueSession(db, request, { id, username, displayName: username, role: "member" });
  }
  if (action === "login" && request.method === "POST") {
    if (await loginLimited(db, request)) return fail("尝试次数过多，请 15 分钟后再试。", 429);
    const body = await readBody(request);
    const username = cleanText(body.username, 24);
    const account = await db.prepare("SELECT * FROM forum_members WHERE username = ?").bind(username).first();
    if (!account || !validPassword(body.password) ||
      !secureEqual(await passwordHash(body.password, account.password_salt), account.password_hash)) {
      await recordLoginFailure(db, request);
      return fail("姓名或密码不正确。", 401);
    }
    await cleanupTransientData(db);
    return issueSession(db, request, { id: account.id, username: account.username, displayName: account.display_name || account.username, role: account.role });
  }
  if (action === "reset-password" && request.method === "POST") {
    const body = await readBody(request);
    const code = cleanText(body.code, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code) || !validPassword(body.password)) return fail("请填写有效的重设码和至少 12 位的新密码。");
    const codeHash = await sha256(code);
    const now = Date.now();
    const reset = await db.prepare("SELECT member_id FROM forum_password_resets WHERE code_hash = ? AND expires_at > ?")
      .bind(codeHash, now).first();
    if (!reset) return fail("重设码无效或已过期，请联系管理员重新获取。", 403);
    const salt = `${PASSWORD_ITERATIONS}:${randomHex()}`;
    const hash = await passwordHash(body.password, salt);
    const claimTime = Date.now();
    const results = await db.batch([
      db.prepare(`UPDATE forum_members SET password_salt = ?, password_hash = ?
        WHERE id = (SELECT member_id FROM forum_password_resets WHERE code_hash = ? AND expires_at > ?)`)
        .bind(salt, hash, codeHash, claimTime),
      db.prepare(`DELETE FROM forum_sessions WHERE member_id =
        (SELECT member_id FROM forum_password_resets WHERE code_hash = ? AND expires_at > ?)`)
        .bind(codeHash, claimTime),
      db.prepare("DELETE FROM forum_password_resets WHERE code_hash = ? AND expires_at > ?")
        .bind(codeHash, claimTime),
    ]);
    if (!results[0].meta.changes || !results[2].meta.changes) return fail("重设码无效或已过期，请联系管理员重新获取。", 403);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (action === "logout" && request.method === "POST") {
    const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)forum_session=([^;]+)/)?.[1];
    if (token) await db.prepare("DELETE FROM forum_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  return null;
}

async function handleTopics(db, request, segments, member) {
  const [root, id, action] = segments;
  if (root !== "topics") return null;
  if (!id && request.method === "GET") {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    const section = url.searchParams.get("section") || "";
    const sort = url.searchParams.get("sort") || "new";
    const search = cleanText(url.searchParams.get("q"), 80);
    if (category && !CATEGORIES.has(category)) return fail("分类不存在。");
    if (section && (category !== "discussion" || !DISCUSSION_SECTIONS.has(section))) return fail("共议分区不存在。");
    if (sort !== "new" && sort !== "likes") return fail("排序方式不存在。");
    const conditions = ["t.is_hidden = 0"];
    const args = [];
    if (category) { conditions.push("t.category = ?"); args.push(category); }
    if (section) { conditions.push("COALESCE(t.discussion_section, 'general') = ?"); args.push(section); }
    if (search) { conditions.push("(t.title LIKE ? OR t.body LIKE ?)"); args.push(`%${search}%`, `%${search}%`); }
    const where = conditions.join(" AND ");
    const page = pageNumber(url.searchParams.get("page"));
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM forum_topics t WHERE ${where}`).bind(...args).first();
    const rows = await db.prepare(`
      SELECT t.id, t.category,
        CASE WHEN t.category = 'discussion' THEN COALESCE(t.discussion_section, 'general') END AS discussionSection,
        t.title, SUBSTR(t.body, 1, 180) AS body, t.is_locked AS isLocked,
        t.is_pinned AS isPinned, t.is_featured AS isFeatured, t.created_at AS createdAt, t.updated_at AS updatedAt,
        COALESCE(m.display_name, m.username) AS author,
        (SELECT COUNT(*) FROM forum_replies r WHERE r.topic_id = t.id AND r.is_hidden = 0) AS replyCount,
        (SELECT COUNT(*) FROM forum_topic_likes l WHERE l.topic_id = t.id) AS likeCount,
        EXISTS(SELECT 1 FROM forum_topic_likes l WHERE l.topic_id = t.id AND l.member_id = ?) AS likedByMe
      FROM forum_topics t JOIN forum_members m ON m.id = t.author_id
      WHERE ${where} ORDER BY t.is_featured DESC, t.is_pinned DESC,
        ${sort === "likes" ? "likeCount DESC," : ""} t.created_at DESC, t.id DESC LIMIT ? OFFSET ?
    `).bind(member?.id || "", ...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
    return json({ topics: rows.results, total: count.total, page, pageSize: PAGE_SIZE });
  }
  if (!id && request.method === "POST") {
    const denied = requireMember(member);
    if (denied) return denied;
    const body = await readBody(request);
    const title = cleanText(body.title, 100);
    const content = cleanText(body.body, 10000);
    const category = cleanText(body.category, 20);
    const section = category === "discussion" ? cleanText(body.discussionSection ?? "general", 20) : null;
    if (title.length < 4 || title.length > 100 || content.length < 20 || content.length > 10000 || !CATEGORIES.has(category)) {
      return fail("请选择分类，并填写 4–100 字标题及 20–10000 字正文。");
    }
    if (category === "discussion" && !DISCUSSION_SECTIONS.has(section)) return fail("请选择有效的共议分区。");
    if (category === "notice" && member.role !== "admin") return fail("公告只可由管理员发布。", 403);
    const previous = await db.prepare("SELECT created_at AS createdAt FROM forum_topics WHERE author_id = ? ORDER BY created_at DESC LIMIT 1").bind(member.id).first();
    if (previous && Date.now() - previous.createdAt < 20000) return fail("请稍等 20 秒后再发布新主题。", 429);
    const topicId = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(`
      INSERT INTO forum_topics (id, author_id, category, discussion_section, title, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(topicId, member.id, category, section, title, content, now, now).run();
    return json({ id: topicId }, 201);
  }
  if (!id) return null;
  if (!action && ["PATCH", "DELETE"].includes(request.method)) {
    const denied = requireMember(member);
    if (denied) return denied;
    const current = await db.prepare("SELECT author_id AS authorId FROM forum_topics WHERE id = ? AND is_hidden = 0").bind(id).first();
    if (!current) return fail("主题不存在。", 404);
    if (current.authorId !== member.id && member.role !== "admin") return fail("只能修改自己的主题。", 403);
    if (request.method === "DELETE") {
      await db.prepare("UPDATE forum_topics SET is_hidden = 1, is_pinned = 0, is_featured = 0 WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    const body = await readBody(request);
    const title = cleanText(body.title, 100);
    const content = cleanText(body.body, 10000);
    if (title.length < 4 || title.length > 100 || content.length < 20 || content.length > 10000) return fail("标题需为 4–100 字，正文需为 20–10000 字。");
    await db.prepare("UPDATE forum_topics SET title = ?, body = ?, updated_at = ? WHERE id = ?")
      .bind(title, content, Date.now(), id).run();
    return json({ ok: true });
  }
  if (!action && request.method === "GET") {
    const url = new URL(request.url);
    const page = pageNumber(url.searchParams.get("page"));
    const topic = await db.prepare(`
      SELECT t.id, t.category,
        CASE WHEN t.category = 'discussion' THEN COALESCE(t.discussion_section, 'general') END AS discussionSection,
        t.title, t.body, t.is_locked AS isLocked, t.is_pinned AS isPinned,
        t.is_featured AS isFeatured, t.created_at AS createdAt, t.updated_at AS updatedAt,
        COALESCE(m.display_name, m.username) AS author, m.id AS authorId,
        (SELECT COUNT(*) FROM forum_topic_likes l WHERE l.topic_id = t.id) AS likeCount,
        EXISTS(SELECT 1 FROM forum_topic_likes l WHERE l.topic_id = t.id AND l.member_id = ?) AS likedByMe
      FROM forum_topics t JOIN forum_members m ON m.id = t.author_id
      WHERE t.id = ? AND t.is_hidden = 0
    `).bind(member?.id || "", id).first();
    if (!topic) return fail("主题不存在或已被移除。", 404);
    const count = await db.prepare("SELECT COUNT(*) AS total FROM forum_replies WHERE topic_id = ? AND is_hidden = 0").bind(id).first();
    const replies = await db.prepare(`
      SELECT r.id, r.body, r.created_at AS createdAt, COALESCE(m.display_name, m.username) AS author, m.id AS authorId
      FROM forum_replies r JOIN forum_members m ON m.id = r.author_id
      WHERE r.topic_id = ? AND r.is_hidden = 0 ORDER BY r.created_at, r.id LIMIT ? OFFSET ?
    `).bind(id, REPLY_PAGE_SIZE, (page - 1) * REPLY_PAGE_SIZE).all();
    return json({ topic, replies: replies.results, totalReplies: count.total, page, pageSize: REPLY_PAGE_SIZE });
  }
  if (action === "like" && ["POST", "DELETE"].includes(request.method)) {
    const denied = requireMember(member);
    if (denied) return denied;
    const topic = await db.prepare("SELECT author_id AS authorId FROM forum_topics WHERE id = ? AND is_hidden = 0").bind(id).first();
    if (!topic) return fail("主题不存在。", 404);
    if (topic.authorId === member.id) return fail("不能点亮自己的主题。", 403);
    if (request.method === "POST") {
      await db.prepare(`INSERT OR IGNORE INTO forum_topic_likes (topic_id, member_id, created_at)
        SELECT id, ?, ? FROM forum_topics WHERE id = ? AND is_hidden = 0 AND author_id <> ?`)
        .bind(member.id, Date.now(), id, member.id).run();
    } else {
      await db.prepare("DELETE FROM forum_topic_likes WHERE topic_id = ? AND member_id = ?").bind(id, member.id).run();
    }
    const count = await db.prepare("SELECT COUNT(*) AS total FROM forum_topic_likes WHERE topic_id = ?").bind(id).first();
    return json({ likeCount: count.total, likedByMe: request.method === "POST" });
  }
  if (action === "replies" && request.method === "POST") {
    const denied = requireMember(member);
    if (denied) return denied;
    const topic = await db.prepare("SELECT is_locked AS isLocked FROM forum_topics WHERE id = ? AND is_hidden = 0").bind(id).first();
    if (!topic) return fail("主题不存在。", 404);
    if (topic.isLocked) return fail("此主题已关闭回复。", 403);
    const body = await readBody(request);
    const content = cleanText(body.body, 3000);
    if (content.length < 2 || content.length > 3000) return fail("回复需为 2–3000 字。");
    const previous = await db.prepare("SELECT created_at AS createdAt FROM forum_replies WHERE author_id = ? ORDER BY created_at DESC LIMIT 1").bind(member.id).first();
    if (previous && Date.now() - previous.createdAt < 5000) return fail("请稍等 5 秒后再回复。", 429);
    const now = Date.now();
    await db.prepare("INSERT INTO forum_replies (id, topic_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, member.id, content, now).run();
    await db.prepare("UPDATE forum_topics SET updated_at = ? WHERE id = ?").bind(now, id).run();
    return json({ ok: true }, 201);
  }
  return null;
}

async function handleReplies(db, request, segments, member) {
  if (segments[0] !== "replies" || !segments[1] || segments[2] || !["PATCH", "DELETE"].includes(request.method)) return null;
  const denied = requireMember(member);
  if (denied) return denied;
  const reply = await db.prepare(`
    SELECT r.author_id AS authorId, r.topic_id AS topicId FROM forum_replies r
    JOIN forum_topics t ON t.id = r.topic_id
    WHERE r.id = ? AND r.is_hidden = 0 AND t.is_hidden = 0
  `).bind(segments[1]).first();
  if (!reply) return fail("回复不存在。", 404);
  if (reply.authorId !== member.id && member.role !== "admin") return fail("只能修改自己的回复。", 403);
  if (request.method === "DELETE") {
    await db.prepare("UPDATE forum_replies SET is_hidden = 1 WHERE id = ?").bind(segments[1]).run();
    return json({ ok: true });
  }
  const body = await readBody(request);
  const content = cleanText(body.body, 3000);
  if (content.length < 2 || content.length > 3000) return fail("回复需为 2–3000 字。");
  await db.prepare("UPDATE forum_replies SET body = ? WHERE id = ?").bind(content, segments[1]).run();
  await db.prepare("UPDATE forum_topics SET updated_at = ? WHERE id = ?").bind(Date.now(), reply.topicId).run();
  return json({ ok: true });
}

async function handleReports(db, request, segments, member) {
  if (segments[0] !== "reports" || request.method !== "POST" || segments.length !== 1) return null;
  const denied = requireMember(member);
  if (denied) return denied;
  const body = await readBody(request);
  const type = cleanText(body.targetType, 10);
  const targetId = cleanText(body.targetId, 40);
  const reason = cleanText(body.reason, 500);
  if (!['topic', 'reply'].includes(type) || !targetId || reason.length < 5 || reason.length > 500) return fail("请填写至少 5 字的举报原因。");
  const table = type === "topic" ? "forum_topics" : "forum_replies";
  const target = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND is_hidden = 0`).bind(targetId).first();
  if (!target) return fail("内容不存在。", 404);
  await db.prepare(`
    INSERT INTO forum_reports (id, reporter_id, target_type, target_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), member.id, type, targetId, reason, Date.now()).run();
  return json({ ok: true }, 201);
}

async function handleAdmin(db, request, segments, member) {
  if (segments[0] !== "admin") return null;
  const denied = requireAdmin(member);
  if (denied) return denied;
  const [, resource, id, action] = segments;
  if (resource === "invites" && request.method === "POST" && !id) {
    await cleanupTransientData(db);
    const code = randomHex(20);
    const now = Date.now();
    await db.prepare("INSERT INTO forum_invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(code), member.id, now, now + 7 * 86400000).run();
    return json({ code, expiresAt: now + 7 * 86400000 }, 201);
  }
  if (resource === "password-resets" && request.method === "POST" && !id) {
    const body = await readBody(request);
    const username = cleanText(body.username, 24);
    if (!USERNAME_PATTERN.test(username)) return fail("请填写有效的成员登录名。");
    const target = await db.prepare("SELECT id, username FROM forum_members WHERE username = ?").bind(username).first();
    if (!target) return fail("没有找到这个登录名。", 404);
    await cleanupTransientData(db);
    const code = randomHex(32);
    const now = Date.now();
    await db.prepare(`INSERT INTO forum_password_resets (member_id, code_hash, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(member_id) DO UPDATE SET code_hash = excluded.code_hash,
        created_by = excluded.created_by, created_at = excluded.created_at, expires_at = excluded.expires_at`)
      .bind(target.id, await sha256(code), member.id, now, now + 30 * 60000).run();
    return json({ code, username: target.username, expiresAt: now + 30 * 60000 }, 201);
  }
  if (resource === "reports" && request.method === "GET" && !id) {
    const result = await db.prepare(`
      SELECT r.id, r.target_type AS targetType, r.target_id AS targetId, r.reason,
        r.created_at AS createdAt, COALESCE(m.display_name, m.username) AS reporter,
        COALESCE(t.title, SUBSTR(p.body, 1, 60)) AS targetLabel,
        p.topic_id AS replyTopicId
      FROM forum_reports r JOIN forum_members m ON m.id = r.reporter_id
      LEFT JOIN forum_topics t ON r.target_type = 'topic' AND t.id = r.target_id
      LEFT JOIN forum_replies p ON r.target_type = 'reply' AND p.id = r.target_id
      WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100
    `).all();
    return json({ reports: result.results });
  }
  if (resource === "reports" && id && action === "resolve" && request.method === "POST") {
    await db.prepare("UPDATE forum_reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").bind(Date.now(), id).run();
    return json({ ok: true });
  }
  if (resource === "topics" && id && request.method === "POST" && action === "lock") {
    const result = await db.prepare("UPDATE forum_topics SET is_locked = 1 - is_locked WHERE id = ? AND is_hidden = 0").bind(id).run();
    return result.meta.changes ? json({ ok: true }) : fail("主题不存在。", 404);
  }
  if (resource === "topics" && id && request.method === "POST" && action === "pin") {
    const body = await readBody(request);
    if (typeof body.pinned !== "boolean") return fail("请指定是否置顶。", 400);
    const topic = await db.prepare("SELECT is_pinned AS isPinned FROM forum_topics WHERE id = ? AND is_hidden = 0").bind(id).first();
    if (!topic) return fail("主题不存在。", 404);
    if (Boolean(topic.isPinned) === body.pinned) return json({ ok: true });
    if (!body.pinned) {
      await db.prepare("UPDATE forum_topics SET is_pinned = 0 WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    const result = await db.prepare(`
      UPDATE forum_topics SET is_pinned = 1
      WHERE id = ? AND is_hidden = 0 AND is_pinned = 0
        AND (SELECT COUNT(*) FROM forum_topics WHERE is_pinned = 1 AND is_hidden = 0) < 3
    `).bind(id).run();
    return result.meta.changes ? json({ ok: true }) : fail("最多只能置顶 3 条主题。", 409);
  }
  if (resource === "topics" && id && request.method === "POST" && action === "feature") {
    const body = await readBody(request);
    if (typeof body.featured !== "boolean") return fail("请指定是否设为精品。", 400);
    const result = await db.prepare("UPDATE forum_topics SET is_featured = ? WHERE id = ? AND is_hidden = 0")
      .bind(Number(body.featured), id).run();
    return result.meta.changes ? json({ ok: true }) : fail("主题不存在。", 404);
  }
  if (resource === "topics" && id && request.method === "POST" && action === "section") {
    const body = await readBody(request);
    const section = cleanText(body.discussionSection, 20);
    if ("category" in body || !DISCUSSION_SECTIONS.has(section)) return fail("只能调整共议分区。");
    const result = await db.prepare("UPDATE forum_topics SET discussion_section = ? WHERE id = ? AND category = 'discussion' AND is_hidden = 0")
      .bind(section, id).run();
    return result.meta.changes ? json({ ok: true }) : fail("共议主题不存在。", 404);
  }
  if (resource === "topics" && id && request.method === "DELETE" && !action) {
    const result = await db.prepare("UPDATE forum_topics SET is_hidden = 1, is_pinned = 0, is_featured = 0 WHERE id = ? AND is_hidden = 0").bind(id).run();
    return result.meta.changes ? json({ ok: true }) : fail("主题不存在。", 404);
  }
  if (resource === "replies" && id && request.method === "DELETE" && !action) {
    const result = await db.prepare("UPDATE forum_replies SET is_hidden = 1 WHERE id = ? AND is_hidden = 0").bind(id).run();
    return result.meta.changes ? json({ ok: true }) : fail("回复不存在。", 404);
  }
  return null;
}

export async function handleForumRequest(context) {
  const { request, env } = context;
  if (!env.FORUM_DB) return fail("论坛数据库尚未绑定，请在 Cloudflare 中配置 FORUM_DB。", 503);
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return fail("请求方式不受支持。", 405);
  if (request.method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin) {
    return fail("请求来源无效。", 403);
  }
  const segments = new URL(request.url).pathname.split("/").filter(Boolean).slice(2);
  if (!segments.length || segments.length > 4) return fail("接口不存在。", 404);
  try {
    const member = await sessionMember(env.FORUM_DB, request);
    return await handleSaintLightRequest(context, member, segments)
      || await handleAuth(context, env.FORUM_DB, segments, member)
      || await handleTopics(env.FORUM_DB, request, segments, member)
      || await handleReplies(env.FORUM_DB, request, segments, member)
      || await handleReports(env.FORUM_DB, request, segments, member)
      || await handleAdmin(env.FORUM_DB, request, segments, member)
      || fail("接口不存在。", 404);
  } catch (error) {
    if (["内容过长。", "提交格式不正确。", "请提交 JSON 数据。"].includes(error.message)) return fail(error.message);
    console.error("Forum request failed", error);
    return fail("论坛暂时无法处理请求，请稍后再试。", 500);
  }
}

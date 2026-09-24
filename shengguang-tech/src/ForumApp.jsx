import { useCallback, useEffect, useState } from "react";

const categories = [
  { id: "", label: "全部" },
  { id: "notice", label: "公告" },
  { id: "technology", label: "技术" },
  { id: "discussion", label: "共议" },
];

const categoryLabel = (id) => categories.find((item) => item.id === id)?.label || "讨论";
const dateLabel = (value) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

async function forumApi(path, options = {}) {
  const response = await fetch(`/api/forum/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("论坛 API 尚未启动。请使用完整论坛预览服务。");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试。");
  return payload;
}

function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="forum-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`forum-modal ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="forum-modal-title">
        <div className="forum-modal-head">
          <h2 id="forum-modal-title">{title}</h2>
          <button className="forum-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function ForumApp() {
  const [member, setMember] = useState(null);
  const [status, setStatus] = useState(null);
  const [feed, setFeed] = useState({ topics: [], total: 0, page: 1, pageSize: 20 });
  const [feedPage, setFeedPage] = useState(1);
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState(new URLSearchParams(window.location.search).get("topic"));
  const [topicPage, setTopicPage] = useState(1);
  const [topic, setTopic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", inviteCode: "", setupKey: "" });
  const [draft, setDraft] = useState({ category: "discussion", title: "", body: "" });
  const [reply, setReply] = useState("");
  const [editedReply, setEditedReply] = useState({ id: "", body: "" });
  const [reportReason, setReportReason] = useState("");
  const [reportTarget, setReportTarget] = useState(null);
  const [reports, setReports] = useState([]);
  const [newInvite, setNewInvite] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadFeed = useCallback(async () => {
    const params = new URLSearchParams({ page: String(feedPage) });
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    setFeed(await forumApi(`topics?${params}`));
  }, [category, query, feedPage]);

  const loadTopic = useCallback(async () => {
    if (!topicId) return;
    setTopic(await forumApi(`topics/${encodeURIComponent(topicId)}?page=${topicPage}`));
  }, [topicId, topicPage]);

  const loadReports = useCallback(async () => {
    setReports((await forumApi("admin/reports")).reports);
  }, []);

  useEffect(() => {
    document.title = "圣光会论坛 · 圣光科技";
    const onPopState = () => {
      setTopicId(new URLSearchParams(window.location.search).get("topic"));
      setTopicPage(1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([forumApi("status"), forumApi("me")])
      .then(([nextStatus, current]) => {
        if (!cancelled) { setStatus(nextStatus); setMember(current.member); }
      })
      .catch((cause) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const request = topicId ? loadTopic() : loadFeed();
    request.catch((cause) => { if (!cancelled) setError(cause.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [topicId, loadTopic, loadFeed]);

  function navigateTopic(id) {
    const url = id ? `/forum?topic=${encodeURIComponent(id)}` : "/forum";
    window.history.pushState({}, "", url);
    setTopicId(id);
    setTopicPage(1);
    setTopic(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAuth(mode = "login") { setAuthMode(mode); setDialog("auth"); }
  function requireLogin(next) { if (member) next(); else openAuth(); }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await forumApi(authMode === "setup" ? "bootstrap" : authMode === "register" ? "register" : "login", {
        method: "POST", body: JSON.stringify(authForm),
      });
      setMember(result.member);
      setStatus({ setupRequired: false, setupEnabled: false });
      setAuthForm({ username: "", password: "", inviteCode: "", setupKey: "" });
      setDialog("");
      setNotice(`欢迎，${result.member.username}。`);
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    try {
      await forumApi("logout", { method: "POST", body: "{}" });
      setMember(null);
      setDialog("");
      setNotice("已退出成员账号。");
    } catch (cause) { setNotice(cause.message); }
  }

  async function publishTopic(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await forumApi("topics", { method: "POST", body: JSON.stringify(draft) });
      setDraft({ category: "discussion", title: "", body: "" });
      setDialog("");
      navigateTopic(result.id);
      setNotice("主题已发布。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function publishReply(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await forumApi(`topics/${topicId}/replies`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply("");
      const lastPage = Math.ceil((topic.totalReplies + 1) / topic.pageSize);
      if (lastPage === topicPage) await loadTopic();
      else setTopicPage(lastPage);
      setNotice("回复已发布。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function saveTopic(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await forumApi(`topics/${topicId}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, body: draft.body }) });
      setDialog("");
      await loadTopic();
      setNotice("主题已更新。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function saveReply(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await forumApi(`replies/${editedReply.id}`, { method: "PATCH", body: JSON.stringify({ body: editedReply.body }) });
      setDialog("");
      await loadTopic();
      setNotice("回复已更新。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function removeOwn(path, isTopic) {
    setBusy(true);
    try {
      await forumApi(path, { method: "DELETE" });
      if (isTopic) navigateTopic(null);
      else await loadTopic();
      setNotice("内容已撤回。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  function askRemoval(path, isTopic, isAdmin = false) {
    setPendingRemoval({ path, isTopic, isAdmin });
    setDialog("confirm");
  }

  function confirmRemoval() {
    if (!pendingRemoval) return;
    setDialog("");
    if (pendingRemoval.isAdmin) adminAction(pendingRemoval.path, "DELETE");
    else removeOwn(pendingRemoval.path, pendingRemoval.isTopic);
    setPendingRemoval(null);
  }

  async function submitReport(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await forumApi("reports", { method: "POST", body: JSON.stringify({ ...reportTarget, reason: reportReason }) });
      setDialog("");
      setReportReason("");
      setNotice("举报已提交给管理员。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function adminAction(path, method = "POST") {
    setBusy(true);
    try {
      await forumApi(`admin/${path}`, { method, body: method === "POST" ? "{}" : undefined });
      if (path.startsWith("reports/")) await loadReports();
      if (path.startsWith("topics/") && method === "DELETE") navigateTopic(null);
      else if (topicId) await loadTopic();
      else await loadFeed();
      setNotice("操作已完成。");
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  async function createInvite() {
    setBusy(true);
    try {
      setNewInvite((await forumApi("admin/invites", { method: "POST", body: "{}" })).code);
    } catch (cause) { setNotice(cause.message); }
    finally { setBusy(false); }
  }

  function openReport(targetType, targetId) {
    requireLogin(() => { setReportTarget({ targetType, targetId }); setReportReason(""); setDialog("report"); });
  }

  const topicCount = Math.ceil(feed.total / feed.pageSize);
  const replyCount = topic ? Math.ceil(topic.totalReplies / topic.pageSize) : 0;

  return (
    <main className="forum-page">
      <div className="forum-scene" aria-hidden="true" />
      <header className="forum-header">
        <a className="forum-brand" href="/"><span className="brand-orbit" aria-hidden="true" />圣光科技</a>
        <nav aria-label="论坛导航">
          <a href="/">首页</a>
          <a className="is-current" href="/forum" aria-current="page">论坛</a>
          {member?.role === "admin" && <button type="button" onClick={() => { setDialog("admin"); loadReports().catch((cause) => setNotice(cause.message)); }}>管理</button>}
          {member ? <button type="button" onClick={logout}>{member.username} · 退出</button> :
            <button type="button" onClick={() => openAuth(status?.setupRequired ? "setup" : "login")}>{status?.setupRequired ? "初始化" : "成员登录"}</button>}
        </nav>
      </header>

      <div className="forum-layout">
        <section className="forum-intro" aria-labelledby="forum-title">
          <div className="forum-intro-copy">
            <p className="forum-overline">SACRED LIGHT / COMMON GROUND</p>
            <h1 id="forum-title">圣光会<span>论坛</span></h1>
            <p>让观点有序汇聚，让探索持续发生。</p>
          </div>
          <div className="forum-intro-rule" aria-hidden="true"><span>共识 / 交流 / 探索</span></div>
        </section>

        <div className="forum-workspace">
          <aside className="forum-sidebar" aria-label="论坛分类">
            <div className="forum-side-heading">讨论空间</div>
            <div className="forum-categories">
              {categories.map((item) => <button key={item.id} type="button" className={!topicId && category === item.id ? "is-active" : ""}
                onClick={() => { navigateTopic(null); setCategory(item.id); setFeedPage(1); }}>{item.label}</button>)}
            </div>
            <div className="forum-side-note">公开阅读<br />受邀成员参与讨论</div>
          </aside>

          <section className="forum-main" aria-label={topicId ? "主题详情" : "主题列表"}>
            {!topicId ? <>
              <div className="forum-toolbar">
                <div>
                  <p className="forum-overline">FORUM / DISCUSSIONS</p>
                  <h2>{categoryLabel(category)}主题</h2>
                </div>
                <button className="forum-primary" type="button" onClick={() => requireLogin(() => setDialog("compose"))}>发布主题</button>
              </div>
              <form className="forum-search" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); setFeedPage(1); }}>
                <input aria-label="搜索主题" placeholder="搜索主题或正文" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={80} />
                <button type="submit">搜索</button>
              </form>
              {query && <button className="forum-clear-search" type="button" onClick={() => { setQuery(""); setSearchInput(""); setFeedPage(1); }}>清除搜索：{query}</button>}
              {loading ? <div className="forum-empty">正在读取讨论...</div> : error ? <div className="forum-empty is-error">{error}</div> : feed.topics.length ? <>
                <div className="forum-list">
                  {feed.topics.map((item) => <button className="forum-topic-row" key={item.id} type="button" onClick={() => navigateTopic(item.id)}>
                    <span className="forum-topic-meta">{categoryLabel(item.category)}{item.isLocked ? " · 已关闭" : ""}</span>
                    <span className="forum-topic-title">{item.title}</span>
                    <span className="forum-topic-excerpt">{item.body}</span>
                    <span className="forum-topic-foot">{item.author} <span>{dateLabel(item.updatedAt)}</span><span>{item.replyCount} 条回复</span></span>
                  </button>)}
                </div>
                {topicCount > 1 && <div className="forum-pagination"><button disabled={feedPage <= 1} onClick={() => setFeedPage(feedPage - 1)}>上一页</button><span>{feedPage} / {topicCount}</span><button disabled={feedPage >= topicCount} onClick={() => setFeedPage(feedPage + 1)}>下一页</button></div>}
              </> : <div className="forum-empty">{query ? "没有找到相关主题。" : status?.setupRequired ? "论坛尚未初始化，管理员创建账号后即可开始讨论。" : "这里还没有主题。开始第一场讨论。"}</div>}
            </> : <>
              <button className="forum-back" type="button" onClick={() => navigateTopic(null)}>← 返回主题列表</button>
              {loading && !topic ? <div className="forum-empty">正在读取主题...</div> : error ? <div className="forum-empty is-error">{error}</div> : topic ? <>
                <article className="forum-article">
                  <div className="forum-article-meta">{categoryLabel(topic.topic.category)} · {dateLabel(topic.topic.createdAt)} {topic.topic.isLocked ? "· 已关闭回复" : ""}</div>
                  <h2>{topic.topic.title}</h2>
                  <div className="forum-byline">由 {topic.topic.author} 发布</div>
                  <div className="forum-body-text">{topic.topic.body}</div>
                  <div className="forum-actions">
                    <button type="button" onClick={() => openReport("topic", topic.topic.id)}>举报</button>
                    {member?.id === topic.topic.authorId && <>
                      <button type="button" onClick={() => { setDraft({ category: topic.topic.category, title: topic.topic.title, body: topic.topic.body }); setDialog("editTopic"); }}>编辑</button>
                      {member.role !== "admin" && <button type="button" disabled={busy} onClick={() => askRemoval(`topics/${topicId}`, true)}>撤回</button>}
                    </>}
                    {member?.role === "admin" && <>
                      <button disabled={busy} type="button" onClick={() => adminAction(`topics/${topicId}/lock`)}>{topic.topic.isLocked ? "开放回复" : "关闭回复"}</button>
                      <button disabled={busy} type="button" onClick={() => askRemoval(`topics/${topicId}`, true, true)}>移除主题</button>
                    </>}
                  </div>
                </article>
                <div className="forum-replies-heading"><h3>回复 <span>{topic.totalReplies}</span></h3></div>
                {topic.replies.map((item) => <article className="forum-reply" key={item.id}>
                  <div className="forum-reply-head"><strong>{item.author}</strong><time>{dateLabel(item.createdAt)}</time></div>
                  <div className="forum-body-text">{item.body}</div>
                  <div className="forum-actions"><button type="button" onClick={() => openReport("reply", item.id)}>举报</button>
                    {member?.id === item.authorId && <>
                      <button type="button" onClick={() => { setEditedReply({ id: item.id, body: item.body }); setDialog("editReply"); }}>编辑</button>
                      {member.role !== "admin" && <button disabled={busy} type="button" onClick={() => askRemoval(`replies/${item.id}`, false)}>撤回</button>}
                    </>}
                    {member?.role === "admin" && <button disabled={busy} type="button" onClick={() => askRemoval(`replies/${item.id}`, false, true)}>移除</button>}</div>
                </article>)}
                {replyCount > 1 && <div className="forum-pagination"><button disabled={topicPage <= 1} onClick={() => setTopicPage(topicPage - 1)}>上一页</button><span>{topicPage} / {replyCount}</span><button disabled={topicPage >= replyCount} onClick={() => setTopicPage(topicPage + 1)}>下一页</button></div>}
                {!topic.topic.isLocked && (member ? <form className="forum-reply-form" onSubmit={publishReply}><label htmlFor="forum-reply">参与讨论</label><textarea id="forum-reply" value={reply} onChange={(event) => setReply(event.target.value)} minLength={2} maxLength={3000} placeholder="写下你的想法..." required /><button className="forum-primary" type="submit" disabled={busy}>发布回复</button></form> : <button className="forum-login-prompt" type="button" onClick={() => openAuth()}>登录成员账号，参与讨论</button>)}
              </> : null}
            </>}
          </section>
        </div>
        <footer className="forum-footer"><span>圣光国际联邦</span><a href="/">返回官网</a></footer>
      </div>

      {notice && <div className="forum-notice" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}

      {dialog === "auth" && <Modal title={authMode === "setup" ? "创建论坛管理员" : authMode === "register" ? "邀请码注册" : "成员登录"} onClose={() => setDialog("")}>
        <form className="forum-form" onSubmit={submitAuth}>
          {authMode !== "setup" && <div className="forum-mode-switch"><button type="button" className={authMode === "login" ? "is-active" : ""} onClick={() => setAuthMode("login")}>登录</button><button type="button" className={authMode === "register" ? "is-active" : ""} onClick={() => setAuthMode("register")}>邀请码注册</button></div>}
          {authMode === "setup" && <><p className="forum-form-note">仅首次启用时使用。请填写 Cloudflare 中配置的初始化密钥。</p><label>初始化密钥<input type="password" value={authForm.setupKey} onChange={(event) => setAuthForm({ ...authForm, setupKey: event.target.value })} required /></label></>}
          {authMode === "register" && <label>邀请码<input value={authForm.inviteCode} onChange={(event) => setAuthForm({ ...authForm, inviteCode: event.target.value })} autoComplete="off" required /></label>}
          <label>成员姓名<input autoFocus value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} minLength={2} maxLength={24} autoComplete="username" required /></label>
          <label>密码<input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} minLength={12} maxLength={128} autoComplete={authMode === "login" ? "current-password" : "new-password"} required /></label>
          <button className="forum-primary" type="submit" disabled={busy}>{busy ? "正在提交..." : authMode === "setup" ? "创建管理员" : authMode === "register" ? "注册并进入" : "登录"}</button>
        </form>
      </Modal>}

      {dialog === "compose" && <Modal title="发布主题" onClose={() => setDialog("")} wide>
        <form className="forum-form" onSubmit={publishTopic}>
          <label>分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.filter((item) => item.id && (item.id !== "notice" || member?.role === "admin")).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label>标题<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} minLength={4} maxLength={100} placeholder="为讨论起一个清晰的标题" required /></label>
          <label>正文<textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} minLength={20} maxLength={10000} placeholder="写下背景、想法或问题..." required /></label>
          <button className="forum-primary" type="submit" disabled={busy}>发布主题</button>
        </form>
      </Modal>}

      {dialog === "editTopic" && <Modal title="编辑主题" onClose={() => setDialog("")} wide>
        <form className="forum-form" onSubmit={saveTopic}>
          <label>标题<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} minLength={4} maxLength={100} required /></label>
          <label>正文<textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} minLength={20} maxLength={10000} required /></label>
          <button className="forum-primary" type="submit" disabled={busy}>保存修改</button>
        </form>
      </Modal>}

      {dialog === "editReply" && <Modal title="编辑回复" onClose={() => setDialog("")}>
        <form className="forum-form" onSubmit={saveReply}>
          <label>回复<textarea autoFocus value={editedReply.body} onChange={(event) => setEditedReply({ ...editedReply, body: event.target.value })} minLength={2} maxLength={3000} required /></label>
          <button className="forum-primary" type="submit" disabled={busy}>保存修改</button>
        </form>
      </Modal>}

      {dialog === "report" && <Modal title="举报内容" onClose={() => setDialog("")}>
        <form className="forum-form" onSubmit={submitReport}><label>原因<textarea autoFocus value={reportReason} onChange={(event) => setReportReason(event.target.value)} minLength={5} maxLength={500} placeholder="请说明需要管理员处理的原因" required /></label><button className="forum-primary" type="submit" disabled={busy}>提交举报</button></form>
      </Modal>}

      {dialog === "confirm" && <Modal title={pendingRemoval?.isAdmin ? "确认移除" : "确认撤回"} onClose={() => setDialog("")}>
        <p className="forum-confirm-copy">{pendingRemoval?.isTopic ? "此主题及其回复将不再对访客显示。" : "这条回复将不再对访客显示。"}</p>
        <div className="forum-confirm-actions"><button type="button" onClick={() => setDialog("")}>取消</button><button className="forum-primary" type="button" onClick={confirmRemoval}>确认</button></div>
      </Modal>}

      {dialog === "admin" && <Modal title="论坛管理" onClose={() => { setDialog(""); setNewInvite(""); }} wide>
        <div className="forum-admin">
          <section><h3>成员邀请</h3><p>邀请码有效期为 7 天，只能使用一次。</p><button className="forum-primary" type="button" onClick={createInvite} disabled={busy}>生成邀请码</button>{newInvite && <div className="forum-invite"><code>{newInvite}</code><button type="button" onClick={() => navigator.clipboard.writeText(newInvite).then(() => setNotice("邀请码已复制。")).catch(() => setNotice("复制失败，请手动选择邀请码。"))}>复制</button></div>}</section>
          <section><h3>待处理举报</h3>{reports.length ? reports.map((item) => <div className="forum-report" key={item.id}><strong>{item.targetLabel || item.targetId}</strong><p>{item.reason}</p><small>{item.reporter} · {dateLabel(item.createdAt)}</small><div><button type="button" onClick={() => { setDialog(""); navigateTopic(item.targetType === "topic" ? item.targetId : item.replyTopicId); }}>查看内容</button><button type="button" onClick={() => adminAction(`reports/${item.id}/resolve`)} disabled={busy}>标记已处理</button></div></div>) : <p>暂无待处理举报。</p>}</section>
        </div>
      </Modal>}
    </main>
  );
}

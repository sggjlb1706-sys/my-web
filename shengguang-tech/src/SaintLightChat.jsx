import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import "./saint-light-chat.css";

async function saintLightApi(path, options = {}) {
  const response = await fetch(`/api/forum/saint-light/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("聊天接口尚未启动。请使用完整论坛预览服务。");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "请求失败，请稍后再试。");
  return result;
}

export function SaintLightChat() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("chat");
  const [status, setStatus] = useState(null);
  const [help, setHelp] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const launcherRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await saintLightApi("status"));
    } catch (cause) {
      setError(cause.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    refreshStatus();
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open, refreshStatus]);

  useEffect(() => {
    const onAuthChange = () => {
      setMessages([]);
      setDraft("");
      setHelp([]);
      setMode("chat");
      if (open) { setError(""); refreshStatus(); }
    };
    window.addEventListener("forum-auth-change", onAuthChange);
    return () => window.removeEventListener("forum-auth-change", onAuthChange);
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!open || mode !== "help" || !status?.member || help.length) return;
    saintLightApi("help").then((result) => setHelp(result.items)).catch((cause) => setError(cause.message));
  }, [open, mode, status?.member, help.length]);

  useEffect(() => { if (open && mode === "chat") endRef.current?.scrollIntoView({ block: "end" }); }, [messages, open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function send(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !status?.enabled || Array.from(message).length > status.inputLimit) return;
    const history = messages.slice(-4);
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const result = await saintLightApi("chat", { method: "POST", body: JSON.stringify({ message, history }) });
      setMessages((current) => [...current, { role: "assistant", content: result.reply }]);
      if (typeof result.remaining === "number") setStatus((current) => ({ ...current, remaining: result.remaining }));
    } catch (cause) {
      setMessages((current) => current.slice(0, -1));
      setDraft(message);
      setError(cause.message);
      refreshStatus();
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const length = Array.from(draft).length;
  return (
    <div className="saint-light-root">
      {open && (
        <section className="saint-light-panel" role="dialog" aria-label="与洛筠圣琳聊天">
          <div className="saint-light-art" role="img" aria-label="洛筠圣琳的角色形象">
            <div className="saint-light-art-copy">
              <span>圣光娘 · AI</span>
              <h2>洛筠圣琳</h2>
            </div>
            <button type="button" className="saint-light-icon saint-light-close" title="关闭聊天" aria-label="关闭聊天" onClick={() => { setOpen(false); launcherRef.current?.focus(); }}><X size={18} /></button>
          </div>
          <div className="saint-light-bar">
            <div className="saint-light-tabs" role="tablist" aria-label="聊天视图">
              <button type="button" role="tab" aria-selected={mode === "chat"} className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}><MessageCircle size={15} /> 闲聊</button>
              {status?.member && <button type="button" role="tab" aria-selected={mode === "help"} className={mode === "help" ? "active" : ""} onClick={() => setMode("help")}><BookOpen size={15} /> 论坛帮助</button>}
            </div>
            {mode === "chat" && <button type="button" className="saint-light-icon" title="清空当前对话" aria-label="清空当前对话" disabled={!messages.length || busy} onClick={() => setMessages([])}><RotateCcw size={16} /></button>}
          </div>
          {mode === "help" ? (
            <div className="saint-light-help" role="tabpanel">
              {help.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.body}</p><a href={item.href}>前往论坛 <span aria-hidden="true">↗</span></a></article>)}
            </div>
          ) : (
            <>
              <div className="saint-light-messages" role="log" aria-live="polite">
                <div className="saint-light-message assistant">你好，我是洛筠圣琳。今天想聊些什么？</div>
                {messages.map((item, index) => <div key={index} className={`saint-light-message ${item.role}`}>{item.content}</div>)}
                {busy && <div className="saint-light-message assistant is-thinking">正在回应…</div>}
                <div ref={endRef} />
              </div>
              <div className="saint-light-composer">
                {error && <p className="saint-light-error" role="alert">{error}</p>}
                {!status?.enabled && !error && <p className="saint-light-error">圣光娘暂未启用。</p>}
                <form onSubmit={send}>
                  <label className="saint-light-sr-only" htmlFor="saint-light-input">发送给洛筠圣琳</label>
                  <textarea id="saint-light-input" ref={inputRef} rows="2" value={draft} disabled={!status?.enabled || busy} maxLength={status?.inputLimit || 800} placeholder="说说今天的事…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(event); } }} />
                  <button type="submit" title="发送消息" aria-label="发送消息" disabled={!status?.enabled || busy || !draft.trim() || length > status.inputLimit}><ArrowUp size={18} /></button>
                </form>
                <div className="saint-light-meta"><span>{status ? `今日 ${status.remaining}/${status.dailyLimit} · 每10分钟${status.burstLimit}次` : "正在连接…"}</span><span>{length}/{status?.inputLimit || 800}</span></div>
                <p className="saint-light-privacy">本站不保存对话；发送的文字会由千问处理。</p>
              </div>
            </>
          )}
        </section>
      )}
      <button ref={launcherRef} type="button" className="saint-light-launcher" aria-expanded={open} aria-label={open ? "收起圣光娘聊天" : "与圣光娘聊天"} title={open ? "收起聊天" : "与洛筠圣琳聊天"} onClick={() => setOpen((current) => !current)}><Sparkles size={18} /><span>圣光娘</span></button>
    </div>
  );
}

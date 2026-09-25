import { useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { renderMath, splitMathSegments } from "./forum-math.js";

export function MathContent({ text, className = "" }) {
  return <div className={className}>
    {splitMathSegments(text || "").map((segment, index) => {
      if (segment.type === "text") return <span key={index}>{segment.value}</span>;
      const html = renderMath(segment.source, segment.display);
      if (!html) return <span className="forum-math-fallback" key={index} title="公式无法解析，显示原文">{segment.raw}</span>;
      return <span className={segment.display ? "forum-math-display" : "forum-math-inline"} key={index} dangerouslySetInnerHTML={{ __html: html }} />;
    })}
  </div>;
}

export function MathEditor({ id, label, value, onChange, minLength, maxLength, placeholder, autoFocus = false }) {
  const textarea = useRef(null);
  const [showPreview, setShowPreview] = useState(false);

  function insertFormula(display) {
    const field = textarea.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const opening = display ? "\\[" : "\\(";
    const closing = display ? "\\]" : "\\)";
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${opening}${selected}${closing}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + opening.length, start + opening.length + selected.length);
    });
  }

  return <div className="forum-math-editor">
    <div className="forum-math-editor-head">
      <label htmlFor={id}>{label}</label>
      <div className="forum-math-tools">
        <button type="button" onClick={() => insertFormula(false)} title="在光标处插入行内公式">∑ 行内</button>
        <button type="button" onClick={() => insertFormula(true)} title="在光标处插入独立公式">∑ 独立</button>
        <button type="button" aria-pressed={showPreview} onClick={() => setShowPreview((current) => !current)}>{showPreview ? "收起预览" : "预览"}</button>
      </div>
    </div>
    <textarea ref={textarea} id={id} autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} minLength={minLength} maxLength={maxLength} placeholder={placeholder} required />
    {showPreview && <div className="forum-math-preview" aria-label="内容预览"><MathContent text={value} className="forum-body-text" /></div>}
  </div>;
}

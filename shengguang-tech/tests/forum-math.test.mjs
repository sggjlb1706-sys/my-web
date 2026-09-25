import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMath, splitMathSegments } from "../src/forum-math.js";

test("inline and display formulas preserve surrounding text and source", () => {
  const body = String.raw`速度 \(v=\frac{s}{t}\)，能量 \[E=mc^2\]。`;
  const parts = splitMathSegments(body);
  assert.deepEqual(parts.map((part) => part.type), ["text", "math", "text", "math", "text"]);
  assert.equal(parts[1].source, String.raw`v=\frac{s}{t}`);
  assert.equal(parts[1].display, false);
  assert.equal(parts[3].source, "E=mc^2");
  assert.equal(parts[3].display, true);
  assert.equal(parts.map((part) => part.type === "text" ? part.value : part.raw).join(""), body);
});

test("dollar delimiters render while escaped or unmatched input stays literal", () => {
  const body = String.raw`价格 \$5；行内 $x^2$；独立 $$\sum_{i=1}^n i$$；未闭合 $x`;
  const parts = splitMathSegments(body);
  assert.deepEqual(parts.filter((part) => part.type === "math").map((part) => part.display), [false, true]);
  assert.equal(parts.map((part) => part.type === "text" ? part.value : part.raw).join(""), body);
});

test("valid LaTeX renders, while unsupported or oversized input falls back to source", () => {
  const html = renderMath(String.raw`\frac{a}{b}`, false);
  assert.match(html, /class="katex"/);
  assert.equal(renderMath(String.raw`\notARealCommand{x}`, false), null);
  assert.equal(renderMath("x".repeat(2001), false), null);
  assert.equal(renderMath(String.raw`\htmlClass{danger}{x}`, false), null);
  assert.doesNotMatch(renderMath(String.raw`\text{<script>alert(1)</script>}`, false), /<script>/);
});

import katex from "katex";

const delimiters = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
];

function isEscaped(text, position) {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

export function splitMathSegments(text) {
  const segments = [];
  let plainStart = 0;
  let position = 0;
  let formulas = 0;

  while (position < text.length && formulas < 40) {
    const delimiter = !isEscaped(text, position) && delimiters.find((item) => text.startsWith(item.open, position));
    if (!delimiter) { position += 1; continue; }

    const sourceStart = position + delimiter.open.length;
    let closeAt = text.indexOf(delimiter.close, sourceStart);
    while (closeAt !== -1 && isEscaped(text, closeAt)) closeAt = text.indexOf(delimiter.close, closeAt + 1);
    if (closeAt === -1) { position += delimiter.open.length; continue; }

    if (plainStart < position) segments.push({ type: "text", value: text.slice(plainStart, position) });
    const end = closeAt + delimiter.close.length;
    segments.push({ type: "math", source: text.slice(sourceStart, closeAt), raw: text.slice(position, end), display: delimiter.display });
    formulas += 1;
    position = end;
    plainStart = end;
  }

  if (plainStart < text.length) segments.push({ type: "text", value: text.slice(plainStart) });
  return segments;
}

export function renderMath(source, display) {
  if (!source.trim() || source.length > 2000) return null;
  try {
    return katex.renderToString(source, {
      displayMode: display,
      output: "htmlAndMathml",
      throwOnError: true,
      trust: false,
      strict: "error",
      maxExpand: 100,
      maxSize: 10,
    });
  } catch {
    return null;
  }
}

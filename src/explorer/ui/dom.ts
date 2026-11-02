/** Tiny DOM helper: el("div", "cls", "text" | child | children). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  content?: string | Node | Array<string | Node>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined) e.append(...(Array.isArray(content) ? content : [content]));
  return e;
}

/** Display title: ForTy v2 carries its beta status as a chip, not in the text. */
export function displayTitle(title: string): string {
  return title.replace(/\s*\(beta\)/i, "");
}

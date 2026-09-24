/**
 * Fill an inline element with text that may hold several paragraphs: the first continues the
 * line it's on, and each later one starts a paragraph of its own, spaced like the essay's
 * (.essay .widget-para). Used for suggested insertions and rewrites shown in the essay.
 */
export function fillParagraphs(el: HTMLElement, text: string) {
  text.split("\n").forEach((line, i) => {
    if (i === 0) {
      el.appendChild(document.createTextNode(line));
      return;
    }
    const para = document.createElement("span");
    para.className = "widget-para";
    // An empty paragraph still takes up its line.
    para.textContent = line || "\u00a0";
    el.appendChild(para);
  });
}

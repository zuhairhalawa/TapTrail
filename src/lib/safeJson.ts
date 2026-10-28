/**
 * Serialize data so it can sit inside an HTML <script type="application/json"> block.
 * JSON.stringify output could still contain "</script>", "<!--" or line separators that
 * break out of (or confuse) the HTML parser, so every dangerous character is \u-escaped.
 * The result is still valid JSON that decodes to exactly the original value.
 */
export function serializeForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
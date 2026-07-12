// Serialize an object for embedding inside a <script type="application/ld+json">
// via set:html. Plain JSON.stringify does NOT escape "<", so a DB value
// containing "</script>" would close the tag and inject markup (stored XSS).
// Escaping the characters that can break out of a script element keeps the
// JSON valid (they become \u00XX escapes) while making breakout impossible.
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

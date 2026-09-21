/**
 * `hd/text-opacity-floor` — no text below the /85 opacity floor (HD-023).
 *
 * `--color-bevel-dark` at /85 is 4.89:1 on `raised-surface`, the darkest
 * surface it sits on; below that it fails WCAG AA (CLAUDE.md, "Three-tier text
 * ramp"). The floor was a convention and nothing held it, so it eroded one
 * `/60` at a time — facet counts at `opacity-50`, a year label at
 * `text-[7px] opacity-50` (about 2.2:1), and the rest of the list in HD-023.
 *
 * Checked: class strings in a JSX `className` and in the arguments of
 * `cn()` / `clsx()` — string literals, template literals, and the branches of
 * `?:` / `&&` / `||`, arrays and object keys inside them.
 *
 * - `text-<color>/NN` with NN below the floor, under any variant (`hover:`,
 *   `placeholder:` …). A font-size/line-height pair (`text-sm/6`,
 *   `text-hd-12/5`) is not a colour and is skipped.
 * - `opacity-NN` below the floor. Whether an element carries text cannot be
 *   decided statically — a class set is often assembled in one place and the
 *   text supplied in another — so every one is flagged. An element that
 *   genuinely carries no text (a dot, a rule, an icon glyph that is also
 *   labelled) takes an `eslint-disable-next-line` with a comment saying so.
 *   Two cases are allowed outright: `opacity-0` (and `text-<color>/0`),
 *   which is not dim text but no text (a reveal-on-hover control), and the `disabled:` / `aria-disabled:`
 *   variants, because WCAG 1.4.3 exempts inactive components.
 */

/** The dimmest text opacity allowed, in percent. */
export const TEXT_OPACITY_FLOOR = 85;

/** Tailwind font-size names: `text-<size>/<n>` is a line height, not a colour. */
const SIZE_BASE = /^(xs|sm|base|lg|\d?xl|hd-[\w-]+|\[[\d.]+(px|rem|em)\])$/;
const TEXT_ALPHA = /^text-(.+)\/(\d+|\[[\d.]+%?\])$/;
const OPACITY = /^opacity-(\d+|\[[\d.]+%?\])$/;
const EXEMPT_VARIANTS = new Set(["disabled", "aria-disabled"]);
const CLASS_FUNCTIONS = new Set(["cn", "clsx"]);

/** `50` → 50, `[0.5]` → 50, `[50%]` → 50. */
function percent(raw) {
  if (!raw.startsWith("[")) return Number(raw);
  const inner = raw.slice(1, -1);
  return inner.endsWith("%") ? Number(inner.slice(0, -1)) : Number(inner) * 100;
}

/** The offending class tokens in one class string, with the reason for each. */
export function findLowTextOpacity(classes, floor = TEXT_OPACITY_FLOOR) {
  const hits = [];
  for (const token of classes.split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(":");
    const utility = parts.pop().replace(/^!/, "");
    const variants = parts;
    const text = TEXT_ALPHA.exec(utility);
    if (text && !SIZE_BASE.test(text[1])) {
      const n = percent(text[2]);
      if (n !== 0 && n < floor) hits.push({ token, kind: "text" });
      continue;
    }
    const op = OPACITY.exec(utility);
    if (op) {
      const n = percent(op[1]);
      if (n === 0 || variants.some((v) => EXEMPT_VARIANTS.has(v))) continue;
      if (n < floor) hits.push({ token, kind: "opacity" });
    }
  }
  return hits;
}

/** Every string node that can end up in the class list. Calls are visited on their own. */
function classStrings(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push({ node, value: node.value });
      break;
    case "TemplateLiteral":
      for (const q of node.quasis) out.push({ node: q, value: q.value.cooked ?? q.value.raw });
      for (const e of node.expressions) classStrings(e, out);
      break;
    case "JSXExpressionContainer":
      classStrings(node.expression, out);
      break;
    case "ConditionalExpression":
      classStrings(node.consequent, out);
      classStrings(node.alternate, out);
      break;
    case "LogicalExpression":
      classStrings(node.left, out);
      classStrings(node.right, out);
      break;
    case "ArrayExpression":
      for (const el of node.elements) classStrings(el, out);
      break;
    case "ObjectExpression":
      for (const p of node.properties) {
        if (p.type === "Property" && p.key.type === "Literal") classStrings(p.key, out);
      }
      break;
  }
  return out;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Text must not be dimmed below the /85 opacity floor (HD-023)." },
    schema: [],
    messages: {
      text:
        "`{{token}}` puts text below the /{{floor}} floor — it fails WCAG AA on the dark surfaces. " +
        "Use text-bevel-dark/85 as the dimmest step; use colour, not opacity, for hierarchy.",
      opacity:
        "`{{token}}` dims everything inside it, text included, below the /{{floor}} floor. " +
        "Dim the colour instead (text-bevel-dark/85). If this element carries no text, " +
        "disable this line with a comment saying so.",
    },
  },
  create(context) {
    function check(node) {
      for (const { node: at, value } of classStrings(node)) {
        for (const hit of findLowTextOpacity(value)) {
          context.report({
            node: at,
            messageId: hit.kind,
            data: { token: hit.token, floor: String(TEXT_OPACITY_FLOOR) },
          });
        }
      }
    }
    return {
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "className") check(node.value);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CLASS_FUNCTIONS.has(node.callee.name)) {
          for (const arg of node.arguments) check(arg);
        }
      },
    };
  },
};

export const hdPlugin = { rules: { "text-opacity-floor": rule } };

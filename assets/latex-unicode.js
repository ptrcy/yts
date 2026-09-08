// LLM-common LaTeX → Unicode (pragmatic, not exhaustive)
const LATEX_UNICODE = {
  // --- Greek (lower) ---
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ",
  "\\epsilon": "ε", "\\theta": "θ", "\\lambda": "λ", "\\mu": "μ",
  "\\pi": "π", "\\sigma": "σ", "\\phi": "φ", "\\omega": "ω",
  "\\rho": "ρ", "\\tau": "τ", "\\kappa": "κ", "\\psi": "ψ",
  "\\chi": "χ", "\\eta": "η", "\\iota": "ι", "\\zeta": "ζ",

  // --- Greek (upper, common only) ---
  "\\Delta": "Δ", "\\Sigma": "Σ", "\\Omega": "Ω",
  "\\Gamma": "Γ", "\\Lambda": "Λ", "\\Phi": "Φ", "\\Psi": "Ψ",

  // --- Arrows ---
  "\\to": "→", "\\rightarrow": "→",
  "\\leftarrow": "←", "\\gets": "←",
  "\\Rightarrow": "⇒", "\\Longrightarrow": "⟹",
  "\\Leftrightarrow": "⇔", "\\iff": "⇔",

  // --- Comparisons / relations ---
  "\\le": "≤", "\\leq": "≤",
  "\\ge": "≥", "\\geq": "≥",
  "\\neq": "≠", "\\ne": "≠",
  "\\approx": "≈", "\\sim": "∼",
  "\\equiv": "≡", "\\cong": "≅",

  // --- Sets & logic ---
  "\\in": "∈", "\\notin": "∉",
  "\\subset": "⊂", "\\subseteq": "⊆",
  "\\supset": "⊃", "\\supseteq": "⊇",
  "\\cup": "∪", "\\cap": "∩",
  "\\emptyset": "∅", "\\varnothing": "∅",
  "\\forall": "∀", "\\exists": "∃",
  "\\neg": "¬", "\\land": "∧", "\\lor": "∨",

  // --- Operators ---
  "\\pm": "±", "\\times": "×", "\\cdot": "·",
  "\\sum": "∑", "\\prod": "∏", "\\int": "∫",
  "\\infty": "∞",
  "\\partial": "∂", "\\nabla": "∇",

  // --- Superscript/subscript shortcuts ---
  "^2": "²", "^3": "³",
  "_0": "₀", "_1": "₁", "_2": "₂", "_3": "₃", "_4": "₄",
  "_5": "₅", "_6": "₆", "_7": "₇", "_8": "₈", "_9": "₉",
};

// Simple accents via combining characters (single-letter only)
const COMBINING = {
  "\\hat": "̂",
  "\\bar": "̄",
  "\\vec": "⃗",
  "\\dot": "̇",
};

// Read a balanced {...} group. str[open] must be "{". Returns the inner content
// and the index just past the closing brace, or null if unbalanced.
function readBraceGroup(str, open) {
  let depth = 0;
  for (let j = open; j < str.length; j++) {
    if (str[j] === "{") depth++;
    else if (str[j] === "}") {
      depth--;
      if (depth === 0) return { content: str.slice(open + 1, j), end: j + 1 };
    }
  }
  return null;
}

// Read an optional [...] argument. str[open] must be "[".
function readOptionalArg(str, open) {
  const close = str.indexOf("]", open);
  if (close === -1) return null;
  return { content: str.slice(open + 1, close), end: close + 1 };
}

// Expand \frac{..}{..}, \sqrt{..} and \sqrt[n]{..} with proper brace matching
// so nested arguments (e.g. \frac{\frac{1}{2}}{3}) don't get truncated.
function expandFracSqrt(text) {
  let out = "";
  let i = 0;
  const skipSpaces = (idx) => {
    while (text[idx] === " ") idx++;
    return idx;
  };

  while (i < text.length) {
    if (text.startsWith("\\frac", i)) {
      const k = skipSpaces(i + 5);
      if (text[k] === "{") {
        const num = readBraceGroup(text, k);
        if (num) {
          const m = skipSpaces(num.end);
          if (text[m] === "{") {
            const den = readBraceGroup(text, m);
            if (den) {
              out += " " + expandFracSqrt(num.content) + "/" + expandFracSqrt(den.content) + " ";
              i = den.end;
              continue;
            }
          }
        }
      }
    } else if (text.startsWith("\\sqrt", i)) {
      let k = skipSpaces(i + 5);
      let index = null;
      if (text[k] === "[") {
        const opt = readOptionalArg(text, k);
        if (opt) {
          index = opt.content;
          k = skipSpaces(opt.end);
        }
      }
      if (text[k] === "{") {
        const rad = readBraceGroup(text, k);
        if (rad) {
          const inner = expandFracSqrt(rad.content);
          out += index ? index + "√(" + inner + ")" : "√(" + inner + ")";
          i = rad.end;
          continue;
        }
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Convert LaTeX expressions to Unicode characters.
 * @param {string} text - Text containing LaTeX expressions
 * @returns {string} - Text with LaTeX converted to Unicode
 */
function latexToUnicode(text) {
  // 1) Blackboard bold (LLMs mostly use these)
  text = text.replace(/\\mathbb\{([NZQRC])\}/g, (_, c) => ({
    N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ",
  }[c] || c));

  // 2) Fractions and roots (balanced-brace aware)
  text = expandFracSqrt(text);

  // 3) Replace macros (longest first to avoid collisions)
  const keys = Object.keys(LATEX_UNICODE).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(escapeRegex(k) + "(?![A-Za-z])", "g");
    text = text.replace(re, LATEX_UNICODE[k]);
  }

  // 4) Accents: \hat{x}, \bar{y}, \vec{v} — run after macro substitution so
  //    \hat{\alpha} (now \hat{α}) resolves to an accented Greek letter.
  text = text.replace(
    /\\(hat|bar|vec|dot)\s*\{([^\\{}])\}/gu,
    (_, acc, ch) => ch + (COMBINING["\\" + acc] || "")
  );

  // 5) Remove common LaTeX spacing noise
  text = text
    .replace(/\\quad/g, " ")
    .replace(/\\qquad/g, "  ")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\text\{([^}]+)\}/g, "$1");

  return text;
}

/**
 * Convert only inline math expressions between single dollar signs to Unicode.
 * @param {string} text - Text containing LaTeX math expressions
 * @returns {string} - Text with LaTeX math converted to Unicode
 */
function latexMathOnlyToUnicode(text) {
  // Convert display math first so the inline pass below can't mis-tokenize the
  // doubled delimiters into a stray inline span.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => latexToUnicode(expr));
  return text.replace(/\$([^$]+)\$/g, (_, expr) => latexToUnicode(expr));
}

/**
 * Convert display math between doubled dollar signs to Unicode.
 * @param {string} text - Text containing LaTeX display math
 * @returns {string} - Text with LaTeX display math converted to Unicode
 */
function latexDisplayMathToUnicode(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => latexToUnicode(expr));
}

/**
 * Convert all LaTeX (inline and display) to Unicode.
 * @param {string} text - Text containing LaTeX expressions
 * @returns {string} - Text with all LaTeX converted to Unicode
 */
function latexAllToUnicode(text) {
  // First handle display math
  text = latexDisplayMathToUnicode(text);
  // Then handle inline math
  text = latexMathOnlyToUnicode(text);
  return text;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { latexToUnicode, latexMathOnlyToUnicode, latexDisplayMathToUnicode, latexAllToUnicode };
}

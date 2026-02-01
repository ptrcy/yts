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
  "\\hat": "\u0302",
  "\\bar": "\u0304",
  "\\vec": "\u20D7",
  "\\dot": "\u0307",
};

/**
 * Convert LaTeX expressions to Unicode characters.
 * @param {string} text - Text containing LaTeX expressions
 * @returns {string} - Text with LaTeX converted to Unicode
 */
function latexToUnicode(text) {
  // 1) Accents: \hat{x}, \bar{y}, \vec{v}
  text = text.replace(
    /\\(hat|bar|vec|dot)\s*\{([A-Za-z])\}/g,
    (_, acc, ch) => ch + (COMBINING["\\" + acc] || "")
  );

  // 2) Blackboard bold (LLMs mostly use these)
  text = text.replace(/\\mathbb\{([NZQRC])\}/g, (_, c) => ({
    N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ",
  }[c] || c));

  // 3) Fractions: \frac{a}{b}
  text = text.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, " $1/$2 ");

  // 4) Square roots: \sqrt{x}
  text = text.replace(/\\sqrt\{([^}]+)\}/g, "√($1)");

  // 5) Replace macros (longest first to avoid collisions)
  const keys = Object.keys(LATEX_UNICODE).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(escapeRegex(k) + "(?![A-Za-z])", "g");
    text = text.replace(re, LATEX_UNICODE[k]);
  }

  // 6) Remove common LaTeX spacing noise
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
 * Convert only inline math expressions $...$ to Unicode.
 * @param {string} text - Text containing LaTeX math expressions
 * @returns {string} - Text with LaTeX math converted to Unicode
 */
function latexMathOnlyToUnicode(text) {
  return text.replace(/\$([^$]+)\$/g, (_, expr) => latexToUnicode(expr));
}

/**
 * Convert display math $$...$$ to Unicode.
 * @param {string} text - Text containing LaTeX display math
 * @returns {string} - Text with LaTeX display math converted to Unicode
 */
function latexDisplayMathToUnicode(text) {
  return text.replace(/\$\$([^$]+)\$\$/g, (_, expr) => latexToUnicode(expr));
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

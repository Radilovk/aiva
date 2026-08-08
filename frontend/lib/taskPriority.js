/**
 * Task priority — two levels only: normal (0) and important (1).
 * Normal tasks have no visible priority index.
 */
(function () {
  const IMPORTANT = 1;
  const NORMAL = 0;

  function isImportant(value) {
    return Number(value) === IMPORTANT;
  }

  function normalize(value) {
    if (value === undefined || value === null || value === '') return NORMAL;
    const n = parseInt(String(value), 10);
    if (Number.isNaN(n)) return NORMAL;
    return n <= 1 ? (n === IMPORTANT ? IMPORTANT : NORMAL) : NORMAL;
  }

  function label(value, lang) {
    if (!isImportant(value)) return '';
    const isBg = !lang || lang === 'bg';
    return isBg ? 'Важно!' : 'Important!';
  }

  function sortCompare(a, b) {
    return normalize(b?.priority) - normalize(a?.priority);
  }

  window.AIVA_TASK_PRIORITY = {
    IMPORTANT,
    NORMAL,
    isImportant,
    normalize,
    label,
    sortCompare,
  };
})();

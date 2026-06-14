// Plain-JS file-path-under-tap detection, injected verbatim into the terminal
// WebView's xterm script (XTERM_HTML). It is interpolated with ${...}, so the
// regex backslashes here are single (the real runtime form) — not the doubled
// form a backtick template literal would otherwise require.
//
// This mirrors the unit-tested mobile/src/terminal/terminal-path-tap.ts; keep
// the two in sync. The TS module is the source of truth for the algorithm and
// has the regression tests; this string only exists because the WebView can't
// import RN modules.
export const TERMINAL_PATH_TAP_JS = String.raw`
  var FILE_PATH_RE = /(?:~[\\/]|[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9._-]+[\\/])[A-Za-z0-9._~\-\/%+@\\()[\]]*(?::\d+)?(?::\d+)?/g;
  var PATH_LEADING_TRIM = { '(': 1, '[': 1, '{': 1, '"': 1, "'": 1 };
  var PATH_TRAILING_TRIM = { ')': 1, ']': 1, '}': 1, '"': 1, "'": 1, ',': 1, ';': 1, '.': 1 };

  function parsePathLineCol(value) {
    var m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(value);
    if (!m) return null;
    var pathText = m[1];
    var last = pathText.charAt(pathText.length - 1);
    if (!pathText || last === '/' || last === '\\') return null;
    var line = m[2] ? parseInt(m[2], 10) : null;
    var column = m[3] ? parseInt(m[3], 10) : null;
    if ((line !== null && line < 1) || (column !== null && column < 1)) return null;
    return { pathText: pathText, line: line, column: column };
  }

  function matchFilePathAtColumn(lineText, col) {
    FILE_PATH_RE.lastIndex = 0;
    var match;
    while ((match = FILE_PATH_RE.exec(lineText)) !== null) {
      var raw = match[0];
      if (raw.length === 0) { FILE_PATH_RE.lastIndex += 1; continue; }
      var start = 0, end = raw.length;
      while (start < end && PATH_LEADING_TRIM[raw.charAt(start)]) start += 1;
      while (end > start && PATH_TRAILING_TRIM[raw.charAt(end - 1)]) end -= 1;
      if (start >= end) continue;
      var spanStart = match.index + start;
      var spanEnd = match.index + end;
      if (col < spanStart || col > spanEnd) continue;
      var parsed = parsePathLineCol(raw.slice(start, end));
      if (parsed) return parsed;
    }
    return null;
  }

  // Emits terminal-file-tap when the tap lands on a path, else terminal-tap.
  // Relies on viewportToCell/getLineText/notify from the host script scope.
  function notifyTapOrFilePath(originX, originY) {
    var tappedPath = null;
    var tapCell = viewportToCell(originX, originY);
    if (tapCell) {
      tappedPath = matchFilePathAtColumn(getLineText(tapCell.row), tapCell.col);
    }
    if (tappedPath) {
      notify({
        type: 'terminal-file-tap',
        pathText: tappedPath.pathText,
        line: tappedPath.line,
        column: tappedPath.column
      });
    } else {
      notify({ type: 'terminal-tap' });
    }
  }
`

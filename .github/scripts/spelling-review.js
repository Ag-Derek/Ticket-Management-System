// Turns cspell's output into pull request feedback:
// - an inline comment on each misspelled line that's part of the PR diff,
//   with a one-click "Commit suggestion" fix and the other options listed;
// - one summary comment on the PR (updated in place, never duplicated) that
//   lists every issue, including any on lines outside the diff.
//
// Run from the spelling job in .github/workflows/ci.yml via
// actions/github-script. It never edits files itself: the contributor picks
// the fix, or adds the word to cspell.json if it's correct.

const fs = require('fs');

const MARKER = '<!-- docket-spelling -->';
const MAX_INLINE = 25;

// With --show-suggestions cspell prints lines like
// cspell:disable-next-line
//   client/app.js:12:9 - Unknown word (recieve) Suggestions: [receive*, relieve]
// A trailing * marks cspell's confident fix for a known common misspelling.
// Without the flag a confident fix shows as "fix: (receive)" instead.
const LINE_RE = /^(.+?):(\d+):(\d+) - Unknown word \((.+?)\)(?: fix: \((.+?)\))?(?: Suggestions: \[(.*)\])?\s*$/;

function parseReport(text) {
  const issues = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const options = (m[6] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const starred = options.find((o) => o.endsWith('*'));
    const confident = m[5] || (starred ? starred.replace(/\*$/, '') : null);
    const clean = options.map((o) => o.replace(/\*$/, '')).filter((o) => o !== confident);
    issues.push({
      path: m[1].replace(/\\/g, '/').replace(/^\.\//, ''),
      line: Number(m[2]),
      col: Number(m[3]),
      word: m[4],
      // Only a confident fix becomes a one-click suggestion. Guesses are just
      // listed, so a correct product name never gets "fixed" to a guess.
      fix: confident,
      options: clean
    });
  }
  return issues;
}

// Lines on the PR's side of the diff (added or unchanged context) — the only
// lines GitHub accepts inline comments on.
function linesInDiff(patch) {
  const lines = new Set();
  if (!patch) return lines;
  let n = 0;
  for (const row of patch.split('\n')) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { n = Number(hunk[1]); continue; }
    if (row.startsWith('-')) continue;
    if (row.startsWith('\\')) continue;
    lines.add(n);
    n += 1;
  }
  return lines;
}

// Applies every fix on one line, right to left so earlier columns stay valid.
function fixedLine(text, issues) {
  let out = text;
  for (const i of [...issues].sort((a, b) => b.col - a.col)) {
    if (!i.fix) continue;
    const start = i.col - 1;
    if (out.slice(start, start + i.word.length) !== i.word) continue;
    out = out.slice(0, start) + i.fix + out.slice(start + i.word.length);
  }
  return out;
}

function describe(i) {
  const list = (words) => words.map((w) => '`' + w + '`').join(', ');
  if (i.fix) {
    return `\`${i.word}\` → \`${i.fix}\`` + (i.options.length ? ` (other options: ${list(i.options)})` : '');
  }
  return i.options.length
    ? `\`${i.word}\`: did you mean ${list(i.options)}?`
    : `\`${i.word}\`: no suggestions`;
}

const ADD_WORD_TIP = "If a word is spelled correctly (a name, product or term), add it to `words` in `cspell.json` instead.";

function inlineBody(issues, fileLine) {
  const parts = [MARKER, '**Spelling**'];
  for (const i of issues) parts.push('- ' + describe(i));
  const fixed = fileLine == null ? null : fixedLine(fileLine, issues);
  if (fixed != null && fixed !== fileLine) {
    parts.push('', '```suggestion', fixed, '```', 'Click **Commit suggestion** to apply the fix above, or edit it first if another option fits better.');
  }
  parts.push('', ADD_WORD_TIP);
  return parts.join('\n');
}

function summaryBody(issues, inlineCount) {
  if (!issues.length) {
    return `${MARKER}\n### ✅ Spelling check passed\nAll spelling issues on this PR are fixed.`;
  }
  const rows = issues.map((i) => `| \`${i.path}:${i.line}\` | ${describe(i)} |`);
  return [
    MARKER,
    `### ✏️ Spelling check found ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
    inlineCount === issues.length
      ? 'Each one has an inline comment on the changed line.'
      : inlineCount
        ? `${inlineCount} ${inlineCount === 1 ? 'has' : 'have'} an inline comment. The rest are on lines this PR didn't change, so they're only listed here.`
        : "None are on lines this PR changed, so they're only listed here.",
    '',
    '**Your options for each word:**',
    '1. Click **Commit suggestion** on the inline comment, where there is a confident fix.',
    '2. Otherwise, fix it by hand using one of the listed options.',
    '3. If the word is correct, add it to `words` in `cspell.json`.',
    '',
    '| Where | Word |',
    '| --- | --- |',
    ...rows
  ].join('\n');
}

module.exports = async function run({ github, context, core, reportPath }) {
  const pr = context.payload.pull_request;
  if (!pr) return;
  const { owner, repo } = context.repo;
  const issues = parseReport(fs.readFileSync(reportPath, 'utf8'));

  try {
    // Remove this job's old inline comments so each push shows only current issues.
    const old = await github.paginate(github.rest.pulls.listReviewComments, { owner, repo, pull_number: pr.number, per_page: 100 });
    for (const c of old) {
      if (c.user && c.user.type === 'Bot' && c.body.includes(MARKER)) {
        await github.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c.id });
      }
    }

    const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 });
    const diffLines = new Map(files.map((f) => [f.filename, linesInDiff(f.patch)]));

    const byLine = new Map();
    for (const i of issues) {
      const lines = diffLines.get(i.path);
      if (!lines || !lines.has(i.line)) continue;
      const key = i.path + ':' + i.line;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(i);
    }

    let posted = 0;
    let inlineComments = 0;
    for (const group of byLine.values()) {
      if (inlineComments >= MAX_INLINE) break;
      const { path, line } = group[0];
      let text = null;
      try { text = fs.readFileSync(path, 'utf8').split(/\r?\n/)[line - 1]; } catch (e) { /* file unreadable: list options only */ }
      await github.rest.pulls.createReviewComment({
        owner, repo, pull_number: pr.number, commit_id: pr.head.sha,
        path, line, side: 'RIGHT', body: inlineBody(group, text)
      });
      posted += group.length;
      inlineComments += 1;
    }

    // One summary comment per PR, edited in place.
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: pr.number, per_page: 100 });
    const existing = comments.find((c) => c.user && c.user.type === 'Bot' && c.body.includes(MARKER));
    const body = summaryBody(issues, posted);
    if (existing) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    } else if (issues.length) {
      await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
    }
  } catch (err) {
    // PRs from forks get a read-only token; the job's own failure still shows the issues.
    core.warning(`Couldn't post spelling comments on the PR: ${err.message}`);
  }
};

module.exports.parseReport = parseReport;
module.exports.linesInDiff = linesInDiff;
module.exports.fixedLine = fixedLine;
module.exports.inlineBody = inlineBody;
module.exports.summaryBody = summaryBody;

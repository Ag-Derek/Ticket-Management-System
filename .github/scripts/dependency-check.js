// Dependency check for docket-server (issue #73).
//
// Finds two kinds of problem:
//   1. Packages the code requires that aren't in package.json.
//   2. package.json and package-lock.json out of step (npm ci would fail).
//
// Run locally:   node .github/scripts/dependency-check.js
// In CI it writes dependency-report.json, then the workflow calls
// commentOnPullRequest() through actions/github-script to post or update one
// comment on the PR. That comment also carries reminders for Dependabot
// major updates (read the changelog; test Supabase and Resend by hand).

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const PACKAGE_DIR = 'docket-server';
const MARKER = '<!-- dependency-check -->';
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SOURCE_EXT = new Set(['.js', '.cjs', '.mjs']);
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
// Optional and peer packages may legitimately have no installed version.
const MUST_RESOLVE = new Set(['dependencies', 'devDependencies']);

// Packages whose major updates are never merged on CI alone.
const HAND_TESTED = [/^@supabase\//, /^resend$/];

// require('x'), import('x'), import ... from 'x', import 'x', export ... from 'x'
const IMPORT_PATTERNS = [
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  /^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm,
];

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (builtinModules.includes(name)) return null;
  return name;
}

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (SOURCE_EXT.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function findUndeclared(root, pkg) {
  const declared = new Set(DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] || {})));
  const missing = new Map(); // name -> [{ file, line }]
  for (const file of listSourceFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const name = packageName(match[1]);
        if (!name || declared.has(name) || name === pkg.name) continue;
        const where = {
          file: path.relative(process.cwd(), file).split(path.sep).join('/'),
          line: lineOf(text, match.index + match[0].indexOf(match[1])),
        };
        if (!missing.has(name)) missing.set(name, []);
        missing.get(name).push(where);
      }
    }
  }
  return [...missing].map(([name, uses]) => ({ name, uses }));
}

function findLockfileDrift(pkg, lock) {
  const drift = [];
  const locked = (lock.packages && lock.packages['']) || {};
  for (const field of DEP_FIELDS) {
    const wanted = pkg[field] || {};
    const have = locked[field] || {};
    for (const [name, range] of Object.entries(wanted)) {
      if (!(name in have)) {
        drift.push({ name, field, problem: `in package.json (${range}) but not in package-lock.json` });
      } else if (have[name] !== range) {
        drift.push({ name, field, problem: `package.json says ${range}, package-lock.json says ${have[name]}` });
      } else if (MUST_RESOLVE.has(field) && !lock.packages[`node_modules/${name}`]) {
        drift.push({ name, field, problem: 'listed in package-lock.json but never resolved to a version' });
      }
    }
    for (const name of Object.keys(have)) {
      if (!(name in wanted)) {
        drift.push({ name, field, problem: 'in package-lock.json but removed from package.json' });
      }
    }
  }
  return drift;
}

function analyze(root = PACKAGE_DIR) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockPath = path.join(root, 'package-lock.json');
  const report = { undeclared: findUndeclared(root, pkg), drift: [], noLockfile: false };
  if (fs.existsSync(lockPath)) {
    report.drift = findLockfileDrift(pkg, JSON.parse(fs.readFileSync(lockPath, 'utf8')));
  } else {
    report.noLockfile = true;
  }
  report.ok = report.undeclared.length === 0 && report.drift.length === 0 && !report.noLockfile;
  return report;
}

function problemsMarkdown(report, fileUrl) {
  const out = [];
  if (report.undeclared.length) {
    out.push('### Missing from package.json', '');
    out.push('The code requires these packages, but `docket-server/package.json` doesn\'t list them. They\'ll be missing when Render or CI installs from the lockfile.', '');
    for (const { name, uses } of report.undeclared) {
      const links = uses.slice(0, 3).map((u) => `[${u.file}:${u.line}](${fileUrl(u.file, u.line)})`);
      const more = uses.length > 3 ? ` and ${uses.length - 3} more` : '';
      out.push(`- \`${name}\`, used in ${links.join(', ')}${more}`);
    }
    const names = report.undeclared.map((d) => d.name).join(' ');
    out.push('', 'To fix, run this in `docket-server/` and commit both `package.json` and `package-lock.json`:', '', '```sh', `npm install ${names}`, '```', '');
  }
  if (report.noLockfile) {
    out.push('### No package-lock.json', '', '`docket-server/package-lock.json` is missing, so `npm ci` will fail. Run `npm install` in `docket-server/` and commit the lockfile.', '');
  }
  if (report.drift.length) {
    out.push('### package.json and package-lock.json don\'t match', '', '`npm ci` fails when these disagree.', '');
    for (const d of report.drift) out.push(`- \`${d.name}\` (${d.field}): ${d.problem}`);
    out.push('', 'To fix, run `npm install` in `docket-server/` and commit the updated `package-lock.json`.', '');
  }
  return out;
}

function dependabotMarkdown(meta) {
  if (!meta || !meta.names.length) return [];
  const out = [];
  const major = meta.updateType === 'version-update:semver-major';
  const handTested = meta.names.filter((n) => HAND_TESTED.some((re) => re.test(n)));
  if (major) {
    out.push('### Major update', '', `Read the changelog for ${meta.names.map((n) => `\`${n}\``).join(', ')} before merging. Dependabot links it in the PR description under "Release notes" or "Changelog".`, '');
  }
  if (major && handTested.length) {
    out.push('### Test by hand before merging', '', `${handTested.map((n) => `\`${n}\``).join(', ')} ${handTested.length > 1 ? 'are' : 'is'} on the hand-test list. Passing CI isn't enough. Check sign-in, ticket create and update, attachments and email by hand against a real project first.`, '');
  }
  return out;
}

// Called from actions/github-script.
async function commentOnPullRequest({ github, context, core, reportPath, dependabot }) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const pr = context.payload.pull_request;
  if (!pr) return;
  const { owner, repo } = context.repo;
  const fileUrl = (file, line) => `https://github.com/${owner}/${repo}/blob/${pr.head.sha}/${file}#L${line}`;

  const sections = [...problemsMarkdown(report, fileUrl), ...dependabotMarkdown(dependabot)];

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: pr.number, per_page: 100,
  });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.includes(MARKER));

  let body;
  if (sections.length) {
    body = [MARKER, '## Dependency check', '', ...sections].join('\n').trimEnd();
  } else if (existing) {
    body = [MARKER, '## Dependency check', '', 'All dependencies are declared and the lockfile matches `package.json`.'].join('\n');
  } else {
    core.info('Nothing to report.');
    return;
  }

  if (existing) {
    if (existing.body !== body) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    }
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
  }
}

module.exports = { analyze, commentOnPullRequest };

if (require.main === module) {
  const report = analyze();
  const out = process.argv[2];
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const lines = problemsMarkdown(report, (file, line) => `${file}:${line}`);
  console.log(lines.length ? lines.join('\n') : 'Dependency check passed: all dependencies declared, lockfile in step.');
  process.exitCode = report.ok ? 0 : 1;
}

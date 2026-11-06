import type { Permission } from '@forgemind/contract';

/*
 * Stand-ins for the GitHub pages a real sign-in and app install would visit.
 * They exist so the whole flow can be walked without a GitHub account, and
 * they say so at the top of every page.
 */

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

type Page = {
  title: string;
  intro: string;
  permissions?: Permission[];
  actions: { label: string; href: string }[];
};

export function simulatedGitHubPage({
  title,
  intro,
  permissions,
  actions,
}: Page) {
  const rows = (permissions ?? [])
    .map(
      ({ name, access, reason }) =>
        `<tr><th>${escape(name)}</th><td>${escape(access)}</td><td>${escape(reason)}</td></tr>`,
    )
    .join('');
  const links = actions
    .map(
      ({ label, href }) =>
        `<a class="button" href="${escape(href)}">${escape(label)}</a>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Simulated GitHub</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  .banner { background: #9e6a03; color: #0d1117; font-weight: 600; text-align: center; padding: 8px 16px; }
  main { max-width: 36rem; margin: 48px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #8d96a0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-top: 1px solid #30363d; vertical-align: top; }
  th { color: #e6edf3; white-space: nowrap; }
  .button { display: block; margin: 8px 0; padding: 10px 14px; border: 1px solid #30363d; border-radius: 6px; background: #238636; color: #fff; text-decoration: none; font-weight: 600; text-align: center; }
  .button:focus { outline: 2px solid #58a6ff; outline-offset: 2px; }
</style>
</head>
<body>
<div class="banner" role="note">Simulated GitHub — development only. No real GitHub account is involved.</div>
<main>
  <h1>${escape(title)}</h1>
  <p>${escape(intro)}</p>
  ${rows ? `<table><thead><tr><th>Permission</th><th>Access</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
  ${links}
</main>
</body>
</html>`;
}

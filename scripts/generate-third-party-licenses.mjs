import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' })
);
const rows = Object.entries(report)
  .flatMap(([license, packages]) =>
    packages.map((pkg) => ({
      license,
      name: pkg.name,
      versions: pkg.versions.join(', '),
      homepage: pkg.homepage ?? ''
    }))
  )
  .sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.license.localeCompare(right.license)
  );

const lines = [
  '# Third-party dependency licenses',
  '',
  'Generated from the locked dependency graph with `pnpm licenses list --json`.',
  'Run `pnpm licenses:generate` after dependency changes and review the diff before release.',
  '',
  '| Package | Version(s) | License | Project |',
  '| --- | --- | --- | --- |',
  ...rows.map(
    ({ name, versions, license, homepage }) =>
      `| \`${name}\` | ${versions} | ${license} | ${homepage ? `[link](${homepage})` : '—'} |`
  ),
  '',
  'The package archives retain each dependency license in its own installed package.',
  'Adapted source and trademark notices that require project-level context are recorded in',
  '[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).',
  ''
];

writeFileSync('THIRD_PARTY_LICENSES.md', `${lines.join('\n')}\n`);
execFileSync('pnpm', ['exec', 'prettier', '--write', 'THIRD_PARTY_LICENSES.md'], {
  stdio: 'inherit'
});

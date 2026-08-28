import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');
const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-package-smoke-'));
const packageDirectory = join(workspace, 'package');
const installDirectory = join(workspace, 'install');
const applicationHome = join(workspace, 'home');
let daemonPid = null;

try {
  await mkdir(packageDirectory, { recursive: true });
  await execute('pnpm', ['pack', '--pack-destination', packageDirectory], {
    cwd: projectRoot,
    timeout: 30_000
  });
  const archiveName = (await readdir(packageDirectory)).find((name) => name.endsWith('.tgz'));
  if (!archiveName) throw new Error('pnpm pack did not create an archive');
  const archivePath = join(packageDirectory, archiveName);
  await execute('npm', ['install', '--prefix', installDirectory, archivePath], {
    timeout: 60_000
  });

  const executable = join(installDirectory, 'node_modules', '.bin', 'agent-usage');
  await access(executable);
  const launched = await execute(executable, ['--home', applicationHome, '--no-open'], {
    timeout: 15_000
  });
  if (!/^http:\/\/127\.0\.0\.1:\d+\/launch\?token=/.test(launched.stdout.trim())) {
    throw new Error('Installed default command did not return a loopback launch URL');
  }
  const daemon = JSON.parse(await readFile(join(applicationHome, 'daemon.json'), 'utf8'));
  daemonPid = daemon.pid;

  const status = await execute(executable, ['--home', applicationHome, 'status', '--json'], {
    timeout: 10_000
  });
  const doctor = await execute(executable, ['--home', applicationHome, 'doctor', '--json'], {
    timeout: 10_000
  });
  const parsedStatus = JSON.parse(status.stdout);
  const parsedDoctor = JSON.parse(doctor.stdout);
  if (!Array.isArray(parsedStatus.providers)) throw new Error('Packaged status output is invalid');
  if (parsedDoctor.daemon?.status !== 'healthy') throw new Error('Packaged doctor is unhealthy');

  const jsonExport = await execute(
    executable,
    ['--home', applicationHome, 'export', '--format', 'json', '--window', '30d'],
    { timeout: 10_000 }
  );
  const parsedJsonExport = JSON.parse(jsonExport.stdout);
  if (parsedJsonExport.query?.window !== '30d' || !Array.isArray(parsedJsonExport.rows)) {
    throw new Error('Packaged JSON export output is invalid');
  }
  if (
    parsedJsonExport.privacy?.accountIdentifiersIncluded !== false ||
    parsedJsonExport.privacy?.secretsIncluded !== false
  ) {
    throw new Error('Packaged JSON export is not redacted by default');
  }

  const csvExport = await execute(
    executable,
    ['--home', applicationHome, 'export', '--format', 'csv', '--window', '7d'],
    { timeout: 10_000 }
  );
  if (!csvExport.stdout.startsWith('window,windowStart,windowEnd')) {
    throw new Error('Packaged CSV export output is invalid');
  }

  const retention = await execute(executable, ['--home', applicationHome, 'retention', '--json'], {
    timeout: 10_000
  });
  if (JSON.parse(retention.stdout).rawRetentionDays !== 90) {
    throw new Error('Packaged retention status is invalid');
  }
  const compacted = await execute(
    executable,
    ['--home', applicationHome, 'retention', '--compact', '--json'],
    { timeout: 10_000 }
  );
  if (!JSON.parse(compacted.stdout).lastCompactedAt) {
    throw new Error('Packaged retention compaction did not complete');
  }

  await execute(executable, ['--home', applicationHome, 'clear', '--yes'], {
    timeout: 10_000
  });
  process.kill(daemonPid, 'SIGTERM');
  await waitForExit(daemonPid);
  daemonPid = null;

  await execute('npm', ['uninstall', '--prefix', installDirectory, 'agent-usage-all-in-one'], {
    timeout: 30_000
  });
  let executableStillExists = true;
  try {
    await access(executable);
  } catch {
    executableStillExists = false;
  }
  if (executableStillExists) throw new Error('Clean uninstall left the agent-usage executable');

  process.stdout.write(
    `${JSON.stringify({
      archive: archiveName,
      installedDefaultCommand: 'passed',
      status: 'passed',
      doctor: 'passed',
      jsonExport: 'passed',
      csvExport: 'passed',
      retention: 'passed',
      retentionCompaction: 'passed',
      clear: 'passed',
      cleanUninstall: 'passed'
    })}\n`
  );
} finally {
  if (daemonPid) {
    try {
      process.kill(daemonPid, 'SIGTERM');
      await waitForExit(daemonPid);
    } catch {
      // The daemon may already have exited after a failed smoke assertion.
    }
  }
  await rm(workspace, { force: true, recursive: true });
}

async function waitForExit(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Daemon ${pid} did not exit during package smoke cleanup`);
}

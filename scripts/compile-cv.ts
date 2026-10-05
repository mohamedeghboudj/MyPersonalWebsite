import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';

// Maintained full TeX Live image; linux/amd64 digest from its published package.
const image =
  'ghcr.io/xu-cheng/texlive-full@sha256:d9bfb267e3e3f5e0820ca86e867ee59ebb133fc29561bb28677d9b5a1a9e84ff';
function run(args: string[], limitMs: number) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit', shell: false });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Docker command timed out'));
    }, limitMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`Docker exited ${code}`));
    });
  });
}
const pullStarted = performance.now();
await run(['pull', '--platform', 'linux/amd64', image], 15 * 60 * 1000);
const pullMs = performance.now() - pullStarted;
const measurements: {
  locale: string;
  pass: number;
  compileMs: number;
  bytes: number;
}[] = [];
for (const locale of ['en', 'fr', 'ar']) {
  const directory = resolve(`artifacts/cv/${locale}`);
  await mkdir(directory, { recursive: true });
  await cp('packages/cv-engine/fonts', `${directory}/fonts`, {
    recursive: true,
  });
  await writeFile(
    `${directory}/cv.tex`,
    await readFile(`artifacts/cv/${locale}.tex`),
  );
  for (const pass of [1, 2]) {
    const started = performance.now();
    const name = `cv-spike-${locale}-${crypto.randomUUID()}`;
    try {
      await run(
        [
          'run',
          '--rm',
          '--name',
          name,
          '--platform',
          'linux/amd64',
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--pids-limit=64',
          '--cpus=1',
          '--memory=1g',
          '--user',
          `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
          '--tmpfs',
          '/tmp:rw,noexec,nosuid,size=256m',
          '--mount',
          `type=bind,source=${directory},target=/work`,
          '--workdir',
          '/work',
          '--env',
          'HOME=/tmp',
          '--env',
          'TEXMFVAR=/tmp/texmf-var',
          '--env',
          'TEXMFCONFIG=/tmp/texmf-config',
          '--env',
          'TEXMFCACHE=/tmp/texmf-cache',
          '--env',
          'openin_any=p',
          '--env',
          'openout_any=p',
          '--entrypoint',
          'timeout',
          image,
          '90',
          'xelatex',
          '-no-shell-escape',
          '-halt-on-error',
          '-interaction=nonstopmode',
          'cv.tex',
        ],
        100000,
      );
    } finally {
      // Kill by exact random container name too: terminating the Docker CLI alone
      // must not leave a hostile or stuck compiler running in the background.
      await run(['rm', '-f', name], 10000).catch(() => undefined);
    }
    const pdf = await readFile(`${directory}/cv.pdf`);
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')
      throw new Error(`Invalid ${locale} PDF`);
    const log = await readFile(`${directory}/cv.log`, 'utf8');
    if (
      /Missing character:|fontspec Error|Emergency stop|Fatal error/iu.test(log)
    )
      throw new Error(`Font/compiler validation failed for ${locale}`);
    measurements.push({
      locale,
      pass,
      compileMs: performance.now() - started,
      bytes: pdf.length,
    });
  }
}
await writeFile(
  'artifacts/cv/measurements.json',
  JSON.stringify(
    {
      image,
      pullMs,
      measurements,
      visualInspection:
        'PENDING — successful compilation is not an Arabic visual proof',
    },
    null,
    2,
  ),
);
console.log(
  'Compiled all three PDFs; rendered-page inspection is still required.',
);

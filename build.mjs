import * as esbuild from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
cpSync('static', 'dist', { recursive: true });

const options = {
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox140',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

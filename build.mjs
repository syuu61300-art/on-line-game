import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const minify = !process.argv.includes('--dev');
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = readFileSync('src/template.html', 'utf8');
const page = tpl + '\n<script>\n' + js + '\n</script>\n';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/pier7.html', page);
// standalone full document for the Node server version
const head = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>';
mkdirSync('server/public', { recursive: true });
writeFileSync('server/public/index.html', head + page + '</body></html>');
console.log('built', (page.length / 1024).toFixed(0) + ' KB');

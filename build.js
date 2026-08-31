#!/usr/bin/env node
/**
 * 単一HTMLへの結合スクリプト(外部依存なし)
 *
 * src/ 以下の ES モジュールを依存関係を保ったまま1つの古典スクリプトに畳み込み、
 * CSS とともにリポジトリ直下の index.html にインライン展開する。
 * これにより file:// で直接開いても動作する配布物になる。
 *
 * 出力先の index.html は GitHub Pages が配信するファイルでもある。
 * ここを別の場所へ移すと公開サイトのトップURLが 404 に戻るので注意。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+)?(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([\s\S]*?)\}\s*;?[ \t]*$/gm;

/** src/ からの相対パス(拡張子なし)をモジュール ID とする */
const idOf = (file) => relative(srcDir, file).replace(/\\/g, '/').replace(/\.js$/, '');

const modules = new Map();

function load(file) {
  const id = idOf(file);
  if (modules.has(id)) return id;
  modules.set(id, null); // 循環参照の保護

  const source = readFileSync(file, 'utf8');
  const exportNames = new Set();
  const deps = [];

  let body = source.replace(IMPORT_RE, (_m, names, spec) => {
    const depFile = resolve(dirname(file), spec);
    const depId = load(depFile);
    deps.push(depId);
    return `const {${names.trim()}} = __require(${JSON.stringify(depId)});`;
  });

  for (const m of body.matchAll(EXPORT_DECL_RE)) exportNames.add(m[3]);
  for (const m of body.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exportNames.add(name);
    }
  }

  body = body
    .replace(EXPORT_DECL_RE, (_m, asyncKw, kind, name) => `${asyncKw || ''}${kind} ${name}`)
    .replace(EXPORT_LIST_RE, '');

  const returns = [...exportNames].join(', ');
  modules.set(id, {
    id, deps,
    code: `__define(${JSON.stringify(id)}, function () {\n${body}\nreturn { ${returns} };\n});`,
  });
  return id;
}

const entry = load(join(srcDir, 'ui', 'app.js'));

const runtime = `(function () {
'use strict';
var __defs = {}, __cache = {};
function __define(id, factory) { __defs[id] = factory; }
function __require(id) {
  if (!(id in __cache)) {
    if (!(id in __defs)) throw new Error('モジュールが見つかりません: ' + id);
    __cache[id] = __defs[id]();
  }
  return __cache[id];
}
${[...modules.values()].filter(Boolean).map((m) => m.code).join('\n\n')}

__require(${JSON.stringify(entry)}).start();
})();`;

const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
const html = readFileSync(join(srcDir, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace(/<script type="module">[\s\S]*?<\/script>/, `<script>\n${runtime}\n</script>`);

if (html.includes('<link rel="stylesheet"') || html.includes('type="module"')) {
  throw new Error('index.html の置換に失敗しました(外部参照が残っています)。');
}

const out = join(root, 'index.html');
writeFileSync(out, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`index.html を生成しました(${modules.size} モジュール、${kb} KB)`);

/* 渲染冒烟测试：用桩 React 渲染组件，检查
 * 1) 模块能加载并注册到正确的 slot
 * 2) 初始状态与多页状态都能渲染
 * 3) 所有 onClick 都是函数（防止改名后引用不存在的函数）
 * 运行：node scripts/render-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');

let Component = null;
const registered = [];

const React = {
  createElement: (type, props, ...kids) => {
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        if (k.startsWith('on') && typeof v !== 'function') {
          throw new Error('handler ' + k + ' 不是函数（引用了不存在的函数？）');
        }
      }
    }
    return { type, props, kids };
  },
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
};
const ReactDOM = { createPortal: (n) => n };

const ctx = {
  slots: {
    inject: (name, fn) => { registered.push(['inject', name]); fn(); },
    register: (spec, C) => { registered.push(['register', spec.id]); Component = C; return () => {}; },
  },
  sessions: { using: async () => [] },
};

globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      def.factory((id) => (id === 'react' ? React : id === 'react-dom' ? ReactDOM : null)).apply(ctx);
    },
  },
  devicePixelRatio: 2,
  clearTimeout: () => {},
  setTimeout: () => 0,
};
globalThis.document = { body: {}, createElement: () => ({ getContext: () => null }) };

new Function(src)();

if (!Component) throw new Error('组件未注册');
if (registered[0][1] !== 'conversation.session.header.actions') throw new Error('slot 名不对');

// 初始状态
const initial = Component({ sessionId: 'sess-test' });
if (!initial) throw new Error('初始状态渲染为空');

// 多页状态（覆盖弹层与所有按钮）
let i = 0;
React.useState = (v) => {
  const n = i++;
  if (n === 0) return [false, () => {}];                                  // busy
  if (n === 1) return ['', () => {}];                                     // notice
  if (n === 2) return [['data:image/png;base64,AAAA'], () => {}];         // pages
  return [0, () => {}];                                                   // page
};
i = 0;
const multi = Component({ sessionId: 'sess-test' });
if (!multi) throw new Error('多页状态渲染为空');

console.log('✓ 注册:', JSON.stringify(registered));
console.log('✓ 初始状态渲染通过');
console.log('✓ 多页弹层渲染通过（含全部按钮 handler）');

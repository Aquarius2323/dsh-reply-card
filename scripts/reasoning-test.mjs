/* 验证：只导出对话里可见的正文，排除 reasoning（思考过程）与 tool-call */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');

const React = { createElement: () => null, Fragment: 'F', useState: (v) => [v, () => {}] };
globalThis.window = {
  __ModuleLoader__: { load(def) { def.factory((id) => id === 'react' ? React : { createPortal: (n) => n }).apply({ slots: { inject: (n, f) => f(), register: () => () => {} }, sessions: {} }); } },
  devicePixelRatio: 1, clearTimeout: () => {}, setTimeout: () => 0,
};
globalThis.document = { body: {}, createElement: () => ({ getContext: () => null }) };
new Function(src)();

const collect = globalThis.window.__dshShareCardCollect;
const pick = globalThis.window.__dshShareCardPick;

const entries = [
  { event: { type: 'user/message', time: 1, data: { message: { content: [{ type: 'text', text: '帮我查一下成绩' }] } } } },
  { event: { type: 'assistant/message', time: 2, data: { message: { content: [
      { type: 'reasoning', text: 'Should I call the tool? Let me think in English.' },
      { type: 'text', text: '我先查一下。' },
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
  ] } } } },
  { event: { type: 'assistant/message', time: 3, data: { message: { content: [
      { type: 'reasoning', text: 'internal monologue noise' },
      { type: 'text', text: '成绩查到了：平均绩点 3.40。' },
  ] } } } },
];
const msgs = collect(entries);
console.log('收集到的消息:');
msgs.forEach((m) => console.log('  [' + m.role + ']', JSON.stringify(m.text)));

const bad = msgs.some((m) => /Should I call|internal monologue|tool-call/.test(m.text));
if (bad) { console.error('✗ 推理内容泄漏进导出结果'); process.exit(1); }
console.log('✓ 未包含 reasoning / tool-call 内容');

const last = pick(msgs, 'last');
console.log('默认(仅最后一条):', last.map((m) => m.role + ':' + m.text.slice(0, 12)));
if (last.length > 2) { console.error('✗ 默认模式应只有 1-2 条'); process.exit(1); }
if (!last.some((m) => m.text.includes('平均绩点'))) { console.error('✗ 默认模式应包含最后一条回复'); process.exit(1); }
console.log('✓ 默认模式只导出最后一条回复（含其前的提问）');

const full = pick(msgs, 'full');
if (full.length !== msgs.length) { console.error('✗ 完整模式数量不对'); process.exit(1); }
console.log('✓ 完整会话模式保留全部', full.length, '条');

import fs from 'node:fs';
const src = fs.readFileSync('./client.js', 'utf8');
const React = { createElement: () => null, Fragment: 'F', useState: (v) => [v, () => {}] };
globalThis.window = {
  __ModuleLoader__: { load(def) { def.factory((id) => id === 'react' ? React : id === 'react-dom' ? { createPortal: (n) => n } : null).apply({ slots: { inject: (n, fn) => fn(), register: () => () => {} } }); } },
  devicePixelRatio: 1, clearTimeout: () => {}, setTimeout: () => 0,
};
globalThis.document = { body: {}, createElement: () => ({ getContext: () => null }) };
new Function(src)();
const collect = globalThis.window.__dshShareCardCollect;
const entries = [
  { event: { type: 'user/message', time: 1, data: { message: { content: [
    { type: 'text', text: '你好\n<system-reminder>secret context</system-reminder>\n请继续' } ] } } } },
  { event: { type: 'assistant/message', time: 2, data: { message: { content: [
    { type: 'text', text: '收到。\n<available-skills>skill list noise</available-skills>\n完成。' } ] } } } },
];
const msgs = collect(entries);
console.log('消息数:', msgs.length);
msgs.forEach((m) => console.log(' [' + m.role + ']', JSON.stringify(m.text)));
const bad = msgs.some((m) => /system-reminder|available-skills/.test(m.text));
console.log(bad ? '✗ 上下文块未清洗干净' : '✓ 上下文块已清洗');

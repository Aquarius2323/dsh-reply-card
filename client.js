/* dsh-reply-card · Client half
 * 读取当前会话的事件，把最后一条回复渲染成竖版长图。
 * 纯前端实现：canvas 绘制 → 剪贴板 / 下载，不上传任何内容。
 */
window.__ModuleLoader__.load({
  id: 'dsh-reply-card',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    let ReactDOM = null;
    try { ReactDOM = require('react-dom'); } catch (e) { ReactDOM = null; }
    const el = (node) => (ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(node, document.body) : node);

    const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    const MONO = '"SF Mono",Menlo,Consolas,monospace';

    /* ---------------- 会话事件 → 文本 ---------------- */
    // 只取对话里可见的正文：text / output_text。
    // reasoning（思考过程）只在「轨迹」里显示，分享时不应出现。
    const VISIBLE_TEXT_TYPES = new Set(['text', 'output_text', 'input_text']);
    function textOf(content) {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      const out = [];
      for (const b of content) {
        if (typeof b === 'string') { out.push(b); continue; }
        if (!b || typeof b !== 'object') continue;
        const type = typeof b.type === 'string' ? b.type : '';
        if (type === 'reasoning' || type === 'thinking' || type === 'tool-call' || type === 'image') continue;
        if (typeof b.text === 'string' && (!type || VISIBLE_TEXT_TYPES.has(type))) { out.push(b.text); continue; }
        if (typeof b.value === 'string' && VISIBLE_TEXT_TYPES.has(type)) { out.push(b.value); }
      }
      return out.join('\n');
    }

    const NOISE = [
      /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
      /<\/?system-reminder>/gi,
      /<available-skills>[\s\S]*?<\/available-skills>/gi,
      /<[^>]*current-working-directory[^>]*>/gi,
    ];
    function cleanNoise(text) {
      let t = String(text);
      for (const re of NOISE) t = t.replace(re, '');
      return t.replace(/\n{3,}/g, '\n\n').trim();
    }

    function collectMessages(entries) {
      const msgs = [];
      for (const entry of entries || []) {
        const ev = entry && (entry.event || entry);
        if (!ev || !ev.type || !ev.data) continue;
        if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue;
        const message = ev.data.message || ev.data;
        const text = cleanNoise(textOf(message && message.content));
        if (!text) continue;
        msgs.push({
          role: ev.type === 'user/message' ? 'user' : 'assistant',
          time: ev.time || 0,
          text,
        });
      }
      return msgs;
    }

    /* ---------------- 把消息整理成「卡片段落」 ---------------- */
    function toSections(messages) {
      const sections = [];
      for (const m of messages) {
        const parts = String(m.text).split(/```/);
        parts.forEach((part, i) => {
          if (!part.trim()) return;
          const isCode = i % 2 === 1;
          let body = part;
          let lang = '';
          if (isCode) {
            const nl = part.indexOf('\n');
            if (nl > -1) { lang = part.slice(0, nl).trim(); body = part.slice(nl + 1); }
          }
          sections.push({
            role: m.role, kind: isCode ? 'code' : 'text', lang,
            body: body.replace(/\s+$/, ''), first: sections.length === 0 || sections[sections.length - 1].role !== m.role,
          });
        });
      }
      return sections;
    }

    /* ---------------- Canvas 渲染 ---------------- */
    const THEMES = {
      ink: {
        bg: '#0f1115', panel: '#161a21', line: '#262c36',
        user: '#7fb2de', asst: '#f2c14e', text: '#e8ecf2', dim: '#8b93a1',
        code: '#0b0e13', codeText: '#c8d3e0', brand: '#6b7482',
      },
      paper: {
        bg: '#faf7f1', panel: '#ffffff', line: '#e8e1d4',
        user: '#2b5c88', asst: '#b8552f', text: '#23211e', dim: '#8a8073',
        code: '#f4efe6', codeText: '#3b3630', brand: '#9a9082',
      },
    };

    // 把文本切成排版单元：拉丁单词 / 中文字 / 空格
    function tokenize(line) {
      const tokens = [];
      let buf = '';
      for (const ch of line) {
        const code = ch.codePointAt(0);
        const isLatinWord = /[A-Za-z0-9_\.\-\/:'"()^@%+*=<>&$#!?,;|~`\[\]{}]/.test(ch);
        if (isLatinWord) {
          buf += ch;
        } else {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(ch);
        }
      }
      if (buf) tokens.push(buf);
      return tokens;
    }

    function wrapLines(ctx2d, text, maxWidth) {
      const out = [];
      for (const raw of String(text).split('\n')) {
        if (!raw) { out.push(''); continue; }
        const tokens = tokenize(raw);
        let line = '';
        for (const tk of tokens) {
          const test = line + tk;
          if (line && ctx2d.measureText(test).width > maxWidth) {
            out.push(line.replace(/\s+$/, ''));
            line = /^\s+$/.test(tk) ? '' : tk;
            // 单词本身超宽：按字符硬切
            while (ctx2d.measureText(line).width > maxWidth && line.length > 1) {
              let cut = line.length - 1;
              while (cut > 1 && ctx2d.measureText(line.slice(0, cut)).width > maxWidth) cut--;
              out.push(line.slice(0, cut));
              line = line.slice(cut);
            }
          } else {
            line = test;
          }
        }
        out.push(line.replace(/\s+$/, ''));
      }
      return out;
    }

    // 行级排版：识别标题 / 列表 / 引用 / 表格，去掉 Markdown 标记
    function lineStyle(line) {
      const t = line.trim();
      if (/^#{1,6}\s+/.test(t)) return { kind: 'heading', text: t.replace(/^#{1,6}\s+/, '') };
      if (/^[-*+]\s+/.test(t)) return { kind: 'list', text: '· ' + t.replace(/^[-*+]\s+/, '') };
      if (/^\d+\.\s+/.test(t)) return { kind: 'list', text: t };
      if (/^>\s?/.test(t)) return { kind: 'quote', text: t.replace(/^>\s?/, '') };
      if (/^\|.*\|$/.test(t)) {
        if (/^\|[\s:\-|]+\|$/.test(t)) return null;
        return { kind: 'table', text: t.split('|').map((c) => c.trim()).filter(Boolean).join('   ') };
      }
      return { kind: 'text', text: t };
    }

    const cleanInline = (t) => t
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.+?)\]\(.*?\)/g, '$1');

    const LINE_SPEC = {
      heading: { font: () => `700 36px ${FONT_STACK}`, h: 62, gap: 12 },
      text: { font: () => `30px ${FONT_STACK}`, h: 52, gap: 0 },
      list: { font: () => `30px ${FONT_STACK}`, h: 52, gap: 0 },
      quote: { font: () => `28px ${FONT_STACK}`, h: 48, gap: 0 },
      table: { font: () => `26px ${MONO}`, h: 44, gap: 0 },
    };

    // 单页正文高度上限：远低于 Chromium 的 canvas 上限（约 16384），保证 toDataURL 不返回空
    const MAX_PAGE_BODY = 8600;

    function measureOps(sections, INNER) {
      const measure = document.createElement('canvas').getContext('2d');
      const ops = [];
      let cursor = 0;
      for (const s of sections) {
        if (s.kind === 'code') {
          measure.font = `24px ${MONO}`;
          const lines = wrapLines(measure, s.body, INNER - 44);
          const hh = lines.length * 36 + 62;
          ops.push({ type: 'code', lines, h: hh, top: cursor });
          cursor += hh + 10;
          continue;
        }
        if (s.first) {
          ops.push({ type: 'role', role: s.role, h: 36, top: cursor });
          cursor += 36;
        }
        for (const raw of s.body.split('\n')) {
          const st = lineStyle(raw);
          if (!st) continue;
          const spec = LINE_SPEC[st.kind];
          const text = cleanInline(st.text);
          if (!text) { cursor += 20; continue; }
          measure.font = spec.font();
          const lines = wrapLines(measure, text, INNER);
          const hh = lines.length * spec.h + spec.gap;
          ops.push({ type: st.kind, lines, h: hh, top: cursor });
          cursor += hh;
        }
        cursor += 18;
      }
      return { ops, total: cursor };
    }

    function paginate(ops) {
      const pages = [];
      let cur = [];
      let pageStart = ops.length ? ops[0].top : 0;
      for (const op of ops) {
        // 用真实排版位置判断，包含块间间距
        if (cur.length && op.top + op.h - pageStart > MAX_PAGE_BODY) {
          pages.push(cur);
          cur = [];
          pageStart = op.top;
        }
        cur.push(op);
      }
      if (cur.length) pages.push(cur);
      if (!pages.length) return [[]];
      // 每页重新以 0 为基准，否则绘制位置会跑到画布外
      return pages.map((page) => {
        const offset = page.length ? page[0].top : 0;
        return page.map((op) => ({ ...op, top: op.top - offset }));
      });
    }

    function drawPage(ops, index, count, meta, theme) {
      const W = 1080;
      const PAD = 72;
      const INNER = W - PAD * 2;
      const bodyH = ops.reduce((m, op) => Math.max(m, op.top + op.h), 0);
      const height = PAD + 160 + bodyH + 150;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = height;
      const g = canvas.getContext('2d');

      g.fillStyle = theme.bg;
      g.fillRect(0, 0, W, height);
      const grad = g.createLinearGradient(0, 0, W, 400);
      grad.addColorStop(0, meta.theme === 'paper' ? 'rgba(43,92,136,.06)' : 'rgba(127,178,222,.10)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, 460);

      let y = PAD;
      g.fillStyle = theme.asst;
      roundRect(g, PAD, y + 4, 6, 46, 3); g.fill();
      g.font = `600 40px ${FONT_STACK}`;
      g.fillStyle = theme.text;
      g.fillText(meta.title || 'DSH 对话分享', PAD + 24, y + 40);
      y += 70;
      g.font = `24px ${FONT_STACK}`;
      g.fillStyle = theme.dim;
      const sub = (meta.subtitle || new Date().toLocaleString('zh-CN'))
        + (count > 1 ? `   ·   第 ${index}/${count} 页` : '');
      g.fillText(sub, PAD, y + 16);
      y += 58;
      g.strokeStyle = theme.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(PAD, y); g.lineTo(W - PAD, y); g.stroke();
      y += 40;

      const base = y;
      for (const op of ops) {
        const ty = base + op.top;
        if (op.type === 'code') {
          g.fillStyle = theme.code;
          roundRect(g, PAD, ty, INNER, op.h - 12, 14); g.fill();
          g.font = `24px ${MONO}`;
          g.fillStyle = theme.codeText;
          let gy = ty + 38;
          for (const line of op.lines) { g.fillText(line, PAD + 22, gy); gy += 36; }
        } else if (op.type === 'role') {
          g.font = `600 22px ${FONT_STACK}`;
          g.fillStyle = op.role === 'user' ? theme.user : theme.asst;
          g.fillText(op.role === 'user' ? '你' : 'DSH', PAD, ty + 22);
        } else {
          const spec = LINE_SPEC[op.type];
          g.font = spec.font();
          g.fillStyle = op.type === 'heading' ? theme.text
            : op.type === 'quote' ? theme.dim
            : op.type === 'table' ? theme.codeText
            : theme.text;
          let ly = ty + spec.h - 12;
          for (const line of op.lines) { g.fillText(line, PAD, ly); ly += spec.h; }
        }
      }

      const fy = height - 108;
      g.strokeStyle = theme.line;
      g.beginPath(); g.moveTo(PAD, fy); g.lineTo(W - PAD, fy); g.stroke();
      g.font = `22px ${FONT_STACK}`;
      g.fillStyle = theme.brand;
      g.fillText(meta.footer || 'DeepSeek Harness · dsh-reply-card', PAD, fy + 44);
      g.font = `20px ${FONT_STACK}`;
      g.fillStyle = theme.dim;
      const tag = count > 1 ? `分享长图 ${index}/${count}` : '分享长图';
      g.fillText(tag, W - PAD - g.measureText(tag).width, fy + 44);

      return canvas;
    }

    // 返回 canvas 数组（可能多页）
    function renderCards(messages, meta) {
      meta = meta || {};
      const theme = THEMES[meta.theme] || THEMES.ink;
      const sections = toSections(messages);
      const W = 1080;
      const PAD = 72;
      const { ops } = measureOps(sections, W - PAD * 2);
      const pages = paginate(ops);
      return pages.map((pageOps, i) => drawPage(pageOps, i + 1, pages.length, meta, theme));
    }

    // 兼容旧接口
    function renderCard(messages, meta) {
      return renderCards(messages, meta)[0];
    }

    function roundRect(g, x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + hh, r);
      g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    // 从完整消息里挑出要导出的部分
    function pickMessages(messages, mode) {
      const list = messages || [];
      if (!list.length || mode === 'full') return list;
      let lastIdx = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === 'assistant') { lastIdx = i; break; }
      }
      if (lastIdx < 0) return list.slice(-1);
      const out = [list[lastIdx]];
      if (lastIdx > 0 && list[lastIdx - 1].role === 'user') out.unshift(list[lastIdx - 1]);
      return out;
    }

    if (typeof window !== 'undefined') {
      window.__dshShareCardRender = renderCard;
      window.__dshShareCardRenderAll = renderCards;
      window.__dshShareCardCollect = collectMessages;
      window.__dshShareCardPick = pickMessages;
    }

    /* ---------------- React 界面 ---------------- */
    const OVERLAY_STYLE = {
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(8,10,14,.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    };
    const PANEL_STYLE = {
      background: '#161a21', borderRadius: 16, padding: 18,
      boxShadow: '0 24px 80px rgba(0,0,0,.5)', maxHeight: '92vh',
      display: 'flex', flexDirection: 'column', gap: 14, maxWidth: '92vw',
    };
    const BTN = {
      border: 0, borderRadius: 10, padding: '10px 18px', cursor: 'pointer',
      font: `500 14px ${FONT_STACK}`,
    };

    const TOAST_STYLE = {
      position: 'fixed', left: '50%', bottom: 48, transform: 'translateX(-50%)',
      background: 'rgba(20,24,31,.96)', color: '#e8ecf2', border: '1px solid rgba(255,255,255,.12)',
      borderRadius: 12, padding: '12px 20px', font: `500 14px ${FONT_STACK}`,
      zIndex: 2147483000, boxShadow: '0 12px 40px rgba(0,0,0,.45)', maxWidth: '70vw',
    };

    function makeButton(ctx) {
      return function ShareButton(props) {
        props = props || {};
        const sessionId = props.sessionId
          || (props.session && props.session.sessionId)
          || '';
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState('');
        const [allMessages, setAllMessages] = React.useState(null);
        const [mode, setMode] = React.useState('last');   // last | full
        const [pages, setPages] = React.useState(null);
        const [page, setPage] = React.useState(0);

        const warn = (msg) => {
          setNotice(msg);
          window.clearTimeout(warn._t);
          warn._t = window.setTimeout(() => setNotice(''), 5000);
        };

        const build = (messages, nextMode) => {
          const picked = pickMessages(messages, nextMode);
          if (!picked.length) { warn('没有可导出的内容'); return; }
          const canvases = renderCards(picked, {});
          const urls = [];
          for (const c of canvases) {
            const u = c.toDataURL('image/png');
            if (!u || u.length < 200) { warn('图片生成失败（画布超限）'); return; }
            urls.push(u);
          }
          setPage(0);
          setPages(urls);
        };

        const generate = async () => {
          if (!sessionId) { warn('没有取到会话 id'); return; }
          if (!ctx.sessions || !ctx.sessions.using) { warn('当前 DSH 版本不支持读取会话'); return; }
          setBusy(true);
          setNotice('');
          try {
            const messages = await ctx.sessions.using(
              sessionId, { source: 'gateway' }, async (ref) => {
                const binding = await ref.ready;
                const win = binding.eventSource.getSnapshot();
                return collectMessages(win && win.entries);
              },
            );
            if (!messages || !messages.length) { warn('这个会话还没有可导出的内容'); return; }
            setAllMessages(messages);
            build(messages, mode);
          } catch (err) {
            console.error('[dsh-reply-card] 生成失败', err);
            warn('生成失败：' + (err && err.message ? err.message : String(err)));
          } finally {
            setBusy(false);
          }
        };

        const switchMode = (next) => {
          setMode(next);
          if (allMessages) build(allMessages, next);
        };

        const downloadIndex = async (idx) => {
          try {
            const blob = await (await fetch(pages[idx])).blob();
            if (!blob || blob.size === 0) { warn('导出数据为空，请重试'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'dsh-share-' + (pages.length > 1 ? (idx + 1) + '-' : '') + Date.now() + '.png';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 15000);
            warn('已开始下载' + (pages.length > 1 ? '第 ' + (idx + 1) + ' 页' : '') + '（' + Math.round(blob.size / 1024) + ' KB）');
          } catch (err) {
            console.error('[dsh-reply-card] 下载失败', err);
            warn('下载失败');
          }
        };

        const close = () => { setPages(null); setPage(0); };
        const dataUrl = pages ? pages[page] : null;

        const modeBtn = (key, label) => h('button', {
          style: {
            ...BTN, padding: '6px 14px',
            background: mode === key ? '#7fb2de' : 'rgba(255,255,255,.08)',
            color: mode === key ? '#0f1115' : '#e8ecf2',
          },
          onClick: () => switchMode(key),
        }, label);

        const overlay = dataUrl ? el(
          h('div', {
            style: {
              position: 'fixed', inset: 0, zIndex: 2147483001,
              background: 'rgba(8,10,14,.78)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            },
            onClick: (e) => { if (e.target === e.currentTarget) close(); },
          },
            h('div', {
              style: {
                background: '#161a21', borderRadius: 18, padding: 18,
                boxShadow: '0 30px 90px rgba(0,0,0,.6)', display: 'flex',
                flexDirection: 'column', gap: 14, maxHeight: '92vh', maxWidth: '92vw',
              },
            },
              h('div', {
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
              },
                h('span', { style: { color: '#e8ecf2', font: `600 15px ${FONT_STACK}` } }, '分享长图 · 预览'),
                h('div', { style: { display: 'flex', gap: 8 } },
                  modeBtn('last', '仅最后一条'),
                  modeBtn('full', '完整会话'),
                ),
              ),
              h('div', {
                style: { overflow: 'auto', maxHeight: '66vh', borderRadius: 12, background: '#0b0d11' },
              }, h('img', { src: dataUrl, style: { display: 'block', width: 420, height: 'auto' } })),
              pages && pages.length > 1 ? h('div', {
                style: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', color: '#8b93a1', font: `13px ${FONT_STACK}` },
              },
                h('button', { style: { ...BTN, padding: '6px 12px', background: 'rgba(255,255,255,.08)', color: '#e8ecf2' }, onClick: () => setPage((p) => Math.max(0, p - 1)) }, '‹ 上一页'),
                h('span', null, `第 ${page + 1} / ${pages.length} 页`),
                h('button', { style: { ...BTN, padding: '6px 12px', background: 'rgba(255,255,255,.08)', color: '#e8ecf2' }, onClick: () => setPage((p) => Math.min(pages.length - 1, p + 1)) }, '下一页 ›'),
              ) : null,
              h('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
                h('button', { style: { ...BTN, background: 'rgba(255,255,255,.08)', color: '#e8ecf2' }, onClick: () => downloadIndex(page) }, pages && pages.length > 1 ? '下载本页' : '下载'),
                pages && pages.length > 1 ? h('button', {
                  style: { ...BTN, background: 'rgba(255,255,255,.08)', color: '#e8ecf2' },
                  onClick: async () => {
                    for (let i = 0; i < pages.length; i++) {
                      setPage(i);
                      await downloadIndex(i);
                      await new Promise((r) => setTimeout(r, 600));
                    }
                  },
                }, '下载全部') : null,
                h('button', { style: { ...BTN, background: '#7fb2de', color: '#0f1115' }, onClick: close }, '关闭'),
              ),
            ),
          ),
        ) : null;

        return h(React.Fragment, null,
          h('button', {
            type: 'button',
            title: '把这条对话导出成长图',
            onClick: generate,
            disabled: busy,
            style: {
              ...BTN, background: 'rgba(127,178,222,.16)', color: '#9fc4e4',
              border: '1px solid rgba(127,178,222,.3)',
            },
          }, busy ? '生成中…' : '分享长图'),
          notice ? el(h('div', { style: TOAST_STYLE }, notice)) : null,
          overlay,
        );
      };
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const Button = makeButton(ctx);
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'dsh-reply-card',
          order: 20,
        }, Button));
      },
    };
  },
});

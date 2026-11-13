/**
 * 拾页 · 原位 Hover 深度固化引擎 (Deep In-Place Hover Engine v3)
 * 全面攻坚：
 * 1. 深度固化下划线（支持 text-decoration 及 ::after 伪元素动态样式锁定）；
 * 2. 深度冻结位移动画（强行切断 transition/animation 避免鼠标离开时回弹）；
 * 3. 固化隐藏显现类组件（右上角小关闭按钮、淡入淡出元素）。
 */

(() => {
  if (window.__pagepickHoverEngine) return;

  const mirrorStyleEl = document.createElement('style');
  mirrorStyleEl.id = 'pagepick-hover-mirror-styles';
  mirrorStyleEl.setAttribute('data-h2d-ignore', 'true');
  document.head ? document.head.appendChild(mirrorStyleEl) : document.documentElement.appendChild(mirrorStyleEl);

  const scannedSelectors = new Set();
  const mirrorRules = [];

  // 1. 扫描页面中的 :hover 规则
  function scanAndMirrorHoverStyles() {
    try {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        let rules;
        try {
          rules = sheet.cssRules || sheet.rules;
        } catch (e) {
          continue;
        }
        if (!rules) continue;

        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (rule.type === CSSRule.STYLE_RULE && rule.selectorText && rule.selectorText.includes(':hover')) {
            const selector = rule.selectorText;
            if (scannedSelectors.has(selector)) continue;
            scannedSelectors.add(selector);

            const mirroredSelector = selector.replace(/:hover/g, '[data-pagepick-hover="true"]');
            const cssText = rule.style.cssText;
            if (cssText) {
              mirrorRules.push(`${mirroredSelector} { ${cssText} }`);
            }
          }
        }
      }
      if (mirrorRules.length > 0) {
        mirrorStyleEl.textContent = mirrorRules.join('\n');
      }
    } catch (e) {}
  }

  scanAndMirrorHoverStyles();
  setTimeout(scanAndMirrorHoverStyles, 1000);

  const lockedElements = [];
  let pinIdCounter = 0;

  function blockLeaveEvent(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  const BLOCK_EVENTS = ['mouseleave', 'mouseout', 'pointerleave', 'pointerout'];

  // 全面固化属性（包含下划线、边框下划线、位移、透明度、SVG）
  const FREEZE_PROPS = [
    'transform', 'box-shadow', 'border-color', 'border-bottom-color', 'border-bottom-width', 'border-bottom-style',
    'background-color', 'color', 'opacity', 'visibility', 'fill', 'stroke',
    'text-decoration', 'text-decoration-line', 'text-decoration-color'
  ];

  function freezeVisual(el, savedStyles, isRootContainer = false) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const computed = window.getComputedStyle(el);
    const oldStyle = el.getAttribute('style') || '';
    savedStyles.push({ el, oldStyle });

    // 切断动画过渡（核心：绝不让位移动画 transform 在鼠标移开时平滑滑回原位！）
    el.style.setProperty('transition', 'none', 'important');
    el.style.setProperty('animation', 'none', 'important');

    for (const p of FREEZE_PROPS) {
      const val = computed.getPropertyValue(p);
      if (val && val !== 'none' && val !== 'rgba(0, 0, 0, 0)') {
        el.style.setProperty(p, val, 'important');
      }
    }

    // 攻坚：处理很多 Tab/链接通过 ::after 实现的下划线
    try {
      const afterStyle = window.getComputedStyle(el, '::after');
      if (afterStyle.content && afterStyle.content !== 'none') {
        const pinId = 'pin-' + (++pinIdCounter);
        el.setAttribute('data-pagepick-pin-id', pinId);
        const afterCss = `
          [data-pagepick-pin-id="${pinId}"]::after {
            content: ${afterStyle.content} !important;
            display: ${afterStyle.display} !important;
            width: ${afterStyle.width} !important;
            height: ${afterStyle.height} !important;
            background-color: ${afterStyle.backgroundColor} !important;
            border-bottom: ${afterStyle.borderBottom} !important;
            opacity: ${afterStyle.opacity} !important;
            visibility: visible !important;
            transform: ${afterStyle.transform} !important;
            transition: none !important;
          }
        `;
        mirrorRules.push(afterCss);
        mirrorStyleEl.textContent = mirrorRules.join('\n');
      }
    } catch(e) {}

    if (isRootContainer) {
      el.style.setProperty('outline', '2px dashed #2563eb', 'important');
      el.style.setProperty('outline-offset', '2px', 'important');
    }
  }

  window.__pagepickHoverEngine = {
    scanStyles: scanAndMirrorHoverStyles,

    lockElement: function(target) {
      if (!target || target === document.body || target === document.documentElement) return null;

      scanAndMirrorHoverStyles();
      const savedStyles = [];

      // 1. 向上寻找并包含整块卡片/容器链
      const chain = [];
      let curr = target;
      while (curr && curr !== document.body && chain.length < 6) {
        chain.push(curr);
        const rect = curr.getBoundingClientRect();
        const s = window.getComputedStyle(curr);
        if (rect.width >= 80 && rect.height >= 32 && (s.boxShadow !== 'none' || curr.getAttribute('role') || ['relative','absolute'].includes(s.position))) {
          break;
        }
        curr = curr.parentElement;
      }

      const mainContainer = chain[chain.length - 1] || target;

      // 2. 为整条祖先链打上标记并固化
      for (const el of chain) {
        el.setAttribute('data-pagepick-hover', 'true');
        freezeVisual(el, savedStyles, el === mainContainer);
        for (const ev of BLOCK_EVENTS) {
          el.addEventListener(ev, blockLeaveEvent, true);
        }
      }

      // 3. 深度遍历卡片内部所有子元素（包含隐藏的关闭按钮、小箭头、下划线）
      const children = mainContainer.querySelectorAll('*');
      for (let i = 0; i < children.length && i < 100; i++) {
        const child = children[i];
        child.setAttribute('data-pagepick-hover', 'true');
        freezeVisual(child, savedStyles, false);
      }

      // 4. 处理浮层（如弹出的气泡、菜单、右上角关闭按钮浮层）
      const overlays = [];
      const allFloating = document.querySelectorAll('[role="tooltip"], [role="menu"], .dropdown-menu, .t-popup, .el-dropdown-menu, .ant-dropdown');
      for (const f of allFloating) {
        const s = window.getComputedStyle(f);
        if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0) {
          f.setAttribute('data-pagepick-hover', 'true');
          freezeVisual(f, savedStyles, false);
          f.style.setProperty('display', 'block', 'important');
          f.style.setProperty('visibility', 'visible', 'important');
          f.style.setProperty('opacity', '1', 'important');
          for (const ev of BLOCK_EVENTS) {
            f.addEventListener(ev, blockLeaveEvent, true);
          }
          overlays.push(f);
        }
      }

      const item = {
        mainContainer,
        chain,
        children: Array.from(children).slice(0, 100),
        overlays,
        savedStyles
      };
      lockedElements.push(item);
      return item;
    },

    unlockAll: function() {
      while (lockedElements.length > 0) {
        const item = lockedElements.pop();
        try {
          for (const s of item.savedStyles) {
            if (s.oldStyle) {
              s.el.setAttribute('style', s.oldStyle);
            } else {
              s.el.removeAttribute('style');
            }
            s.el.removeAttribute('data-pagepick-hover');
            s.el.removeAttribute('data-pagepick-pin-id');
            for (const ev of BLOCK_EVENTS) {
              s.el.removeEventListener(ev, blockLeaveEvent, true);
            }
          }
          for (const ov of item.overlays) {
            ov.removeAttribute('data-pagepick-hover');
            for (const ev of BLOCK_EVENTS) {
              ov.removeEventListener(ev, blockLeaveEvent, true);
            }
          }
        } catch (e) {}
      }
    },

    count: function() {
      return lockedElements.length;
    }
  };
})();

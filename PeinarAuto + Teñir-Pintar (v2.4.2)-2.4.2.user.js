// ==UserScript==
// @name         PeinarAuto Studio: Peinar · Teñir · Vestir · Transformar
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Sistema modular para peinar, teñir, vestir, pintar, transformar y metamorfosis con patrones avanzados, temas y presets.
// @match        https://pony.town/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'peinarauto_studio_settings_v3';
  const LEGACY_KEY = 'peinarbot_settings_v2_4';

  const DEFAULTS = {
    enabled: true,
    reactToMessage: true,
    debug: false,
    autoAnnounce: true,
    maxWaitMs: 3200,
    delays: {
      beforeOpenEditorMs: 8,
      betweenTabsMs: 120,
      betweenSelectionsMs: 90,
      betweenColorsMs: 12,
      afterActionMs: 120
    },
    coherence: {
      saturationFloor: 0.35,
      saturationCeiling: 0.95,
      lightnessFloor: 0.25,
      lightnessCeiling: 0.8
    },
    theme: 'auto',
    commandAliases: {
      peinar: ['peinar'],
      vestir: ['vestir'],
      teñir: ['teñir', 'tenir'],
      tinte: ['tinte'],
      pintar: ['pintar'],
      transformar: ['transformar'],
      metamorfosis: ['metamorfosis']
    },
    parts: {
      mane: true,
      tail: true,
      items: true,
      body: true,
      transform: true
    },
    itemsSub: {
      head: true,
      neck: true,
      chest: true,
      back: true,
      legs: true,
      waist: true
    },
    presets: {}
  };

  function deepMerge(target, src) {
    for (const key of Object.keys(src || {})) {
      const sv = src[key];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        target[key] = deepMerge(target[key] || {}, sv);
      } else {
        target[key] = sv;
      }
    }
    return target;
  }

  function loadSettings() {
    const safeDefaults = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      if (currentRaw) return deepMerge(safeDefaults, JSON.parse(currentRaw));
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) return deepMerge(safeDefaults, JSON.parse(legacyRaw));
    } catch (err) {
      console.error('[PeinarAuto Studio] error loading settings', err);
    }
    return safeDefaults;
  }

  let settings = loadSettings();
  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function log(...args) {
    if (settings.debug) console.log('[PeinarAuto Studio]', ...args);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const Utils = {
    wait,
    norm,
    clamp,
    randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
    },
    isVisible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return !!(r.width || r.height) && style.visibility !== 'hidden' && style.display !== 'none';
    },
    click(el) {
      if (!el) return false;
      try {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
        return true;
      } catch {
        try {
          el.click();
          return true;
        } catch {
          return false;
        }
      }
    },
    simulateEditorKey(letter = 'J') {
      ['keydown', 'keypress', 'keyup'].forEach((type) => {
        const upper = letter.toUpperCase();
        const code = `Key${upper}`;
        const keyCode = upper.charCodeAt(0);
        document.dispatchEvent(new KeyboardEvent(type, { key: letter, code, keyCode, which: keyCode, bubbles: true }));
      });
    }
  };

  const Dom = {
    tabButtons() {
      return Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav-link, .btn-unstyled'));
    },
    findTab(name, scope = document) {
      const n = norm(name);
      return Array.from(scope.querySelectorAll('button[role="tab"], [role="tab"], .nav-link, .btn-unstyled')).find((btn) => norm(btn.textContent || btn.innerText) === n);
    },
    async openTab(name, scope = document) {
      const tab = this.findTab(name, scope) || this.findTab(name, document);
      if (tab) {
        Utils.click(tab);
        await wait(settings.delays.betweenTabsMs);
        return true;
      }
      return false;
    },
    selectionByLabel(label) {
      const want = norm(label);
      const containers = Array.from(document.querySelectorAll('set-selection, sprite-selection, [role="radiogroup"]'));
      return containers.find((container) => {
        const lbl = container.getAttribute('label') || container.getAttribute('aria-label') || '';
        return norm(lbl).includes(want) || norm(lbl).includes(norm(`select ${label}`));
      }) || null;
    },
    selectionItems(labelVariants) {
      for (const label of labelVariants) {
        const container = this.selectionByLabel(label);
        if (!container) continue;
        const list = container.querySelector('.selection-list') || container;
        const items = Array.from(list.querySelectorAll('.selection-item'));
        if (items.length) return items;
      }
      return [];
    },
    colorInputsByLabel(labelVariants) {
      for (const label of labelVariants) {
        const container = this.selectionByLabel(label);
        if (!container) continue;
        const inputs = Array.from(container.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]'));
        if (inputs.length) return inputs;
      }
      return [];
    },
    async waitColorInputs(labelVariants, timeout = settings.maxWaitMs) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const got = this.colorInputsByLabel(labelVariants);
        if (got.length) return got;
        await wait(100);
      }
      return [];
    },
    setInputHex(input, hex) {
      if (!input) return;
      const old = (input.value || '').toString();
      input.value = old.startsWith('#') || old === '' ? hex : hex.replace('#', '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const picker = input.closest('color-picker, .color-picker, [class*="color-picker"]');
      const top = picker && picker.querySelector('.color-picker-box-top');
      if (top) top.style.setProperty('--color', hex);
    },
    savePlayButton() {
      const wants = ['save & play', 'save and play', 'guardar y jugar', 'guardar & jugar'];
      const btns = Array.from(document.querySelectorAll('button.btn.btn-success, .modal-footer button, dialog button, [role="dialog"] button')).filter(Utils.isVisible);
      return btns.find((b) => wants.some((w) => norm(b.textContent).includes(w))) || btns.at(-1) || null;
    },
    findLayerButtons() {
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(Utils.isVisible);
      const add = allButtons.find((b) => {
        const t = norm(b.textContent || b.getAttribute('aria-label') || '');
        return t.includes('add layer') || t.includes('añadir capa') || t.includes('agregar capa');
      });
      const remove = allButtons.find((b) => {
        const t = norm(b.textContent || b.getAttribute('aria-label') || '');
        return t.includes('remove layer') || t.includes('delete layer') || t.includes('eliminar capa');
      });
      return { add, remove };
    }
  };

  function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    const hh = ((h % 360) + 360) % 360 / 360;
    const ss = clamp(s, 0, 1);
    const ll = clamp(l, 0, 1);
    let r;
    let g;
    let b;
    if (ss === 0) {
      r = g = b = ll;
    } else {
      const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
      const p = 2 * ll - q;
      r = hue2rgb(p, q, hh + 1 / 3);
      g = hue2rgb(p, q, hh);
      b = hue2rgb(p, q, hh - 1 / 3);
    }
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const Themes = {
    auto: null,
    oscuro: { hueCenter: 250, hueSpread: 40, sat: [0.35, 0.7], light: [0.15, 0.45] },
    kawaii: { hueCenter: 330, hueSpread: 70, sat: [0.35, 0.75], light: [0.6, 0.9] },
    steampunk: { hueCenter: 35, hueSpread: 30, sat: [0.35, 0.8], light: [0.2, 0.6] },
    natural: { hueCenter: 110, hueSpread: 45, sat: [0.25, 0.65], light: [0.25, 0.65] },
    neón: { hueCenter: 180, hueSpread: 180, sat: [0.8, 1.0], light: [0.45, 0.7] },
    pastel: { hueCenter: 220, hueSpread: 180, sat: [0.2, 0.45], light: [0.72, 0.92] }
  };

  const ColorEngine = {
    randomHsl(themeName = settings.theme) {
      const t = Themes[themeName] || Themes.auto;
      if (!t) {
        return {
          h: Utils.randomInt(0, 359),
          s: Math.random() * (settings.coherence.saturationCeiling - settings.coherence.saturationFloor) + settings.coherence.saturationFloor,
          l: Math.random() * (settings.coherence.lightnessCeiling - settings.coherence.lightnessFloor) + settings.coherence.lightnessFloor
        };
      }
      return {
        h: Utils.randomInt(t.hueCenter - t.hueSpread, t.hueCenter + t.hueSpread),
        s: Math.random() * (t.sat[1] - t.sat[0]) + t.sat[0],
        l: Math.random() * (t.light[1] - t.light[0]) + t.light[0]
      };
    },
    toHex(hsl) {
      return hslToHex(hsl.h, hsl.s, hsl.l);
    },
    shift(hsl, deltaLight = 0, deltaSat = 0, deltaHue = 0) {
      return {
        h: (hsl.h + deltaHue + 360) % 360,
        s: clamp(hsl.s + deltaSat, 0, 1),
        l: clamp(hsl.l + deltaLight, 0, 1)
      };
    },
    hairPattern(count) {
      const base = this.randomHsl();
      const dark = this.shift(base, -0.12);
      const light = this.shift(base, 0.1);
      const palette = [];
      for (let i = 0; i < count; i += 1) {
        if (i === 0) palette.push(base);
        else if (i % 3 === 1) palette.push(dark);
        else if (i % 3 === 2) palette.push(light);
        else palette.push(base);
      }
      return palette.map((p) => this.toHex(p));
    },
    clothingPattern(count) {
      const mode = Utils.pick(['gradient_light', 'gradient_dark', 'stripes', 'complementary', 'pastel', 'neon', 'monochrome']);
      const base = this.randomHsl();
      const out = [];
      if (mode === 'gradient_light' || mode === 'gradient_dark') {
        const delta = mode === 'gradient_light' ? 0.06 : -0.06;
        for (let i = 0; i < count; i += 1) out.push(this.toHex(this.shift(base, delta * i)));
      } else if (mode === 'stripes') {
        const colorA = this.toHex(base);
        const colorB = this.toHex(this.randomHsl());
        for (let i = 0; i < count; i += 1) out.push(i % 2 === 0 ? colorA : colorB);
      } else if (mode === 'complementary') {
        const a = this.toHex(base);
        const b = this.toHex(this.shift(base, 0, 0, 180));
        for (let i = 0; i < count; i += 1) out.push(i % 2 === 0 ? a : b);
      } else if (mode === 'pastel') {
        const soft = this.shift(base, 0.24, -0.35);
        for (let i = 0; i < count; i += 1) out.push(this.toHex(this.shift(soft, i * 0.02)));
      } else if (mode === 'neon') {
        const neon = this.shift(base, 0.05, 0.28);
        const accent = this.shift(neon, 0, 0, 35);
        for (let i = 0; i < count; i += 1) out.push(i % 2 === 0 ? this.toHex(neon) : this.toHex(accent));
      } else {
        for (let i = 0; i < count; i += 1) out.push(this.toHex(this.shift(base, (i % 3) * 0.05 - 0.05, (i % 2) * 0.06 - 0.03)));
      }
      return out;
    }
  };

  const Catalog = {
    hair: [
      { tab: 'mane', labels: ['Mane', 'Main mane', 'Mane accessories'] },
      { tab: 'mane', labels: ['Back mane', 'Back hair', 'Back mane accessories'] },
      { tab: 'mane', labels: ['Ponytail', 'Pony tail', 'Ponytail accessory'] },
      { tab: 'tail', labels: ['Tail', 'Rear tail', 'Back tail', 'Tail accessories'] }
    ],
    clothingSubtabs: ['head', 'neck', 'chest', 'back', 'legs', 'waist'],
    transformGroups: [
      { tab: 'body', labels: ['Front body', 'Body front', 'Front'] },
      { tab: 'extra', labels: ['Ears', 'Ear accessories'] },
      { tab: 'extra', labels: ['Horns', 'Horn accessories'] }
    ]
  };

  function chooseRandomItemByLabels(labelVariants) {
    const items = Dom.selectionItems(labelVariants);
    if (!items.length) return false;
    const normalItems = items.filter((el) => !norm(el.id || '').endsWith('-0'));
    const pool = normalItems.length ? normalItems : items;
    return Utils.click(Utils.pick(pool));
  }

  async function applyPatternToLabels({ tab, labels, pattern }) {
    if (tab) await Dom.openTab(tab);
    const inputs = await Dom.waitColorInputs(labels);
    if (!inputs.length) return false;
    const colors = pattern(inputs.length);
    for (let i = 0; i < inputs.length; i += 1) {
      Dom.setInputHex(inputs[i], colors[i] || colors[0]);
      await wait(settings.delays.betweenColorsMs);
    }
    return true;
  }

  async function randomizeHairStyles() {
    for (const group of Catalog.hair) {
      await Dom.openTab(group.tab);
      chooseRandomItemByLabels(group.labels);
      await wait(settings.delays.betweenSelectionsMs);
    }
  }

  async function randomizeHairColors() {
    for (const group of Catalog.hair) {
      await applyPatternToLabels({ tab: group.tab, labels: group.labels, pattern: (count) => ColorEngine.hairPattern(count) });
    }
  }

  async function maybeMutateLegsLayer() {
    const chance = Math.random();
    const { add, remove } = Dom.findLayerButtons();
    if (chance < 0.34 && add) {
      Utils.click(add);
      await wait(settings.delays.betweenSelectionsMs);
      log('Legs: extra layer added');
      return;
    }
    if (chance < 0.68 && remove) {
      Utils.click(remove);
      await wait(settings.delays.betweenSelectionsMs);
      log('Legs: extra layer removed');
    }
  }

  async function randomizeItemsAndOutfit() {
    await Dom.openTab('items');
    const nav = document.querySelector('[aria-label="Character accessories"], .accessories-tabset, .nav.nav-tabs') || document;
    for (const sub of Catalog.clothingSubtabs) {
      if (!settings.itemsSub[sub]) continue;
      await Dom.openTab(sub, nav);
      chooseRandomItemByLabels([`${sub} accessories`, sub, `${sub} accessory`]);
      await applyPatternToLabels({
        labels: [`${sub} accessories`, `${sub} accessory`, sub],
        pattern: (count) => ColorEngine.clothingPattern(count)
      });
      if (sub === 'legs') await maybeMutateLegsLayer();
      await wait(settings.delays.betweenSelectionsMs);
    }
  }

  async function paintBodyBaseColor() {
    await applyPatternToLabels({
      tab: 'body',
      labels: ['Base color', 'Body color', 'Body'],
      pattern: (count) => ColorEngine.clothingPattern(count)
    });
  }

  async function randomizeTransform() {
    for (const group of Catalog.transformGroups) {
      await Dom.openTab(group.tab);
      chooseRandomItemByLabels(group.labels);
      await wait(settings.delays.betweenSelectionsMs);
    }
  }

  const Commands = {
    async vestir() {
      if (!settings.parts.items) return;
      await randomizeItemsAndOutfit();
    },
    async peinar() {
      if (!settings.parts.mane && !settings.parts.tail) return;
      await randomizeHairStyles();
    },
    async teñir() {
      await randomizeHairColors();
    },
    async tinte() {
      await randomizeItemsAndOutfit();
    },
    async pintar() {
      if (!settings.parts.body) return;
      await paintBodyBaseColor();
    },
    async transformar() {
      if (!settings.parts.transform) return;
      await randomizeTransform();
    },
    async metamorfosis() {
      await Commands.peinar();
      await Commands.teñir();
      await Commands.vestir();
      await Commands.tinte();
      await Commands.pintar();
      await Commands.transformar();
    }
  };

  let actionInProgress = false;
  async function runCommand(command, source = 'manual', author = '') {
    if (!settings.enabled || actionInProgress || !Commands[command]) return;
    actionInProgress = true;
    try {
      await wait(settings.delays.beforeOpenEditorMs);
      Utils.simulateEditorKey('J');
      await wait(settings.delays.betweenTabsMs);
      await Commands[command]();
      await wait(settings.delays.afterActionMs);
      const saveBtn = Dom.savePlayButton();
      if (saveBtn) Utils.click(saveBtn);
      if (settings.autoAnnounce && author) {
        enqueueMessage(`/${Utils.pick(['happywink', 'sillywink', 'cheekywink'])}`);
        enqueueMessage(`¡${command} ejecutado por ${author}!`);
      }
      log('command completed', command, source);
    } catch (err) {
      console.error('[PeinarAuto Studio] command error', command, err);
    } finally {
      actionInProgress = false;
    }
  }

  const messageQueue = [];
  let sending = false;
  function enqueueMessage(text) {
    messageQueue.push(text);
    processMessageQueue();
  }

  function processMessageQueue() {
    if (sending || !messageQueue.length) return;
    sending = true;
    const text = messageQueue.shift();
    const chatBtn = document.querySelector('.chat-open-button.unselectable');
    if (chatBtn) chatBtn.click();
    setTimeout(() => {
      const input = document.querySelector('.chat-textarea.chat-commons.hide-scrollbar, .chat-textarea.chat-commons');
      const sendBtn = document.querySelector('ui-button[title^="Send message"] button, ui-button[title*="Shift"] button');
      if (input && sendBtn) {
        input.focus();
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
      }
      setTimeout(() => {
        sending = false;
        processMessageQueue();
      }, 550);
    }, 240);
  }

  function resolveCommandFromText(text) {
    const t = norm(text);
    for (const [command, aliases] of Object.entries(settings.commandAliases)) {
      if (aliases.some((alias) => t.includes(`*${norm(alias)}*`) || t === norm(alias))) return command;
    }
    return null;
  }

  function observeChatCommands() {
    const processedFlag = 'data-peinarauto-processed';
    const target = document.querySelector('.chat-log') || document.body;
    const observer = new MutationObserver((mutations) => {
      if (!settings.enabled || !settings.reactToMessage) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains('chat-line')) continue;
          if (node.getAttribute(processedFlag) === '1') continue;
          node.setAttribute(processedFlag, '1');
          const msgEl = node.querySelector('.chat-line-message');
          if (!msgEl) continue;
          const msg = msgEl.textContent || '';
          const author = (node.querySelector('.chat-line-name-content')?.textContent || '').trim() || 'alguien';
          const command = resolveCommandFromText(msg);
          if (command) runCommand(command, 'chat', author);
        }
      }
    });
    observer.observe(target, { childList: true, subtree: true });
    return observer;
  }

  function createPanel() {
    const existing = document.getElementById('peinarauto-studio-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'peinarauto-studio-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:99999',
      'width:300px',
      'background:#17171fee',
      'color:#fff',
      'border:1px solid #5d66ff88',
      'border-radius:12px',
      'padding:10px',
      'font-family:Inter,Segoe UI,sans-serif',
      'backdrop-filter:blur(8px)'
    ].join(';');

    const row = (html) => {
      const div = document.createElement('div');
      div.style.marginBottom = '8px';
      div.innerHTML = html;
      return div;
    };

    panel.appendChild(row('<strong>PeinarAuto Studio</strong><div style="opacity:.8;font-size:12px">Comandos, tema y presets</div>'));

    const btns = document.createElement('div');
    btns.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:8px;';
    ['peinar', 'teñir', 'vestir', 'tinte', 'pintar', 'transformar', 'metamorfosis'].forEach((cmd) => {
      const b = document.createElement('button');
      b.textContent = cmd;
      b.style.cssText = 'border:1px solid #6473ff66;background:#2a2f67;color:#fff;border-radius:8px;padding:5px 6px;cursor:pointer;';
      b.addEventListener('click', () => runCommand(cmd, 'panel', 'tú'));
      btns.appendChild(b);
    });
    panel.appendChild(btns);

    const themeRow = document.createElement('div');
    themeRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
    const select = document.createElement('select');
    select.style.cssText = 'flex:1;background:#11172a;color:#fff;border:1px solid #4f57b2;padding:4px;border-radius:6px;';
    Object.keys(Themes).forEach((theme) => {
      const option = document.createElement('option');
      option.value = theme;
      option.textContent = `Tema: ${theme}`;
      if (theme === settings.theme) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      settings.theme = select.value;
      saveSettings();
    });
    themeRow.appendChild(select);

    const toggle = document.createElement('button');
    toggle.textContent = settings.enabled ? 'Activo' : 'Pausa';
    toggle.style.cssText = 'background:#2f8347;color:#fff;border:none;border-radius:6px;padding:5px 7px;cursor:pointer;';
    toggle.addEventListener('click', () => {
      settings.enabled = !settings.enabled;
      toggle.textContent = settings.enabled ? 'Activo' : 'Pausa';
      toggle.style.background = settings.enabled ? '#2f8347' : '#8a3f3f';
      saveSettings();
    });
    themeRow.appendChild(toggle);
    panel.appendChild(themeRow);

    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;gap:6px;';

    const presetInput = document.createElement('input');
    presetInput.placeholder = 'Nombre preset';
    presetInput.style.cssText = 'flex:1;background:#11172a;color:#fff;border:1px solid #4f57b2;padding:5px;border-radius:6px;';

    const savePreset = document.createElement('button');
    savePreset.textContent = 'Guardar';
    savePreset.style.cssText = 'background:#315ca8;color:#fff;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;';
    savePreset.addEventListener('click', () => {
      const name = presetInput.value.trim();
      if (!name) return;
      settings.presets[name] = JSON.parse(JSON.stringify(settings));
      saveSettings();
      presetInput.value = '';
      renderPresetList();
    });

    presetRow.appendChild(presetInput);
    presetRow.appendChild(savePreset);
    panel.appendChild(presetRow);

    const presetList = document.createElement('div');
    presetList.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;';

    function renderPresetList() {
      presetList.innerHTML = '';
      Object.keys(settings.presets || {}).slice(0, 8).forEach((name) => {
        const b = document.createElement('button');
        b.textContent = name;
        b.title = 'Cargar preset';
        b.style.cssText = 'background:#3d3f63;color:#fff;border:1px solid #676aa7;border-radius:999px;padding:3px 8px;cursor:pointer;font-size:11px;';
        b.addEventListener('click', () => {
          const snapshot = settings.presets[name];
          if (!snapshot) return;
          const keepPresets = settings.presets;
          settings = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), snapshot);
          settings.presets = keepPresets;
          saveSettings();
          createPanel();
        });
        presetList.appendChild(b);
      });
    }

    renderPresetList();
    panel.appendChild(presetList);
    document.body.appendChild(panel);
  }

  function boot() {
    observeChatCommands();
    createPanel();
    window.PeinarAuto = Object.assign(window.PeinarAuto || {}, {
      settings,
      runCommand,
      Commands,
      randomizeHairColors,
      randomizeItemsAndOutfit,
      paintBodyBaseColor
    });
    log('loaded v3.0.0');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

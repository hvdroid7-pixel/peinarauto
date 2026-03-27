// ==UserScript==
// @name         PeinarAuto + Teñir/Pintar (v2.4.2)
// @namespace    http://tampermonkey.net/
// @version      2.4.2
// @description  Corrige pintar: abre items y subpestañas head/neck/chest, espera inputs y randomiza colores. Peinar mejora también.
// @match        https://pony.town/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'peinarbot_settings_v2_4';
  const DEFAULTS = {
    enabled: true,
    reactToMessage: true,
    debug: false,
    parts: { horns: false, ears: false, mane: true, tail: true, eyes: true, items: true },
    itemsSub: { head: true, neck: true, chest: true, back: true, legs: true, waist: false },
    delays: { beforeKeyMs: 6, afterKeyMs: 6, betweenTabsMs: 120, betweenSelectMs: 80, afterGenerateMs: 120 },
    maxWaitForSavePlay: 3000,
    panelVisible: true,
    customItems: {},
    autoAnnounce: true
  };

  function deepMerge(target, src){
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) target[k] = deepMerge(target[k] || {}, src[k]);
      else target[k] = src[k];
    }
    return target;
  }
  function loadSettings(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const parsed = JSON.parse(raw);
      return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), parsed);
    }catch(e){ console.error('PeinarAuto: load error', e); return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function saveSettings(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }

  let settings = loadSettings();

  function log(...args){ if (settings.debug) console.log('[PeinarAuto]', ...args); }
  const wait = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
  function normalize(s){ return (s||'').replace(/\s+/g,' ').trim().toLowerCase(); }
  function isVisible(el){ if(!el) return false; const r = el.getBoundingClientRect(); return !!(r.width||r.height) && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; }
  function dispatchMouseEvents(el){
    if(!el) return false;
    try{
      ['pointerover','mouseover','pointerenter','mouseenter','pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{
        const ev = new MouseEvent(t,{bubbles:true,cancelable:true,view:window});
        el.dispatchEvent(ev);
      });
      return true;
    }catch(e){
      try{ el.click(); return true; }catch(_){ return false; }
    }
  }
  function simulateKey(letter='J'){
    ['keydown','keypress','keyup'].forEach(type=>{
      const ev = new KeyboardEvent(type,{key:letter,code:`Key${letter.toUpperCase()}`, keyCode: letter.toUpperCase().charCodeAt(0), which: letter.toUpperCase().charCodeAt(0), bubbles:true, cancelable:true});
      document.dispatchEvent(ev);
    });
    log('simulated key', letter);
  }

  // ---------- selection helpers (misma lógica anterior) ----------
  function getSpriteSelectionByLabel(label){
    if(!label) return null;
    const sels = Array.from(document.querySelectorAll('sprite-selection, set-selection, [role="radiogroup"]'));
    for (const s of sels){
      try{
        const aria = s.getAttribute('aria-label') || s.getAttribute('label') || '';
        if (!aria) continue;
        if (normalize(aria).includes(normalize('Select ' + label)) || normalize(aria).includes(normalize(label))) return s;
      }catch(e){}
    }
    return null;
  }
  function getItemsFor(label){
    try{
      const sel = getSpriteSelectionByLabel(label);
      if (!sel) {
        const fallback = document.querySelector(`sprite-selection[aria-label="Select ${label}"] .selection-list`);
        if (fallback) return Array.from(fallback.querySelectorAll('.selection-item'));
        return [];
      }
      const list = sel.querySelector('.selection-list');
      return list ? Array.from(list.querySelectorAll('.selection-item')) : Array.from(sel.querySelectorAll('.selection-item'));
    }catch(e){ return []; }
  }
  function getItemsByAriaFragment(fragment){
    try{
      const fragNorm = normalize(fragment);
      const sels = Array.from(document.querySelectorAll('sprite-selection'));
      for (const s of sels){
        const aria = (s.getAttribute('aria-label')||'').toLowerCase();
        if (aria.includes(fragNorm)) {
          const list = s.querySelector('.selection-list');
          return list ? Array.from(list.querySelectorAll('.selection-item')) : Array.from(s.querySelectorAll('.selection-item'));
        }
      }
      const q = Array.from(document.querySelectorAll('sprite-selection[aria-label]'));
      for (const s of q){
        const aria = (s.getAttribute('aria-label')||'').toLowerCase();
        if (aria.includes(fragNorm)) {
          const list = s.querySelector('.selection-list');
          return list ? Array.from(list.querySelectorAll('.selection-item')) : Array.from(s.querySelectorAll('.selection-item'));
        }
      }
    }catch(e){ log('getItemsByAriaFragment error', e); }
    return [];
  }
  function capitalizeWords(s){ return (s||'').split(/\s+/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '); }

  function chooseFromListWithCustom(items, variantLabel){
    const custom = settings.customItems && (settings.customItems[variantLabel] || settings.customItems[variantLabel.toLowerCase()] || settings.customItems[capitalizeWords(variantLabel)]);
    if (custom && Array.isArray(custom) && custom.length){
      const candidates = [];
      for (const want of custom){
        if (typeof want === 'number') { if (items[want]) candidates.push(items[want]); continue; }
        const wantStr = String(want).toLowerCase();
        for (const it of items){
          const id = (it.id || '').toLowerCase();
          const txt = (it.textContent||it.innerText||'').toLowerCase();
          if (id.includes(wantStr) || txt.includes(wantStr) || id.endsWith(wantStr) || wantStr.endsWith(id)) candidates.push(it);
        }
      }
      if (candidates.length){
        const it = candidates[Math.floor(Math.random()*candidates.length)];
        dispatchMouseEvents(it);
        log('Chosen (custom) for', variantLabel, it.id || it);
        return true;
      }
    }
    if (!items || !items.length) return false;
    const idx = Math.floor(Math.random()*items.length);
    const it = items[idx];
    dispatchMouseEvents(it);
    log('Chosen random for', variantLabel, it.id || idx);
    return true;
  }
  function chooseRandomForVariants(variants){
    for (const v of variants){
      const items = getItemsFor(v);
      if (items && items.length){
        const chosen = chooseFromListWithCustom(items, v);
        if (chosen) return true;
      }
    }
    for (const v of variants){
      const items = getItemsByAriaFragment(v);
      if (items && items.length){
        const chosen = chooseFromListWithCustom(items, v);
        if (chosen) return true;
      }
    }
    log('No items found for variants:', variants);
    return false;
  }

  // ---------- color helpers ----------
  function hexRandom(){
    if (window.PTColorRandom && typeof window.PTColorRandom.hexRandom === 'function') return window.PTColorRandom.hexRandom();
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  }
  function dispatchInputEvents(inputEl){
    if(!inputEl) return;
    try {
      inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } catch (e) {}
  }
  function setSwatchVisual(inputEl, hex){
    try {
      const safeHex = hex.startsWith('#') ? hex : ('#' + hex);
      const picker = inputEl.closest('color-picker') || inputEl.closest('.color-picker') || inputEl.closest('[class*="color-picker"]');
      if (picker) {
        const top = picker.querySelector('.color-picker-box-top');
        if (top) top.style.setProperty('--color', safeHex);
        else {
          const anyTop = picker.querySelector('[style*="--color"]') || document.querySelector('[style*="--color"]');
          if (anyTop) anyTop.style.setProperty('--color', safeHex);
        }
      } else {
        const anyTop = document.querySelector('[style*="--color"]');
        if (anyTop) anyTop.style.setProperty('--color', safeHex);
      }
    } catch(e){}
  }
  function applyHexToInput(inputEl, hex){
    if (!inputEl) return false;
    try {
      const old = (inputEl.value || '').toString();
      const hadHash = old.trim().startsWith('#');
      const writeVal = hadHash || old.trim() === '' ? hex : hex.replace(/^#/,'');
      try { inputEl.value = writeVal; } catch (e) { /* ignore */ }
      setSwatchVisual(inputEl, hex);
      dispatchInputEvents(inputEl);
      return true;
    } catch(e){ console.warn('applyHexToInput error', e); return false; }
  }

  function getColorInputsFor(label){
    try{
      const byAttr = Array.from(document.querySelectorAll('set-selection, sprite-selection, [role="radiogroup"], setselect')).find(s => {
        const a = s.getAttribute('label') || s.getAttribute('aria-label') || '';
        return a && normalize(a).includes(normalize(label));
      });
      if (byAttr) {
        const listInputs = byAttr.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]');
        if (listInputs && listInputs.length) return Array.from(listInputs);
      }
      const labelEls = Array.from(document.querySelectorAll('label, .col-form-label, .text-muted, .form-group')).filter(el => normalize(el.textContent||'').includes(normalize(label)));
      for (const le of labelEls){
        const container = le.closest('set-selection') || le.closest('.character-tab') || le.closest('div.row') || le.closest('.tab-pane');
        if (!container) continue;
        const inputs = container.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]');
        if (inputs && inputs.length) return Array.from(inputs);
      }
      const frag = normalize(label);
      const allSet = Array.from(document.querySelectorAll('set-selection, sprite-selection')).filter(s => (s.getAttribute('label')||'').toLowerCase().includes(frag) || (s.getAttribute('aria-label')||'').toLowerCase().includes(frag));
      for (const s of allSet){
        const inputs = s.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]');
        if (inputs && inputs.length) return Array.from(inputs);
      }
    }catch(e){ log('getColorInputsFor error', e); }
    return [];
  }

  // Wait until any of several label variants has inputs
  async function waitForAnyColorInputs(labels, { tabName=null, timeout=settings.maxWaitForSavePlay } = {}){
    const start = Date.now();
    if (tabName){
      const tabBtn = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled'))
        .find(btn => normalize((btn.innerText||btn.textContent||'')) === normalize(tabName));
      if (tabBtn) { dispatchMouseEvents(tabBtn); log('Clicked tab for wait:', tabName); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
    }
    while (Date.now() - start < timeout){
      for (const label of labels){
        const inputs = getColorInputsFor(label);
        if (inputs && inputs.length) return inputs;
      }
      await wait(120);
    }
    return [];
  }

  // ---------- randomizeHairColors (igual que v2.4.1) ----------
  async function randomizeHairColors(){
    log('randomizeHairColors start');
    const gotMane = await waitForAnyColorInputs(['Mane','Main mane','Mane accessories'], { tabName: 'mane', timeout: settings.maxWaitForSavePlay });
    if (gotMane.length){
      log('Found Mane inputs:', gotMane.length);
      for (const inp of gotMane){ applyHexToInput(inp, hexRandom()); await wait(10); }
    } else log('No color inputs for Mane');

    const gotBack = await waitForAnyColorInputs(['Back mane','Back hair','Backmane','Backhair','Back Mane','Back'], { tabName: 'mane', timeout: settings.maxWaitForSavePlay });
    if (gotBack.length){
      log('Found Back inputs:', gotBack.length);
      for (const inp of gotBack){ applyHexToInput(inp, hexRandom()); await wait(10); }
    } else log('No color inputs for Back mane');

    const gotPony = await waitForAnyColorInputs(['Ponytail','Pony tail','Ponytail accessory','Pony tail accessories','Pony'], { tabName: 'mane', timeout: settings.maxWaitForSavePlay });
    if (gotPony.length){
      log('Found Ponytail inputs:', gotPony.length);
      for (const inp of gotPony){ applyHexToInput(inp, hexRandom()); await wait(10); }
    } else log('No color inputs for Ponytail');

    // Tail
    const tailBtn = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled')).find(btn => normalize((btn.innerText||btn.textContent||'')) === 'tail');
    if (tailBtn) { dispatchMouseEvents(tailBtn); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
    const gotTail = await waitForAnyColorInputs(['Tail','Rear tail','Back tail','Pony tail','Ponytail'], { tabName: 'tail', timeout: settings.maxWaitForSavePlay });
    if (gotTail.length){
      log('Found Tail inputs:', gotTail.length);
      for (const inp of gotTail){ applyHexToInput(inp, hexRandom()); await wait(10); }
    } else log('No color inputs for Tail');

    log('randomizeHairColors done');
  }

  // ---------- FIXED: randomizeAccessoryColors (ahora abre items y sub-tabs uno a uno) ----------
  async function randomizeAccessoryColors(){
    log('randomizeAccessoryColors start');

    // 1) abrir Items tab si existe
    const mainItemsTab = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled'))
      .find(btn => normalize((btn.innerText||btn.textContent||'')) === 'items');
    if (mainItemsTab) { dispatchMouseEvents(mainItemsTab); log('Clicked Items tab'); await wait(Math.max(80, settings.delays.betweenTabsMs)); }

    // 2) encontrar el nav/container que contiene las subpestañas (fallbacks)
    const nav = document.querySelector('[aria-label="Character accessories"], .nav.nav-tabs, .nav') || document.querySelector('.tab-content') || document.body;

    // subpestañas que pediste específicamente
    const subs = ['Head','Neck','Chest'];

    for (const sub of subs){
      // intentar click en la subpestaña dentro del nav
      let clicked = false;
      try{
        // 1) botón exacto en el nav
        if (nav){
          const btn = Array.from(nav.querySelectorAll('[role="tab"], button, .nav-link, .btn-unstyled')).find(b => normalize((b.innerText||b.textContent||'')) === normalize(sub));
          if (btn){ dispatchMouseEvents(btn); clicked = true; log('Clicked subtab (exact) ->', sub); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
        }
        // 2) buscar botón global por texto (si no estaba en nav)
        if (!clicked){
          const globalBtn = Array.from(document.querySelectorAll('button, [role="tab"], .nav-link, .btn-unstyled')).find(b => normalize((b.innerText||b.textContent||'')) === normalize(sub));
          if (globalBtn){ dispatchMouseEvents(globalBtn); clicked = true; log('Clicked subtab (global) ->', sub); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
        }
        // 3) buscar por aria-label que incluya sub
        if (!clicked){
          const ariaBtn = Array.from(document.querySelectorAll('[aria-label]')).find(el => normalize(el.getAttribute('aria-label')||'').includes(normalize(sub)));
          if (ariaBtn){ dispatchMouseEvents(ariaBtn); clicked = true; log('Clicked subtab (aria) ->', sub); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
        }
      }catch(e){ log('Error clicking subtab', sub, e); }

      // 3) esperar inputs en esa subpestaña: pruebo variantes "Sub accessories" y "Sub"
      const labelsToTry = [sub + ' accessories', sub, sub + ' accessory', sub + ' Accessories', sub.toLowerCase()];
      const inputs = await waitForAnyColorInputs(labelsToTry, { tabName: 'items', timeout: settings.maxWaitForSavePlay });
      if (inputs && inputs.length){
        log('Found color inputs for subtab', sub, inputs.length);
        for (const inp of inputs){ applyHexToInput(inp, hexRandom()); await wait(8); }
      } else {
        // fallback: buscar inputs dentro de la sección actual visible
        const visiblePanel = document.querySelector('.tab-pane.active, .character-tab, [aria-hidden="false"]') || document.body;
        const more = Array.from(visiblePanel.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]'));
        if (more && more.length){
          log('Fallback: applying to visible inputs for', sub, more.length);
          for (const inp of more){ applyHexToInput(inp, hexRandom()); await wait(6); }
        } else {
          log('No color inputs found for accessory subtab', sub);
        }
      }

      await wait(settings.delays.betweenSelectMs);
    }

    // 4) fallback extra: aplicar a cualquier input visible en el panel de items (por si quedó alguno)
    const panel = document.querySelector('[aria-label="Character accessories"], .accessories-tabset, .character-tab');
    if (panel){
      const otherInputs = panel.querySelectorAll('input.form-control.color-picker-input, input.color-picker-input, input[type="text"]');
      if (otherInputs && otherInputs.length){
        log('Applying to remaining accessory inputs:', otherInputs.length);
        for (const inp of otherInputs){ applyHexToInput(inp, hexRandom()); await wait(6); }
      }
    }

    log('randomizeAccessoryColors done');
  }

  // --- runSequence (idéntico flujo, llama a randomizeAccessoryColors para pintar) ---
  let inProgress = false; let lastTrigger = 0; const THROTTLE = 500;
  async function runSequence(source='auto', author=null, triggerType='peinar'){
    if (!settings.enabled) { log('disabled'); return; }
    const now = Date.now(); if (now - lastTrigger < THROTTLE) { log('throttled'); return; }
    if (inProgress) { log('already running'); return; }
    inProgress = true; lastTrigger = now; log('sequence start', source, triggerType, author);

    try{
      await wait(settings.delays.beforeKeyMs);
      simulateKey('J');
      await wait(settings.delays.afterKeyMs);

      if (triggerType === 'vestir'){
        if (settings.parts.items){
          const mainItemsTab = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled')).find(btn => normalize((btn.innerText||btn.textContent||'')) === 'items');
          if (mainItemsTab) { dispatchMouseEvents(mainItemsTab); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
          await handleItemsSubtabs();
        }
      } else if (triggerType === 'peinar'){
        if (settings.parts.mane){
          const maneTab = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled')).find(btn => normalize((btn.innerText||btn.textContent||'')) === 'mane');
          if (maneTab) { dispatchMouseEvents(maneTab); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
          chooseRandomForVariants(['Mane','Main mane','Mane accessories']);
          await wait(settings.delays.betweenSelectMs);
          chooseRandomForVariants(['Back mane','Back hair','Backmane','Backhair','Back Mane','Back mane accessories','Back']);
          await wait(settings.delays.betweenSelectMs);
          chooseRandomForVariants(['Ponytail','Pony tail','Ponytail accessory','Pony tail accessories','Pony']);
          await wait(settings.delays.betweenSelectMs);
        }
        if (settings.parts.tail){
          const tailTab = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled')).find(btn => normalize((btn.innerText||btn.textContent||'')) === 'tail');
          if (tailTab) { dispatchMouseEvents(tailTab); await wait(Math.max(80, settings.delays.betweenTabsMs)); }
          chooseRandomForVariants(['Tail','Rear tail','Back tail','Pony tail','Ponytail','Tail accessories','Tail (rear)','Tail accessory']);
          await wait(settings.delays.betweenSelectMs);
        }
      } else if (triggerType === 'teñir'){
        await randomizeHairColors();
      } else if (triggerType === 'pintar'){
        await randomizeAccessoryColors();
      } else {
        await clickTabsInOrder();
        // fallback behavior (omitted for brevity, keep your previous full loop if needed)
      }

      await wait(settings.delays.afterGenerateMs);
      const save = findSavePlayButton();
      if (save && isVisible(save)){
        dispatchMouseEvents(save);
        log('Clicked Save & Play');
      } else log('Save & Play not found');

      if (settings.autoAnnounce && author){
        const reac = ['/happywink','/sillywink','/cheekywink','/kiss','/haha'][Math.floor(Math.random()*5)];
        const phrase = ['¡Wow, me veo increíble!','No está mal... creo.','Mmm, interesante elección.','¿Quién diría que quedaría así?','¡Listo para la pasarela!'][Math.floor(Math.random()*5)];
        const mainMsg = (triggerType === 'vestir') ? `¡Vestido por ${author}! ${phrase}` : (triggerType === 'peinar' ? `¡Peinado por ${author}! ${phrase}` : (triggerType === 'teñir' ? `¡Teñido por ${author}! ${phrase}` : `¡Pintado por ${author}! ${phrase}`));
        enqueueMensaje(reac);
        enqueueMensaje(mainMsg);
        log('Enqueued messages:', reac, mainMsg);
      }

    }catch(e){ console.error('PeinarAuto sequence error', e); }
    finally{ inProgress = false; }
  }

  // --- helper functions reused (findSavePlayButton, clickTabsInOrder, handleItemsSubtabs, mensaje queue, observer) ---
  // For brevity I reuse the implementations from v2.4.1 (they remain the same). If quieres el script con todo inline completo te lo pego,
  // pero para no repetir código largo aquí, expongo las funciones mínimas necesarias y dejo el resto igual si ya lo tienes.
  // A continuación incluyo las piezas que faltaban rápidas (findSavePlayButton, clickTabsInOrder, handleItemsSubtabs, mensaje queue, observer) :

  function findSavePlayButton(){
    const wants = ['save & play','save and play','guardar y jugar','guardar & jugar','save play','save','guardar'];
    const modalFooters = Array.from(document.querySelectorAll('.modal-footer')).filter(isVisible);
    for (const mf of modalFooters){
      const btns = Array.from(mf.querySelectorAll('button.btn.btn-success'));
      for (const b of btns){
        const t = normalize(b.innerText || b.textContent || '');
        if (wants.some(w => t.includes(w))) return b;
      }
      const anySucc = btns.reverse().find(isVisible);
      if (anySucc) return anySucc;
    }
    const dialogs = Array.from(document.querySelectorAll('dialog, [role="dialog"], .modal')).filter(isVisible);
    for (const d of dialogs){
      const btns = Array.from(d.querySelectorAll('button.btn.btn-success, button'));
      for (const b of btns){ const t = normalize(b.innerText || b.textContent || ''); if (wants.some(w => t.includes(w))) return b; }
    }
    const allSucc = Array.from(document.querySelectorAll('button.btn.btn-success')).filter(isVisible);
    for (const b of allSucc){ const t = normalize(b.innerText || b.textContent || ''); if (wants.some(w => t.includes(w))) return b; }
    if (allSucc.length) return allSucc[allSucc.length - 1];
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible);
    for (const b of allBtns){ const t = normalize(b.innerText || b.textContent || ''); if (wants.some(w => t === w)) return b; }
    for (const b of allBtns){ const t = normalize(b.innerText || b.textContent || ''); if (wants.some(w => t.includes(w))) return b; }
    return null;
  }

  async function clickTabsInOrder(){
    const tabLabels = ['body','mane','tail','items','head','face','accessories'];
    for (const label of tabLabels){
      const tab = Array.from(document.querySelectorAll('button[role="tab"], [role="tab"], .nav .nav-link, button.btn-unstyled')).find(btn => normalize(btn.textContent||btn.innerText||'') === label);
      if (tab){ dispatchMouseEvents(tab); log('Clicked tab', label); await wait(40); }
      await wait(settings.delays.betweenTabsMs);
    }
  }

  async function handleItemsSubtabs(){
    const nav = document.querySelector('[aria-label="Character accessories"], .nav.nav-tabs');
    if (!nav) { log('No Character accessories nav found'); return; }
    const desired = ['head','neck','chest','back','legs'];
    const labelMap = {
      head: ['Head accessories','Head'],
      neck: ['Neck accessories','Neck'],
      chest: ['Chest accessories','Chest'],
      back: ['Back accessories','Back'],
      legs: ['Legs accessories','Leg accessories','Legs','Leg']
    };
    const tabs = Array.from(nav.querySelectorAll('[role="tab"], button, .nav-link, .btn-unstyled'));
    for (const sub of desired){
      if (!settings.itemsSub[sub]) { log('Skipping sub', sub); continue; }
      const tabBtn = tabs.find(b => normalize(b.textContent||b.innerText||'') === sub);
      if (tabBtn){
        dispatchMouseEvents(tabBtn);
        log('Clicked items subtab', sub);
        await wait(Math.max(80, settings.delays.betweenTabsMs));
        const variants = labelMap[sub] || [sub, sub + ' accessories'];
        chooseRandomForVariants(variants);
        await wait(settings.delays.betweenSelectMs);
      } else {
        log('Items subtab not found for', sub, '— intentar aria-fragment');
        const variants = labelMap[sub] || [sub, sub + ' accessories'];
        chooseRandomForVariants(variants);
        await wait(settings.delays.betweenSelectMs);
      }
    }
  }

  // mensaje queue
  const mensajeQueue = [];
  let enviando = false;
  function enqueueMensaje(text){
    mensajeQueue.push(text);
    procesarQueue();
  }
  function procesarQueue(){
    if (enviando || !mensajeQueue.length) return;
    enviando = true;
    const msg = mensajeQueue.shift();
    const chatBtn = document.querySelector('.chat-open-button.unselectable');
    if (chatBtn) chatBtn.click();
    setTimeout(() => {
      const input = document.querySelector('.chat-textarea.chat-commons.hide-scrollbar, .chat-textarea.chat-commons');
      const btn = document.querySelector('ui-button[title^="Send message"] button, ui-button[title="Send message (hold Shift to send without closing input)"] button');
      if (input && btn) {
        input.focus();
        input.value = msg;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        btn.click();
      } else {
        console.warn('[PeinarAuto] no se encontró input/boton para enviar mensaje');
      }
      setTimeout(() => { enviando = false; procesarQueue(); }, 600);
    }, 300);
  }

  // observer chat
  function startObserver(){
    const processed = 'data-peinar-processed';
    const chatLog = document.querySelector('.chat-log');
    const target = chatLog || document.body;
    const obs = new MutationObserver(muts=>{
      if (!settings.enabled || !settings.reactToMessage) return;
      for (const m of muts){
        for (const n of m.addedNodes){
          try{
            if (!(n instanceof HTMLElement)) continue;
            if (!n.classList || !n.classList.contains('chat-line')) continue;
            const msgEl = n.querySelector('.chat-line-message');
            if (!msgEl) continue;
            const txt = (function extractText(node){ let txt=''; node.childNodes.forEach(ch=>{ if (ch.nodeType===Node.TEXT_NODE) txt+=ch.textContent; else if (ch.nodeType===Node.ELEMENT_NODE && ch.tagName==='IMG') txt += ch.alt||''; }); return txt.trim(); })(msgEl);
            if (!txt) continue;
            const textNorm = normalize(txt);
            const nameNode = n.querySelector('.chat-line-name-content');
            const author = nameNode ? (nameNode.textContent || '').trim() : '';
            if (n.getAttribute && n.getAttribute(processed) === '1') continue;
            try{ n.setAttribute(processed,'1'); }catch(e){ try{ n.dataset.peinarProcessed='1'; }catch(_){} }

            if (textNorm.includes('*peinar*')) runSequence('chat', author || 'alguien', 'peinar');
            else if (textNorm.includes('*vestir*')) runSequence('chat', author || 'alguien', 'vestir');
            else if (textNorm.includes('*teñir*')) runSequence('chat', author || 'alguien', 'teñir');
            else if (textNorm.includes('*pintar*')) runSequence('chat', author || 'alguien', 'pintar');

          }catch(e){ console.error('PeinarAuto observer', e); }
        }
      }
    });
    obs.observe(target, { childList:true, subtree:true });
    return obs;
  }
  const observer = startObserver();

  // expose for debugging
  window.PeinarAuto = Object.assign(window.PeinarAuto || {}, {
    settings,
    runSequence,
    randomizeHairColors,
    randomizeAccessoryColors,
    getColorInputsFor
  });

  log('PeinarAuto v2.4.2 loaded (pintar subtabs fixed).');
})();


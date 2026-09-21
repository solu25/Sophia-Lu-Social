/*
 * dc-lite.js — a small standalone runtime for Sophia's "Portfolio After Hours" pages.
 *
 * Each page keeps the same markup it had in the design canvas:
 *   <x-dc> … <helmet> styles … markup with {{holes}} … </x-dc>
 *   <script type="text/x-dc" data-dc-script data-props='{…}'> class Component extends DCLogic { … } </script>
 *
 * This file does the canvas runtime's job in plain JavaScript:
 *   - fills {{holes}} in attributes and text from renderVals()
 *   - wires onClick / onScroll / onWheel / onKeyDown / onMouseEnter / onFocus handlers
 *   - re-renders on setState, calls componentDidMount / componentDidUpdate
 *   - scales fixed-size scenes (intro, door, lobby) to fit any screen
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([\w.$]+)\s*\}\}/g;
  var ONLY_HOLE = /^\s*\{\{\s*([\w.$]+)\s*\}\}\s*$/;
  var EVENTS = {
    onclick: 'click', ondblclick: 'dblclick', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave',
    onmousedown: 'mousedown', onmouseup: 'mouseup', onfocus: 'focusin', onblur: 'focusout',
    onkeydown: 'keydown', onkeyup: 'keyup', onwheel: 'wheel', onscroll: 'scroll', oninput: 'input',
    onchange: 'change', onsubmit: 'submit', onpointerdown: 'pointerdown', onpointerup: 'pointerup',
    ontouchstart: 'touchstart', ontouchend: 'touchend'
  };

  var comp = null, vals = {}, bindings = [], mounted = false, queued = false, prevState = null, cbs = [];

  function lookup(obj, path) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return undefined;
      obj = obj[parts[i]];
    }
    return obj;
  }
  function str(v) { return v == null ? '' : String(v); }
  function fill(tpl) { return tpl.replace(HOLE, function (_, p) { return str(lookup(vals, p)); }); }

  function DCLogic(props) { this.props = props || {}; this.state = null; }
  DCLogic.prototype.setState = function (patch, cb) {
    var next = typeof patch === 'function' ? patch(this.state || {}, this.props) : patch;
    this.state = Object.assign({}, this.state || {}, next || {});
    if (typeof cb === 'function') cbs.push(cb);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function schedule() {
    if (queued || !mounted) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; render(); });
  }

  function render() {
    var before = prevState;
    vals = comp.renderVals ? (comp.renderVals() || {}) : {};
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i], next = fill(b.tpl);
      if (next === b.last) continue;
      b.last = next;
      if (b.text) b.node.nodeValue = next;
      else if (b.name === 'value' && 'value' in b.node) b.node.value = next;
      else b.node.setAttribute(b.name, next);
    }
    prevState = Object.assign({}, comp.state || {});
    if (!mounted) {
      mounted = true;
      if (comp.componentDidMount) comp.componentDidMount();
    } else if (comp.componentDidUpdate) {
      comp.componentDidUpdate(Object.assign({}, comp.props), before || {});
    }
    var run = cbs; cbs = [];
    run.forEach(function (f) { f(); });
  }

  function bindTree(rootEl) {
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        if (node.nodeValue.indexOf('{{') !== -1) bindings.push({ text: true, node: node, tpl: node.nodeValue, last: null });
      } else {
        var attrs = Array.prototype.slice.call(node.attributes);
        for (var i = 0; i < attrs.length; i++) {
          var a = attrs[i], name = a.name, lower = name.toLowerCase(), value = a.value;
          if (value.indexOf('{{') === -1) continue;
          var m = ONLY_HOLE.exec(value);
          if (lower.slice(0, 2) === 'on' && m) {
            node.removeAttribute(name);
            (function (el, evt, path) {
              el.addEventListener(evt, function (e) {
                var fn = lookup(vals, path);
                if (typeof fn === 'function') fn(e);
              }, evt === 'wheel' ? { passive: true } : false);
            })(node, EVENTS[lower] || lower.slice(2), m[1]);
          } else {
            bindings.push({ node: node, name: name, tpl: value, last: null });
          }
        }
      }
      node = walker.nextNode();
    }
  }

  function fit(stage) {
    var meta = document.querySelector('meta[name="dc-fit"]');
    if (!meta || !stage) return;
    var p = meta.getAttribute('content').split(/\s+/), mode = p[0], W = +p[1], H = +p[2];
    var html = document.documentElement, body = document.body;
    function apply() {
      var vw = window.innerWidth, vh = window.innerHeight;
      if (mode === 'contain' || mode === 'fill-width') {
        html.style.height = body.style.height = '100%';
        html.style.overflow = body.style.overflow = 'hidden';
        stage.style.position = 'absolute';
        stage.style.transformOrigin = '0 0';
        var s, h = H;
        if (mode === 'contain') { s = Math.min(vw / W, vh / H); }
        else { s = vw / W; h = Math.round(vh / s); stage.style.height = h + 'px'; stage.style.setProperty('--dc-h', h + 'px'); }
        stage.style.left = Math.round((vw - W * s) / 2) + 'px';
        stage.style.top = mode === 'contain' ? Math.round((vh - H * s) / 2) + 'px' : '0px';
        stage.style.transform = 'scale(' + s + ')';
      } else if (mode === 'zoom') {
        var tall = /100vh/.test(stage.getAttribute('data-dc-h') || '');
        if (vw < W && vw > 800) {
          var z = vw / W;
          stage.style.zoom = z;
          if (tall) stage.style.height = (vh / z) + 'px';
        } else {
          stage.style.zoom = '';
          if (tall) stage.style.height = '100vh';
        }
      }
    }
    if (mode === 'zoom') stage.setAttribute('data-dc-h', stage.style.height || '');
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', function () { setTimeout(apply, 120); });
  }

  function boot() {
    var host = document.querySelector('x-dc');
    if (!host) { document.documentElement.classList.remove('dc-loading'); return; }

    var helmet = host.querySelector('helmet');
    if (helmet) {
      while (helmet.firstChild) document.head.appendChild(helmet.firstChild);
      helmet.parentNode.removeChild(helmet);
    }

    var script = document.querySelector('script[data-dc-script]');
    var props = {};
    if (script) {
      try {
        var decl = JSON.parse(script.getAttribute('data-props') || '{}');
        Object.keys(decl).forEach(function (k) {
          if (k.charAt(0) !== '$' && decl[k] && typeof decl[k] === 'object' && 'default' in decl[k]) props[k] = decl[k]['default'];
        });
      } catch (e) { /* no props */ }
    }
    var Component = DCLogic;
    if (script) {
      try {
        Component = new Function('DCLogic', script.textContent + '\n;return typeof Component !== "undefined" ? Component : DCLogic;')(DCLogic);
      } catch (e) { console.error('Page script failed to load', e); }
    }
    comp = new Component(props);
    if (!comp.props) comp.props = props;

    bindTree(host);
    render();

    var stage = null;
    for (var c = host.firstElementChild; c; c = c.nextElementSibling) { stage = c; break; }
    fit(stage);

    var auto = document.querySelector('[data-dc-autofocus]');
    if (auto && auto.focus) { try { auto.focus({ preventScroll: true }); } catch (e) { auto.focus(); } }

    document.documentElement.classList.remove('dc-loading');
    window.addEventListener('pagehide', function () { if (comp && comp.componentWillUnmount) comp.componentWillUnmount(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

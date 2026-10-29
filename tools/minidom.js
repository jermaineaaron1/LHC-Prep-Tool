'use strict';
// Minimal DOM shim: just enough surface for the WO functions under test.
//
// Index.html has no build step and the repo has no node_modules, so there is no
// jsdom to lean on. Rather than install one, this implements the handful of DOM
// methods the extracted functions actually touch. Supports selectors of the
// form ".class" and ".class[attr=\"value\"]", which is all they use.

function parseSel(sel) {
  return sel.split(',').map(function (part) {
    part = part.trim();
    // tag and/or .cls, optionally narrowed by [attr="val"], or by
    // :not([attr]) -- "has this class but NOT this attribute", which is
    // how a list counts its own rows while ignoring ones another view
    // put there. A bare tag is here because code reaches for the icon
    // inside a button by element name, not by class.
    var m = /^([A-Za-z][A-Za-z0-9-]*)?((?:\.[A-Za-z0-9_-]+)*)(?:\[([A-Za-z-]+)="([^"]*)"\])?(?::not\(\[([A-Za-z-]+)\]\))?$/.exec(part);
    if (!m || (!m[1] && !m[2])) throw new Error('minidom: unsupported selector: ' + part);
    // Several classes at once -- ".a.b" is "has both", which is how one
    // column of a two-column list is told from the other.
    return { tag: m[1] ? m[1].toUpperCase() : null,
             cls: m[2] ? m[2].slice(1).split('.') : [],
             attr: m[3] || null, val: m[4], without: m[5] || null };
  });
}

function El(tag, cls, attrs) {
  this.tagName = (tag || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this._attrs = Object.assign({}, attrs || {});
  var self = this;
  this.classList = {
    _set: new Set((cls || '').split(/\s+/).filter(Boolean)),
    contains: function (c) { return this._set.has(c); },
    add: function (c) { this._set.add(c); },
    remove: function (c) { this._set.delete(c); },
    // Two-argument form included: code that folds a panel open and shut
    // uses toggle(cls, bool), and a one-argument shim would flip it.
    toggle: function (c, on) {
      var want = (arguments.length > 1) ? !!on : !this._set.has(c);
      if (want) this._set.add(c); else this._set.delete(c);
      return want;
    }
  };
  // Inline style as the browser presents it: style="display:none" on the
  // tag becomes el.style.display here. Declarations only -- no cascade and
  // no computed values, so a harness that needs to know whether something
  // is on screen has to say so itself.
  this.style = {};
  String(this._attrs.style || '').split(';').forEach(function (decl) {
    var i = decl.indexOf(':');
    if (i < 0) return;
    var k = decl.slice(0, i).trim().replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
    if (k) self.style[k] = decl.slice(i + 1).trim();
  });
  Object.defineProperty(this, 'className', {
    get: function () { return Array.from(self.classList._set).join(' '); },
    // Settable, as it is on a real element: swapping an icon's whole class
    // string is how a chevron turns round.
    set: function (v) {
      self.classList._set = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean));
    }
  });
}

El.prototype.getAttribute = function (n) {
  return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null;
};
El.prototype.setAttribute = function (n, v) { this._attrs[n] = String(v); };

El.prototype.appendChild = function (c) {
  c.parentNode = this;
  this.children.push(c);
  return c;
};

El.prototype.remove = function () {
  if (!this.parentNode) return;
  var i = this.parentNode.children.indexOf(this);
  if (i >= 0) this.parentNode.children.splice(i, 1);
  this.parentNode = null;
};

// Putting a detached node back where it came from is how the section undo
// works, so the shim has to model the position, not just the membership.
El.prototype.insertBefore = function (node, ref) {
  node.parentNode = this;
  var i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(node);
  else this.children.splice(i, 0, node);
  return node;
};

Object.defineProperty(El.prototype, 'parentElement', {
  get: function () { return this.parentNode; }
});

Object.defineProperty(El.prototype, 'nextElementSibling', {
  get: function () {
    if (!this.parentNode) return null;
    var sibs = this.parentNode.children;
    var i = sibs.indexOf(this);
    return (i >= 0 && i + 1 < sibs.length) ? sibs[i + 1] : null;
  }
});

// Real elements expose id as a property; code under test uses both forms.
Object.defineProperty(El.prototype, 'id', {
  get: function () { return this.getAttribute('id') || ''; },
  set: function (v) { this.setAttribute('id', v); }
});

// Enough of textContent for the label lookups these paths do.
Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    if (this._text != null) return this._text;
    return this.children.map(function (c) { return c.textContent; }).join('');
  },
  set: function (v) { this._text = String(v); this.children = []; }
});

Object.defineProperty(El.prototype, 'isConnected', {
  get: function () {
    var n = this;
    while (n.parentNode) n = n.parentNode;
    return n._isRoot === true;
  }
});

El.prototype._descendants = function () {
  var out = [];
  (function walk(n) {
    n.children.forEach(function (c) { out.push(c); walk(c); });
  })(this);
  return out;
};

El.prototype._matches = function (spec) {
  if (spec.tag && this.tagName !== spec.tag) return false;
  for (var ci = 0; ci < spec.cls.length; ci++) {
    if (!this.classList.contains(spec.cls[ci])) return false;
  }
  if (spec.attr && this.getAttribute(spec.attr) !== spec.val) return false;
  if (spec.without && this.getAttribute(spec.without) != null) return false;
  return true;
};

El.prototype.querySelectorAll = function (sel) {
  var specs = parseSel(sel);
  return this._descendants().filter(function (n) {
    return specs.some(function (s) { return n._matches(s); });
  });
};

El.prototype.querySelector = function (sel) {
  var r = this.querySelectorAll(sel);
  return r.length ? r[0] : null;
};

El.prototype.closest = function (sel) {
  var specs = parseSel(sel);
  var n = this;
  while (n && n._matches) {
    if (specs.some(function (s) { return n._matches(s); })) return n;
    n = n.parentNode;
  }
  return null;
};

// Every opening tag in the string, as one child element carrying its
// classes and attributes. Flat on purpose: the selectors these harnesses
// use are "class, optionally with an attribute", never descendant
// selectors, so modelling nesting would be inventing a browser. What
// matters is that an element rendered into the container can be found and
// its attributes read.
function parseFlat(html) {
  var out = [];
  var tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
  var m;
  while ((m = tagRe.exec(html))) {
    var attrs = {}, cls = '';
    var attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    var a;
    while ((a = attrRe.exec(m[2] || ''))) {
      if (a[1].toLowerCase() === 'class') cls = a[2] || '';
      else attrs[a[1]] = a[2] === undefined ? '' : a[2];
    }
    out.push(new El(m[1], cls, attrs));
  }
  return out;
}

// innerHTML setter: replaces the children with what the string describes.
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (v) {
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
    this._html = v;
    var self = this;
    parseFlat(String(v == null ? '' : v)).forEach(function (el) { self.appendChild(el); });
  }
});

function makeDocument() {
  var root = new El('body', '');
  root._isRoot = true;
  return {
    root: root,
    getElementById: function (id) {
      var hit = root._descendants().filter(function (n) { return n.getAttribute('id') === id; });
      return hit.length ? hit[0] : null;
    },
    querySelector: function (sel) { return root.querySelector(sel); },
    querySelectorAll: function (sel) { return root.querySelectorAll(sel); },
    createElement: function (tag) { return new El(tag, ''); }
  };
}

module.exports = { El: El, makeDocument: makeDocument };

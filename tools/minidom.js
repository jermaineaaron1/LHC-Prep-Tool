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
    var m = /^\.([A-Za-z0-9_-]+)(?:\[([A-Za-z-]+)="([^"]*)"\])?$/.exec(part);
    if (!m) throw new Error('minidom: unsupported selector: ' + part);
    return { cls: m[1], attr: m[2] || null, val: m[3] };
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
    remove: function (c) { this._set.delete(c); }
  };
  Object.defineProperty(this, 'className', {
    get: function () { return Array.from(self.classList._set).join(' '); }
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
  if (!this.classList.contains(spec.cls)) return false;
  if (spec.attr && this.getAttribute(spec.attr) !== spec.val) return false;
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

// innerHTML setter: in these code paths it is only ever used to blow the
// container away and drop in a placeholder box, so model exactly that.
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (v) {
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
    this._html = v;
    if (/wo-content-box/.test(v)) this.appendChild(new El('div', 'wo-content-box'));
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
    }
  };
}

module.exports = { El: El, makeDocument: makeDocument };

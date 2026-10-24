// Lockdown of the built-ins, injected into every runner before the code under test is loaded.
//
// Without it, a deliverable could, while it loads, rewrite Array.prototype.push,
// Object.prototype.toJSON or Array.prototype.every: the runner, or a property's expression,
// would then use these rigged versions, and failures would turn into passes.
// So every standard built-in is frozen (prototypes included) and their global names are
// locked. As in SES, the inherited names that ordinary code reassigns on its own objects
// (toString, name, message, constructor…) stay reassignable on instances.

const GLOBALS = [
  'Object', 'Function', 'Array', 'Number', 'Boolean', 'String', 'Symbol', 'BigInt', 'Date', 'RegExp', 'Promise', 'Proxy', 'Reflect',
  'JSON', 'Math', 'Atomics', 'Intl', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'InternalError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'escape', 'unescape',
];

export const LOCKDOWN = `{
  const DP = Object.defineProperty, GOPD = Object.getOwnPropertyDescriptor, GPO = Object.getPrototypeOf, FR = Object.freeze, OWN = Reflect.ownKeys;
  const tame = (o, k) => {
    const d = o && GOPD(o, k);
    if (!d || !('value' in d) || !d.configurable) return;
    const v = d.value;
    DP(o, k, {
      configurable: false,
      enumerable: d.enumerable,
      get() { return v; },
      set(x) {
        if (this === o) throw new TypeError('Cannot change ' + String(k) + ': the built-ins are frozen');
        DP(this, k, { value: x, writable: true, enumerable: true, configurable: true });
      },
    });
  };
  for (const k of ['constructor', 'toString', 'valueOf', 'toLocaleString', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']) tame(Object.prototype, k);
  for (const k of ['constructor', 'toString']) { tame(Function.prototype, k); tame(Array.prototype, k); }
  for (const e of ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'InternalError']) {
    const C = globalThis[e];
    if (C) for (const k of ['name', 'message', 'constructor', 'toString']) tame(C.prototype, k);
  }
  const names = ${JSON.stringify(GLOBALS)};
  const seen = new WeakSet();
  const harden = (o) => {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return;
    seen.add(o);
    FR(o);
    harden(GPO(o));
    for (const k of OWN(o)) {
      const d = GOPD(o, k);
      if (!d) continue;
      if ('value' in d) harden(d.value);
      else { harden(d.get); harden(d.set); }
    }
  };
  for (const n of names) {
    if (!(n in globalThis)) continue;
    harden(globalThis[n]);
    const d = GOPD(globalThis, n);
    if (d && d.configurable) DP(globalThis, n, { value: globalThis[n], writable: false, enumerable: d.enumerable, configurable: false });
  }
  // The prototypes no global name points to: generators, async functions, iterators.
  for (const x of [function* () {}, async function () {}, async function* () {}, [][Symbol.iterator](), new Map()[Symbol.iterator](), new Set()[Symbol.iterator](), ''[Symbol.iterator](), 'a'.matchAll(/a/g)]) {
    harden(GPO(x));
  }
}
`;

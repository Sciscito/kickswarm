// Verrouillage des primitives, injecté dans chaque lanceur avant de charger le code testé.
//
// Sans lui, un livrable pourrait, au moment de son chargement, réécrire Array.prototype.push,
// Object.prototype.toJSON ou Array.prototype.every : le lanceur, ou l'expression d'une propriété,
// utiliserait ensuite ces versions truquées, et des échecs deviendraient des réussites.
// On gèle donc toutes les primitives standard (prototypes compris) et on verrouille leurs noms
// globaux. Comme dans SES, les noms hérités qu'un code ordinaire réaffecte sur ses propres objets
// (toString, name, message, constructor…) restent réaffectables sur les instances.

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
  // Les prototypes qu'aucun nom global ne désigne : générateurs, fonctions asynchrones, itérateurs.
  for (const x of [function* () {}, async function () {}, async function* () {}, [][Symbol.iterator](), new Map()[Symbol.iterator](), new Set()[Symbol.iterator](), ''[Symbol.iterator](), 'a'.matchAll(/a/g)]) {
    harden(GPO(x));
  }
}
`;

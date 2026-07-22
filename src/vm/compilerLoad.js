// Pure logic for capturing `compilePattern` out of the fetched compiler blob
// — split out of compilerWorker.js so it's testable without a real Worker.
//
// The compiler blob declares `const compilePattern = (src) => {...}`, NOT a
// bare global assignment. `new Function(compilerSrc)()` runs that `const` as
// a local binding scoped to the function body — it vanishes the instant the
// call returns, and reading `compilePattern` from outside afterward silently
// resolves to `undefined` (a `typeof` check on an unresolvable identifier
// doesn't throw) rather than failing loudly. Returning the binding FROM
// WITHIN the same function body, before it exits, is the only way to
// capture it.
//
// Trust note: `compilerSrc` only ever comes from the dev server's own
// filesystem read of the local OS-level compiler cache (vite.config.js's
// COMPILER_ROUTE) — never from the network or user input.
export function loadCompiler(compilerSrc) {
  // eslint-disable-next-line no-new-func -- intentional: loading an
  // externally-fetched, opaque compiler blob into an isolated scope.
  const factory = new Function(
    compilerSrc + '\n;return typeof compilePattern !== "undefined" ? compilePattern : undefined;'
  )
  return factory() || null
}

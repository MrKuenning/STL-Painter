// Browser-safe loader for the manifold-3d WASM module (uses Vite's ?url asset import so the .wasm file resolves in dev & build).
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let instancePromise = null;

export function getManifold() {
  if (!instancePromise) {
    instancePromise = Module({ locateFile: () => wasmUrl }).then((m) => {
      m.setup();
      return m;
    });
  }
  return instancePromise;
}


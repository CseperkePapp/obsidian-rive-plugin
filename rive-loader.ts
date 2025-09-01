// Lightweight dynamic import wrapper for the Rive web runtime.
// We keep this separate so future optimization (e.g., lazy loading) is easy.

const cache: Record<string, Promise<any>> = {};

export async function getRive(renderer: 'canvas'|'webgl'|'webgl2' = 'canvas') {
  if (!cache[renderer]) {
    let modImport: Promise<any>;
    switch(renderer) {
      case 'webgl2':
        modImport = import('@rive-app/webgl2');
        break;
      case 'webgl':
        modImport = import('@rive-app/webgl');
        break;
      default:
        modImport = import('@rive-app/canvas');
    }
    cache[renderer] = modImport.then(m => m);
  }
  return cache[renderer];
}

export interface RiveInstanceConfig {
  src: string; // path to .riv asset (Obsidian vault path resolved later)
  autoplay?: boolean;
  artboard?: string;
  stateMachine?: string;
  loop?: boolean;
  renderer?: 'canvas'|'webgl'|'webgl2';
  animation?: string;
}

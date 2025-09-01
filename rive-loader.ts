// Lightweight dynamic import wrapper for the Rive web runtime.
// We keep this separate so future optimization (e.g., lazy loading) is easy.

let rivePromise: Promise<any> | undefined;

export async function getRive() {
  if (!rivePromise) {
    // Dynamic import so plugin loads fast if user doesn't view Rive blocks immediately.
    rivePromise = import('rive-js').then(mod => mod); // module exports constructor(s)
  }
  return rivePromise;
}

export interface RiveInstanceConfig {
  src: string; // path to .riv asset (Obsidian vault path resolved later)
  autoplay?: boolean;
  artboard?: string;
  stateMachine?: string;
  loop?: boolean;
}

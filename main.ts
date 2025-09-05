import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { getRive } from './rive-loader';

interface MyPluginSettings { mySetting: string; defaultAutoplay: boolean; defaultLoop: boolean; defaultRenderer: 'canvas' | 'webgl' | 'webgl2'; enableHotkeys: boolean; defaultFit: string; defaultAlignment: string; }
const DEFAULT_SETTINGS: MyPluginSettings = { mySetting: 'default', defaultAutoplay: true, defaultLoop: true, defaultRenderer: 'canvas', enableHotkeys: true, defaultFit: 'contain', defaultAlignment: 'center' };
interface RiveRenderedInstance { restart: () => void; pause: () => void; play: () => void; toggle: () => void; isPaused: () => boolean; stopRendering?: () => void; startRendering?: () => void; element: HTMLCanvasElement; dispose: () => void; }
const activeRiveInstances: Set<RiveRenderedInstance> = new Set();
// Injected at build time via esbuild define
const PLUGIN_VERSION = (process as any)?.env?.PLUGIN_VERSION || 'dev';
const riveBufferCache: Map<string, ArrayBuffer> = new Map();

// Runtime version consistency check (best-effort; ignored if packages unavailable)
function checkRiveVersionsOnce() {
	// only run once
	if ((checkRiveVersionsOnce as any)._ran) return;
	(checkRiveVersionsOnce as any)._ran = true;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const vc = require('@rive-app/canvas/package.json')?.version;
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const v1 = require('@rive-app/webgl/package.json')?.version;
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const v2 = require('@rive-app/webgl2/package.json')?.version;
		const versions = [vc, v1, v2].filter(Boolean) as string[];
		if (!versions.length) return;
		const mismatch = versions.some(v => v !== versions[0]);
		if (mismatch) {
			console.warn('[Rive] Version mismatch detected among packages:', { canvas: vc, webgl: v1, webgl2: v2 });
			new Notice('Rive package version mismatch – see console');
		} else {
			console.debug('[Rive] Packages unified version', versions[0]);
		}
	} catch (e) {
		// silent – optional feature
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings; private lastInstance: RiveRenderedInstance | null = null;
	async onload() {
		await this.loadSettings();
		checkRiveVersionsOnce();
		const ribbon = this.addRibbonIcon('dice', 'Rive Plugin', () => new Notice('Rive plugin active')); ribbon.addClass('rive-plugin-ribbon');
		const status = this.addStatusBarItem(); status.setText('Rive '+PLUGIN_VERSION);
		this.addCommand({ id: 'rive-test-load', name: 'Rive: Test runtime load', callback: async () => { try { const rive = await getRive(); new Notice('Rive runtime loaded ('+PLUGIN_VERSION+')'); console.log('Rive module', rive); } catch (e) { console.error(e); new Notice('Failed to load Rive runtime'); } } });
		this.addCommand({ id: 'rive-show-version', name: 'Rive: Show plugin version', callback: () => { new Notice('Rive plugin version '+PLUGIN_VERSION); console.log('[Rive] Plugin version', PLUGIN_VERSION); } });
		this.addCommand({ id: 'rive-restart-last', name: 'Rive: Restart last animation', callback: () => { if (this.lastInstance) { this.lastInstance.restart(); new Notice('Rive animation restarted'); } else new Notice('No Rive animation active'); } });
		this.addCommand({ id: 'rive-toggle-last', name: 'Rive: Toggle play/pause last animation', callback: () => { if (this.lastInstance) { this.lastInstance.toggle(); new Notice(this.lastInstance.isPaused() ? 'Rive paused' : 'Rive playing'); } else new Notice('No Rive animation active'); } });

		// Global hotkeys (optional)
		window.addEventListener('keydown', (e) => {
			if (!this.settings.enableHotkeys) return;
			if (!this.lastInstance) return;
			if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
			if (e.key === ' ') { e.preventDefault(); this.lastInstance.toggle(); }
			else if (e.key.toLowerCase() === 'r') { e.preventDefault(); this.lastInstance.restart(); }
		});
		// Page visibility performance pause
		const visHandler = () => {
			for (const inst of activeRiveInstances) {
				try { if (document.hidden) inst.stopRendering?.(); else inst.startRendering?.(); } catch {}
			}
		};
		document.addEventListener('visibilitychange', visHandler);
				this.registerMarkdownCodeBlockProcessor('rive', async (source, el, ctx) => {
				// Derive frontmatter overrides (note-level)
				let fmOverrides: Partial<MyPluginSettings> & { frontmatterRenderer?: string } = {};
				try {
					const file = ctx?.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
					if (file instanceof TFile) {
						const cache = this.app.metadataCache.getFileCache(file);
						const fm: any = cache?.frontmatter;
						if (fm) {
							// Support grouped under "rive" or prefixed keys
							const group = fm.rive || {};
							const pick = (k: string) => {
								if (group[k] !== undefined) return group[k];
								const pref = fm['rive' + k.charAt(0).toUpperCase() + k.slice(1)];
								return pref;
							};
							if (pick('autoplay') !== undefined) fmOverrides.defaultAutoplay = !!pick('autoplay');
							if (pick('loop') !== undefined) fmOverrides.defaultLoop = !!pick('loop');
							if (pick('renderer') !== undefined) fmOverrides.defaultRenderer = pick('renderer');
						}
					}
				} catch {}
				const mergedDefaults: MyPluginSettings = { ...this.settings, ...fmOverrides } as MyPluginSettings;
				const cfg = parseRiveBlockConfig(source, mergedDefaults);
				el.addClass('rive-block');
				const container = el.createDiv({ cls: 'rive-block-container' });
				const canvas = container.createEl('canvas', { cls: 'rive-canvas' });
				let controls: HTMLDivElement | null = null;
				let playBtn: HTMLButtonElement | null = null;
				let restartBtn: HTMLButtonElement | null = null;
				let pathSpan: HTMLSpanElement | null = null;
				if (cfg.showControls) {
					controls = container.createDiv({ cls: 'rive-controls' });
					playBtn = controls.createEl('button', { text: 'Loading…' });
					restartBtn = controls.createEl('button', { text: 'Restart' });
					pathSpan = controls.createSpan({ text: cfg.src ? ` ${cfg.src}` : '' });
					playBtn.disabled = true; restartBtn.disabled = true;
				}
				if (!cfg.src) { container.createDiv({ cls: 'rive-error', text: 'Missing src (src: path/to/file.riv)' }); return; }
				try {
					// helper to show overlay with optional detail
					const showOverlay = (message: string, detail?: any, kind: string = 'error') => {
						const cls = kind === 'warn' ? 'rive-overlay-warn' : 'rive-overlay-error';
						const ov = container.createDiv({ cls, text: message });
						if (detail) {
							ov.addClass('clickable');
							ov.onclick = () => {
								const pretty = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
								navigator.clipboard?.writeText(pretty).catch(()=>{});
								new Notice('Rive diagnostics copied to clipboard (see console)');
								console.debug('[Rive] Overlay detail', detail);
								ov.detach();
							};
						}
						return ov;
					};
						const resolvedPath = resolveRivePath(cfg.src, ctx?.sourcePath, this.app);
						if (resolvedPath !== cfg.src) {
							if (pathSpan) pathSpan.textContent = ' ' + resolvedPath; // show resolved path
						}
						const exists = await this.app.vault.adapter.exists(resolvedPath);
						if (!exists) {
							container.createDiv({ cls: 'rive-error', text: `File not found: ${resolvedPath}` });
							if (playBtn) playBtn.textContent = 'Not found';
							return;
						}
						let arrayBuffer: ArrayBuffer;
						if (riveBufferCache.has(resolvedPath)) {
							arrayBuffer = riveBufferCache.get(resolvedPath)!;
						} else {
							arrayBuffer = await this.app.vault.adapter.readBinary(resolvedPath);
							riveBufferCache.set(resolvedPath, arrayBuffer);
						}
					const rendererChoice = (cfg.renderer === 'webgl' || cfg.renderer === 'webgl2' || cfg.renderer === 'canvas') ? cfg.renderer : (mergedDefaults.defaultRenderer || 'canvas');
					let riveMod: any = await getRive(rendererChoice as 'canvas'|'webgl'|'webgl2');
					const RiveCtor: any = (riveMod && (riveMod.Rive || riveMod.default)) || riveMod;
					// Determine loop constant if available
					let loopConst: any = undefined;
					if (cfg.loop && riveMod.Loop) {
						// Prefer Loop.forever then Loop.loop fallback
						loopConst = riveMod.Loop.forever || riveMod.Loop.loop || Object.values(riveMod.Loop)[0];
					}
					let instance: any; let isPaused = !cfg.autoplay; let loaded = false;
					// Log config & buffer length for diagnostics
					console.debug('[Rive] Render begin', { path: resolvedPath, cfg, rendererChoice, cached: riveBufferCache.has(resolvedPath), bufferBytes: arrayBuffer.byteLength });
					// Resize handling with aspect ratio
					const applySize = () => {
						const parentWidth = container.clientWidth;
						let targetWidth = parentWidth;
						if (cfg.width) targetWidth = Math.min(parentWidth, cfg.width);
						canvas.style.width = targetWidth + 'px';
						// Determine height: explicit height > ratio > intrinsic
						let h: number | undefined;
						if (cfg.height) h = cfg.height;
						else if (cfg.ratio) h = targetWidth / cfg.ratio;
						else if (typeof (instance as any)?.bufferWidth === 'number' && typeof (instance as any)?.bufferHeight === 'number') {
							const iw = (instance as any).bufferWidth; const ih = (instance as any).bufferHeight;
							if (iw > 0 && ih > 0) h = targetWidth * (ih / iw);
						}
						if (h) canvas.style.height = Math.round(h) + 'px';
					};
					const resizeObserver = new ResizeObserver(() => { if (!canvas.isConnected) { resizeObserver.disconnect(); return; } applySize(); });
					resizeObserver.observe(container);
					const finalize = () => {
						loaded = true;
						if (playBtn && restartBtn) {
							playBtn.disabled = false; restartBtn.disabled = false;
							playBtn.textContent = isPaused ? 'Play' : 'Pause';
						}
						applySize();
						// Attempt artboard fallback detection (API varies across versions)
						try {
							if (typeof instance?.artboardNames === 'function') {
								const names = instance.artboardNames();
								if (names && names.length && typeof instance?.artboard === 'function') {
									// potential artboard inspection point
								}
							}
						} catch {}
						// State machine input discovery + buttons
						try {
							if (cfg.stateMachines && cfg.stateMachines.length && controls) {
								// Avoid clutter: create a sub-group
                                const smGroup = controls.createDiv({ cls: 'rive-sm-inputs' });
                                smGroup.createSpan({ text: 'Inputs:' });
                                const addInputBtn = (label: string, onClick: () => void) => {
                                    const b = smGroup.createEl('button', { text: label });
                                    b.onclick = onClick;
                                };
                                // Rive runtime exposes instance.stateMachineInputs(name) in new API; fallback heuristics otherwise.
                                const collected: any[] = [];
                                for (const sm of cfg.stateMachines) {
                                    let inputs: any[] | null = null;
                                    try {
                                        if (typeof instance?.stateMachineInputs === 'function') inputs = instance.stateMachineInputs(sm) || [];
                                    } catch {}
                                    if (!inputs || !inputs.length) continue;
                                    inputs.forEach(inp => collected.push({ sm, inp }));
                                }
                                collected.forEach(({ sm, inp }) => {
                                    const type = inp?.type || inp?.__proto__?.constructor?.name || 'input';
                                    const n = inp?.name || inp?.id || 'input';
                                    if (typeof inp?.fire === 'function') {
                                        addInputBtn(n, () => { try { inp.fire(); } catch {} });
                                    } else if (typeof inp?.value === 'boolean') {
                                        addInputBtn(n, () => { try { inp.value = !inp.value; } catch {} });
                                    } else if (typeof inp?.value === 'number') {
                                        addInputBtn(n + '+', () => { try { inp.value = (inp.value || 0) + 1; } catch {} });
                                    } else {
                                        addInputBtn(n, () => {});
                                    }
                                });
                                if (!collected.length) {
                                    smGroup.createSpan({ text: ' (none)' });
                                }
                            }
                        } catch (e) { console.warn('Rive state machine input inspection failed', e); }
                        // Animation test buttons (one per configured animation)
                        try {
                            if (cfg.animations && cfg.animations.length && controls) {
                                const animGroup = controls.createDiv({ cls: 'rive-anim-buttons' });
                                animGroup.createSpan({ text: 'Anims:' });
                                const uniqueAnims = Array.from(new Set(cfg.animations));
                                uniqueAnims.forEach(animName => {
                                    const b = animGroup.createEl('button', { text: animName });
                                    b.onclick = () => {
                                        try {
                                            if (typeof instance?.play === 'function') {
                                                instance.play(animName);
                                                isPaused = false;
                                                if (playBtn) playBtn.textContent = 'Pause';
                                            }
                                        } catch (err) { console.warn('Failed to play animation', animName, err); }
                                    };
                                });
                            }
                        } catch (e) { console.warn('Rive animation button setup failed', e); }
					};
					// Fit / Alignment mapping to runtime enums if available
					const fitKey = (cfg.fit || mergedDefaults.defaultFit || 'contain').toLowerCase();
					const alignKey = (cfg.alignment || mergedDefaults.defaultAlignment || 'center').toLowerCase();
					const fitEnum = riveMod?.Fit || {};
					const alignEnum = riveMod?.Alignment || {};
					const fit = fitEnum[Object.keys(fitEnum).find(k => k.toLowerCase() === fitKey) || 'Contain'];
					const alignment = alignEnum[Object.keys(alignEnum).find(k => k.toLowerCase() === alignKey) || 'Center'];
					let layout: any = undefined;
					try { if (riveMod?.Layout) layout = new riveMod.Layout({ fit, alignment }); } catch {}
					// Asset loader support (local vault path or remote HTTP). Allows block key assetsBase: path/to/assets or /root/path or URL base.
					let assetLoader: any = undefined;
					if (cfg.assetsBase) {
						const baseRaw = cfg.assetsBase.trim();
						const adapter = this.app.vault.adapter;
						const normalizeBase = (b: string) => b.replace(/\\+/g,'/').replace(/\/$/, '');
						const base = normalizeBase(baseRaw);
						assetLoader = {
							load: async (assetRef: any) => {
								try {
									let name = '';
									if (typeof assetRef === 'string') name = assetRef; else if (assetRef?.fileName) name = assetRef.fileName; else if (assetRef?.name) name = assetRef.name; else if (assetRef?.src) name = assetRef.src;
									if (!name) return null;
									if (/^https?:\/\//i.test(name)) { const r = await fetch(name); return await r.arrayBuffer(); }
									// If base is URL use fetch
									if (/^https?:\/\//i.test(base)) { const r = await fetch(base + '/' + name); return await r.arrayBuffer(); }
									const resolvedBase = base.startsWith('/') ? base.substring(1) : resolveRivePath(base, ctx?.sourcePath, this.app);
									const full = (resolvedBase.replace(/\/$/,'') + '/' + name.replace(/^\/+/, '')).replace(/\/+/g,'/');
									if (await adapter.exists(full)) { return await adapter.readBinary(full); }
									return null;
								} catch(e) { console.warn('Rive asset load failed', e); return null; }
							},
							loadAsset: async (asset: any) => assetLoader.load(asset)
						};
					}
					const attemptedRenderers: string[] = [];
					const attemptedStrategies: string[] = [];
					// placeholder; actual assignment comes after ctorParamsBase declared
					let ctorParamsBase: any;
					const handleLoadError = async (err: any, failedRenderer: string) => {
						console.error('[Rive] onLoadError', failedRenderer, err);
						attemptedRenderers.push(failedRenderer);
						// Strategy fallback #1: if buffer method failed, try object URL via src (once)
						if (!attemptedStrategies.includes('objectUrl')) {
							attemptedStrategies.push('objectUrl');
							try {
								const blob = new Blob([arrayBuffer]);
								const objUrl = URL.createObjectURL(blob);
								showOverlay('Retrying via blob URL…', { renderer: failedRenderer }, 'warn');
								instance = new RiveCtor({
									...ctorParamsBase,
									src: objUrl,
									buffer: undefined,
									onLoad: () => { console.log('[Rive] Loaded via blob URL fallback'); finalize(); URL.revokeObjectURL(objUrl); },
									onLoadError: (eB: any) => { console.error('[Rive] Blob URL fallback failed', eB); handleLoadError(eB, failedRenderer); }
								});
								return; // wait for this attempt to resolve
							} catch (blobErr) {
								console.warn('[Rive] Blob URL strategy threw', blobErr);
							}
						}
						// Try canvas fallback once if not already tried
						if (failedRenderer !== 'canvas' && !attemptedRenderers.includes('canvas')) {
							showOverlay('Retrying with canvas…', { failedRenderer, err: String(err) }, 'warn');
							try {
								riveMod = await getRive('canvas');
								const RCtor: any = (riveMod && (riveMod.Rive || riveMod.default)) || riveMod;
								instance = new RCtor({
									...ctorParamsBase,
									onLoad: () => { console.log('[Rive] Fallback canvas loaded'); finalize(); },
									onLoadError: (e2: any) => {
										console.error('[Rive] Canvas fallback failed', e2);
										showOverlay('Rive load error (canvas fallback)', { path: resolvedPath, rendererTried: [rendererChoice, 'canvas'], error: String(e2) });
										if (playBtn) { playBtn.textContent = 'Error'; playBtn.disabled = true; }
									}
								});
								return;
							} catch (e3) {
								console.error('[Rive] Fallback attempt threw', e3);
							}
						}
						showOverlay('Rive load error', { path: resolvedPath, renderer: failedRenderer, error: String(err) });
						if (playBtn) { playBtn.textContent = 'Error'; playBtn.disabled = true; }
					};

					ctorParamsBase = {
						canvas,
						buffer: arrayBuffer,
						autoplay: cfg.autoplay,
						loop: loopConst,
						layout,
						assetLoader,
						onLoad: () => { console.log('Rive loaded', cfg.src, cfg.artboard || '', cfg.renderer || ''); instance?.resizeDrawingSurfaceToCanvas?.(); finalize(); },
						onLoadError: (err: any) => { handleLoadError(err, rendererChoice); }
					};
					if (cfg.artboard) ctorParamsBase.artboard = cfg.artboard;
					if (cfg.stateMachines && cfg.stateMachines.length) ctorParamsBase.stateMachines = cfg.stateMachines.length === 1 ? cfg.stateMachines[0] : cfg.stateMachines;
					if (cfg.animations && cfg.animations.length) ctorParamsBase.animations = cfg.animations.length === 1 ? cfg.animations[0] : cfg.animations;

					// initial attempt
					instance = new RiveCtor(ctorParamsBase);

					const api: RiveRenderedInstance = {
						restart: () => {
							if (!loaded) return;
							try { if (typeof instance?.reset === 'function') instance.reset(); } catch {}
							if (typeof instance?.play === 'function') instance.play();
							isPaused = false; if (playBtn) playBtn.textContent = 'Pause';
						},
						pause: () => { if (!loaded) return; if (typeof instance?.pause === 'function') { instance.pause(); isPaused = true; if (playBtn) playBtn.textContent = 'Play'; } },
						play: () => { if (!loaded) return; if (typeof instance?.play === 'function') { instance.play(); isPaused = false; if (playBtn) playBtn.textContent = 'Pause'; } },
						toggle: () => { if (!loaded) return; isPaused ? api.play() : api.pause(); },
						isPaused: () => isPaused,
						stopRendering: () => { try { (instance as any)?.stopRendering?.(); } catch {} },
						startRendering: () => { try { (instance as any)?.startRendering?.(); if (!isPaused) (instance as any)?.play?.(); } catch {} },
						element: canvas,
						dispose: () => { activeRiveInstances.delete(api); io?.disconnect(); }
					};
					this.lastInstance = api;
					activeRiveInstances.add(api);
					// IntersectionObserver for off-screen pause
					let io: IntersectionObserver | null = null;
					if ('IntersectionObserver' in window) {
						io = new IntersectionObserver(entries => {
							const entry = entries[0];
							if (!entry.isIntersecting) api.stopRendering?.(); else api.startRendering?.();
						}, { threshold: 0.01 });
						io.observe(canvas);
					}
					if (playBtn) playBtn.onclick = () => { if (!loaded) return; isPaused ? api.play() : api.pause(); };
					if (restartBtn) restartBtn.onclick = () => api.restart();
					// Safety timeout: if onLoad never fires, show diagnostics & possible fallback
					window.setTimeout(async () => {
						if (!loaded) {
							console.warn('[Rive] Load timeout', { path: resolvedPath, rendererChoice, cfg });
							if (playBtn) playBtn.textContent = 'Error';
							showOverlay('Rive load timeout', { path: resolvedPath, rendererChoice, cfg });
							// try canvas fallback if not yet and original choice not canvas
							if (rendererChoice !== 'canvas' && attemptedRenderers.indexOf('canvas') === -1) {
								attemptedRenderers.push(rendererChoice);
								try {
									showOverlay('Timeout – trying canvas fallback…', { original: rendererChoice }, 'warn');
									riveMod = await getRive('canvas');
									const RCtor: any = (riveMod && (riveMod.Rive || riveMod.default)) || riveMod;
									instance = new RCtor({ ...ctorParamsBase, onLoad: () => { console.log('[Rive] Loaded after timeout with canvas fallback'); finalize(); }, onLoadError: (e4: any) => { console.error('[Rive] Canvas fallback after timeout failed', e4); showOverlay('Rive load error (post-timeout)', { error: String(e4) }); } });
								} catch (e5) {
									console.error('[Rive] Canvas fallback throw (timeout)', e5);
								}
							}
						}
					}, 8000);
				} catch (e) {
					console.error('Failed to render Rive', e);
					container.createDiv({ cls: 'rive-error', text: 'Failed to load Rive file'});
					if (playBtn) playBtn.textContent = 'Error';
				}
			});
		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.registerDomEvent(document, 'click', () => {});
		this.registerInterval(window.setInterval(() => console.log('Rive plugin heartbeat'), 5 * 60 * 1000));
	}
	onunload() { this.lastInstance = null; }
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }
}

function parseRiveBlockConfig(source: string, settings: MyPluginSettings): { src: string; autoplay: boolean; loop: boolean; artboard?: string; stateMachines?: string[]; renderer?: string; animations?: string[]; ratio?: number; width?: number; height?: number; fit?: string; alignment?: string; assetsBase?: string; showControls: boolean; } {
	const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const raw: Record<string, any> = { autoplay: settings.defaultAutoplay, loop: settings.defaultLoop };
	for (const line of lines) {
		const m = line.match(/^(\w+)\s*[:=]\s*(.+)$/);
		if (m) {
			const key = m[1];
			let val: any = m[2];
			if (val === 'true') val = true; else if (val === 'false') val = false;
			raw[key] = val;
		} else if (!raw.src && line.endsWith('.riv')) {
			raw.src = line;
		}
	}
	// Normalization: support singular or plural keys and comma-separated lists
	const toList = (v: any): string[] | undefined => {
		if (!v) return undefined;
		if (Array.isArray(v)) return v.filter(Boolean);
		if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
		return undefined;
	};
	// Merge animation / animations
	const anims = [
		... (toList(raw.animation) || []),
		... (toList(raw.animations) || [])
	];
	const stateMs = [
		... (toList(raw.stateMachine) || []),
		... (toList(raw.stateMachines) || [])
	];
	// Ratio parsing: allow ratio: 16/9 or ratio: 1.777, also alias aspect
	let ratio: number | undefined;
	const ratioRaw = raw.ratio || raw.aspect;
	if (ratioRaw) {
		if (/^\d+\s*\/\s*\d+$/.test(ratioRaw)) {
			const [a,b] = ratioRaw.split('/').map((n:string)=> parseFloat(n));
			if (b && b !== 0) ratio = a / b;
		} else {
			const parsed = parseFloat(String(ratioRaw));
			if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) ratio = parsed;
		}
	}
	const width = raw.width !== undefined ? parseFloat(String(raw.width)) : undefined;
	const height = raw.height !== undefined ? parseFloat(String(raw.height)) : undefined;
	if (!ratio && width && height) {
		if (height !== 0) ratio = width / height;
	}
	// showControls logic: default true unless explicit false / ui none / controls: false / minimal true
	let showControls = true;
	const uiVal = (raw.ui || raw.UI || '').toString().toLowerCase();
	if (uiVal === 'none' || uiVal === 'minimal' || uiVal === 'off') showControls = false;
	if (raw.controls !== undefined) {
		if (typeof raw.controls === 'string') {
			const v = raw.controls.toLowerCase();
			if (v === 'false' || v === 'off' || v === '0' || v === 'none') showControls = false;
		} else if (raw.controls === false) showControls = false;
	}
	if (raw.minimal === true || raw.minimal === 'true') showControls = false;
	return {
		src: raw.src || '',
		autoplay: !!raw.autoplay,
		loop: !!raw.loop,
		artboard: raw.artboard,
		renderer: raw.renderer,
		animations: anims.length ? Array.from(new Set(anims)) : undefined,
		stateMachines: stateMs.length ? Array.from(new Set(stateMs)) : undefined,
		ratio,
		width: width && isFinite(width) && width > 0 ? width : undefined,
		height: height && isFinite(height) && height > 0 ? height : undefined,
		fit: raw.fit,
		alignment: raw.alignment,
		assetsBase: raw.assetsBase || raw.assetBase || raw.assetsDir,
		showControls
	};
}

function resolveRivePath(raw: string, notePath: string | undefined, app: App): string {
	if (!raw) return raw;
	// Normalize slashes
	let p = raw.replace(/\\+/g, '/');
	// Leading slash => vault root absolute
	if (p.startsWith('/')) return p.substring(1);
	// If contains ':' (windows absolute) just return as-is (Obsidian rarely uses this internally)
	if (/^[A-Za-z]:/.test(p)) return p;
	const vault = app.vault; // internal paths use forward slashes
	const noteDir = notePath ? notePath.split('/').slice(0, -1).join('/') : '';
	const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
	const candidateRelative = join(noteDir, p);
	// If no note dir or file doesn't exist, fallback to original path relative to root
	// We'll optimistically return candidateRelative; existence checked by caller.
	return candidateRelative;
}

class SampleModal extends Modal { onOpen() { this.contentEl.setText('Woah!'); } onClose() { this.contentEl.empty(); } }
class SampleSettingTab extends PluginSettingTab { plugin: MyPlugin; constructor(app: App, plugin: MyPlugin) { super(app, plugin); this.plugin = plugin; } display(): void { const { containerEl } = this; containerEl.empty(); new Setting(containerEl).setName('Default autoplay').setDesc('Autoplay animations when rendered').addToggle(t => t.setValue(this.plugin.settings.defaultAutoplay).onChange(async v => { this.plugin.settings.defaultAutoplay = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default loop').setDesc('Loop animations by default').addToggle(t => t.setValue(this.plugin.settings.defaultLoop).onChange(async v => { this.plugin.settings.defaultLoop = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default renderer').setDesc('Renderer used when block does not specify (canvas/webgl/webgl2); frontmatter can override').addDropdown(d => d.addOptions({ canvas: 'canvas', webgl: 'webgl', webgl2: 'webgl2'}).setValue(this.plugin.settings.defaultRenderer).onChange(async v => { if (v === 'canvas' || v === 'webgl' || v === 'webgl2') { this.plugin.settings.defaultRenderer = v; await this.plugin.saveSettings(); } })); new Setting(containerEl).setName('Enable hotkeys').setDesc('Global space = toggle, R = restart (last animation)').addToggle(t => t.setValue(this.plugin.settings.enableHotkeys).onChange(async v => { this.plugin.settings.enableHotkeys = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default fit').setDesc('Layout fit (contain, cover, fill, fitWidth, fitHeight, none, scaleDown)').addText(t => t.setPlaceholder('contain').setValue(this.plugin.settings.defaultFit).onChange(async v => { this.plugin.settings.defaultFit = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default alignment').setDesc('Layout alignment (center, topLeft, bottomRight, etc.)').addText(t => t.setPlaceholder('center').setValue(this.plugin.settings.defaultAlignment).onChange(async v => { this.plugin.settings.defaultAlignment = v; await this.plugin.saveSettings(); })); }}

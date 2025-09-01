import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { getRive } from './rive-loader';

interface MyPluginSettings { mySetting: string; defaultAutoplay: boolean; defaultLoop: boolean; defaultRenderer: 'canvas' | 'webgl' | 'webgl2'; enableHotkeys: boolean; defaultFit: string; defaultAlignment: string; }
const DEFAULT_SETTINGS: MyPluginSettings = { mySetting: 'default', defaultAutoplay: true, defaultLoop: true, defaultRenderer: 'canvas', enableHotkeys: true, defaultFit: 'contain', defaultAlignment: 'center' };
interface RiveRenderedInstance { restart: () => void; pause: () => void; play: () => void; toggle: () => void; isPaused: () => boolean; stopRendering?: () => void; startRendering?: () => void; element: HTMLCanvasElement; dispose: () => void; }
const activeRiveInstances: Set<RiveRenderedInstance> = new Set();
const riveBufferCache: Map<string, ArrayBuffer> = new Map();

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings; private lastInstance: RiveRenderedInstance | null = null;
	async onload() {
		await this.loadSettings();
		const ribbon = this.addRibbonIcon('dice', 'Rive Plugin', () => new Notice('Rive plugin active')); ribbon.addClass('rive-plugin-ribbon');
		const status = this.addStatusBarItem(); status.setText('Rive WIP');
		this.addCommand({ id: 'rive-test-load', name: 'Rive: Test runtime load', callback: async () => { try { const rive = await getRive(); new Notice('Rive runtime loaded'); console.log('Rive module', rive); } catch (e) { console.error(e); new Notice('Failed to load Rive runtime'); } } });
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
				const controls = container.createDiv({ cls: 'rive-controls' });
				const playBtn = controls.createEl('button', { text: 'Loading…' });
				const restartBtn = controls.createEl('button', { text: 'Restart' });
					const pathSpan = controls.createSpan({ text: cfg.src ? ` ${cfg.src}` : '' });
				playBtn.disabled = true; restartBtn.disabled = true;
				if (!cfg.src) { container.createDiv({ cls: 'rive-error', text: 'Missing src (src: path/to/file.riv)' }); return; }
				try {
						const resolvedPath = resolveRivePath(cfg.src, ctx?.sourcePath, this.app);
						if (resolvedPath !== cfg.src) {
							pathSpan.textContent = ' ' + resolvedPath; // show resolved path
						}
						const exists = await this.app.vault.adapter.exists(resolvedPath);
						if (!exists) {
							container.createDiv({ cls: 'rive-error', text: `File not found: ${resolvedPath}` });
							playBtn.textContent = 'Not found';
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
					const riveMod: any = await getRive(rendererChoice as 'canvas'|'webgl'|'webgl2');
					const RiveCtor: any = (riveMod && (riveMod.Rive || riveMod.default)) || riveMod;
					// Determine loop constant if available
					let loopConst: any = undefined;
					if (cfg.loop && riveMod.Loop) {
						// Prefer Loop.forever then Loop.loop fallback
						loopConst = riveMod.Loop.forever || riveMod.Loop.loop || Object.values(riveMod.Loop)[0];
					}
					let instance: any; let isPaused = !cfg.autoplay; let loaded = false;
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
						playBtn.disabled = false; restartBtn.disabled = false;
						playBtn.textContent = isPaused ? 'Play' : 'Pause';
						applySize();
						// Attempt artboard fallback detection (API varies across versions)
						try {
							if (typeof instance?.artboardNames === 'function') {
								const names = instance.artboardNames();
								if (names && names.length && typeof instance?.artboard === 'function') {
									// keep current default if already set; otherwise set first
									// Some versions expose instance.artboard(name)
									// Do nothing if default works.
								}
							}
						} catch {}
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
					const ctorParams: any = {
						canvas,
						buffer: arrayBuffer,
						autoplay: cfg.autoplay,
						loop: loopConst,
						layout,
						onLoad: () => { console.log('Rive loaded', cfg.src, cfg.artboard || '', cfg.renderer || ''); instance?.resizeDrawingSurfaceToCanvas?.(); finalize(); }
					};
					if (cfg.artboard) ctorParams.artboard = cfg.artboard;
					if (cfg.stateMachines && cfg.stateMachines.length) ctorParams.stateMachines = cfg.stateMachines.length === 1 ? cfg.stateMachines[0] : cfg.stateMachines;
					if (cfg.animations && cfg.animations.length) ctorParams.animations = cfg.animations.length === 1 ? cfg.animations[0] : cfg.animations;
					instance = new RiveCtor(ctorParams);

					const api: RiveRenderedInstance = {
						restart: () => {
							if (!loaded) return;
							try { if (typeof instance?.reset === 'function') instance.reset(); } catch {}
							if (typeof instance?.play === 'function') instance.play();
							isPaused = false; playBtn.textContent = 'Pause';
						},
						pause: () => { if (!loaded) return; if (typeof instance?.pause === 'function') { instance.pause(); isPaused = true; playBtn.textContent = 'Play'; } },
						play: () => { if (!loaded) return; if (typeof instance?.play === 'function') { instance.play(); isPaused = false; playBtn.textContent = 'Pause'; } },
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
					playBtn.onclick = () => { if (!loaded) return; isPaused ? api.play() : api.pause(); };
					restartBtn.onclick = () => api.restart();
					// Safety timeout: if onLoad never fires, show error.
					window.setTimeout(() => { if (!loaded) { playBtn.textContent = 'Error'; const ov = container.createDiv({ cls: 'rive-overlay-error', text: 'Load timeout' }); ov.onclick = () => ov.remove(); } }, 8000);
				} catch (e) {
					console.error('Failed to render Rive', e);
					container.createDiv({ cls: 'rive-error', text: 'Failed to load Rive file'});
					playBtn.textContent = 'Error';
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

function parseRiveBlockConfig(source: string, settings: MyPluginSettings): { src: string; autoplay: boolean; loop: boolean; artboard?: string; stateMachines?: string[]; renderer?: string; animations?: string[]; ratio?: number; width?: number; height?: number; fit?: string; alignment?: string; } {
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
		alignment: raw.alignment
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

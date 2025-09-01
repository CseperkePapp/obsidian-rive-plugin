import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { getRive } from './rive-loader';

interface MyPluginSettings { mySetting: string; defaultAutoplay: boolean; defaultLoop: boolean; }
const DEFAULT_SETTINGS: MyPluginSettings = { mySetting: 'default', defaultAutoplay: true, defaultLoop: true };
interface RiveRenderedInstance { restart: () => void; pause: () => void; play: () => void; }
const riveBufferCache: Map<string, ArrayBuffer> = new Map();

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings; private lastInstance: RiveRenderedInstance | null = null;
	async onload() {
		await this.loadSettings();
		const ribbon = this.addRibbonIcon('dice', 'Rive Plugin', () => new Notice('Rive plugin active')); ribbon.addClass('rive-plugin-ribbon');
		const status = this.addStatusBarItem(); status.setText('Rive WIP');
		this.addCommand({ id: 'rive-test-load', name: 'Rive: Test runtime load', callback: async () => { try { const rive = await getRive(); new Notice('Rive runtime loaded'); console.log('Rive module', rive); } catch (e) { console.error(e); new Notice('Failed to load Rive runtime'); } } });
		this.addCommand({ id: 'rive-restart-last', name: 'Rive: Restart last animation', callback: () => { if (this.lastInstance) { this.lastInstance.restart(); new Notice('Rive animation restarted'); } else new Notice('No Rive animation active'); } });
				this.registerMarkdownCodeBlockProcessor('rive', async (source, el, ctx) => {
				const cfg = parseRiveBlockConfig(source, this.settings);
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
					const rendererChoice = (cfg.renderer === 'webgl' || cfg.renderer === 'webgl2') ? cfg.renderer : 'canvas';
					const riveMod: any = await getRive(rendererChoice as 'canvas'|'webgl'|'webgl2');
					const RiveCtor: any = (riveMod && (riveMod.Rive || riveMod.default)) || riveMod;
					// Determine loop constant if available
					let loopConst: any = undefined;
					if (cfg.loop && riveMod.Loop) {
						// Prefer Loop.forever then Loop.loop fallback
						loopConst = riveMod.Loop.forever || riveMod.Loop.loop || Object.values(riveMod.Loop)[0];
					}
					let instance: any; let isPaused = !cfg.autoplay; let loaded = false;
					// Resize handling
					const resizeObserver = new ResizeObserver(() => {
						if (!canvas.isConnected) { resizeObserver.disconnect(); return; }
						const parentWidth = container.clientWidth;
						canvas.style.width = parentWidth + 'px';
					});
					resizeObserver.observe(container);
					const finalize = () => {
						loaded = true;
						playBtn.disabled = false; restartBtn.disabled = false;
						playBtn.textContent = isPaused ? 'Play' : 'Pause';
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
					const ctorParams: any = {
						canvas,
						buffer: arrayBuffer,
						autoplay: cfg.autoplay,
						loop: loopConst,
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
						play: () => { if (!loaded) return; if (typeof instance?.play === 'function') { instance.play(); isPaused = false; playBtn.textContent = 'Pause'; } }
					};
					this.lastInstance = api;
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

function parseRiveBlockConfig(source: string, settings: MyPluginSettings): { src: string; autoplay: boolean; loop: boolean; artboard?: string; stateMachines?: string[]; renderer?: string; animations?: string[]; } {
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
	return {
		src: raw.src || '',
		autoplay: !!raw.autoplay,
		loop: !!raw.loop,
		artboard: raw.artboard,
		renderer: raw.renderer,
		animations: anims.length ? Array.from(new Set(anims)) : undefined,
		stateMachines: stateMs.length ? Array.from(new Set(stateMs)) : undefined
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
class SampleSettingTab extends PluginSettingTab { plugin: MyPlugin; constructor(app: App, plugin: MyPlugin) { super(app, plugin); this.plugin = plugin; } display(): void { const { containerEl } = this; containerEl.empty(); new Setting(containerEl).setName('Default autoplay').setDesc('Autoplay animations when rendered').addToggle(t => t.setValue(this.plugin.settings.defaultAutoplay).onChange(async v => { this.plugin.settings.defaultAutoplay = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default loop').setDesc('Loop animations by default').addToggle(t => t.setValue(this.plugin.settings.defaultLoop).onChange(async v => { this.plugin.settings.defaultLoop = v; await this.plugin.saveSettings(); })); }}

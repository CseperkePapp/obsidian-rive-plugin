import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { getRive } from './rive-loader';

interface MyPluginSettings { mySetting: string; defaultAutoplay: boolean; defaultLoop: boolean; }
const DEFAULT_SETTINGS: MyPluginSettings = { mySetting: 'default', defaultAutoplay: true, defaultLoop: true };
interface RiveRenderedInstance { restart: () => void; pause: () => void; play: () => void; }

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings; private lastInstance: RiveRenderedInstance | null = null;
	async onload() {
		await this.loadSettings();
		const ribbon = this.addRibbonIcon('dice', 'Rive Plugin', () => new Notice('Rive plugin active')); ribbon.addClass('rive-plugin-ribbon');
		const status = this.addStatusBarItem(); status.setText('Rive WIP');
		this.addCommand({ id: 'rive-test-load', name: 'Rive: Test runtime load', callback: async () => { try { const rive = await getRive(); new Notice('Rive runtime loaded'); console.log('Rive module', rive); } catch (e) { console.error(e); new Notice('Failed to load Rive runtime'); } } });
		this.addCommand({ id: 'rive-restart-last', name: 'Rive: Restart last animation', callback: () => { if (this.lastInstance) { this.lastInstance.restart(); new Notice('Rive animation restarted'); } else new Notice('No Rive animation active'); } });
		this.registerMarkdownCodeBlockProcessor('rive', async (source, el) => { const cfg = parseRiveBlockConfig(source, this.settings); el.addClass('rive-block'); const container = el.createDiv({ cls: 'rive-block-container' }); const canvas = container.createEl('canvas', { cls: 'rive-canvas' }); const controls = container.createDiv({ cls: 'rive-controls' }); const playBtn = controls.createEl('button', { text: 'Pause' }); const restartBtn = controls.createEl('button', { text: 'Restart' }); controls.createSpan({ text: cfg.src ? ` ${cfg.src}` : '' }); if (!cfg.src) { container.createDiv({ cls: 'rive-error', text: 'Missing src (src: path/to/file.riv)' }); return; } try { const arrayBuffer = await this.app.vault.adapter.readBinary(cfg.src); const riveMod: any = await getRive(); const RiveCtor: any = (riveMod && riveMod.Rive) || riveMod.default || riveMod; let instance: any; let isPaused = false; instance = new RiveCtor({ canvas, buffer: arrayBuffer, autoplay: cfg.autoplay, loop: cfg.loop ? riveMod.Loop?.Loop : undefined, onLoad: () => { console.log('Rive loaded', cfg.src); } }); const api: RiveRenderedInstance = { restart: () => { try { instance?.reset && instance.reset(); } catch {} instance?.play && instance.play(); isPaused = false; playBtn.textContent = 'Pause'; }, pause: () => { instance?.pause && instance.pause(); isPaused = true; playBtn.textContent = 'Play'; }, play: () => { instance?.play && instance.play(); isPaused = false; playBtn.textContent = 'Pause'; } }; this.lastInstance = api; playBtn.onclick = () => { isPaused ? api.play() : api.pause(); }; restartBtn.onclick = () => api.restart(); } catch (e) { console.error('Failed to render Rive', e); container.createDiv({ cls: 'rive-error', text: 'Failed to load Rive file'}); } });
		this.addSettingTab(new SampleSettingTab(this.app, this));
		this.registerDomEvent(document, 'click', () => {});
		this.registerInterval(window.setInterval(() => console.log('Rive plugin heartbeat'), 5 * 60 * 1000));
	}
	onunload() { this.lastInstance = null; }
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }
}

function parseRiveBlockConfig(source: string, settings: MyPluginSettings): { src: string; autoplay: boolean; loop: boolean; } { const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const cfg: any = { autoplay: settings.defaultAutoplay, loop: settings.defaultLoop }; for (const line of lines) { const m = line.match(/^(\w+)\s*[:=]\s*(.+)$/); if (m) { const key = m[1]; let val: any = m[2]; if (val === 'true') val = true; else if (val === 'false') val = false; cfg[key] = val; } else if (!cfg.src && line.endsWith('.riv')) { cfg.src = line; } } return { src: cfg.src || '', autoplay: !!cfg.autoplay, loop: !!cfg.loop }; }

class SampleModal extends Modal { onOpen() { this.contentEl.setText('Woah!'); } onClose() { this.contentEl.empty(); } }
class SampleSettingTab extends PluginSettingTab { plugin: MyPlugin; constructor(app: App, plugin: MyPlugin) { super(app, plugin); this.plugin = plugin; } display(): void { const { containerEl } = this; containerEl.empty(); new Setting(containerEl).setName('Default autoplay').setDesc('Autoplay animations when rendered').addToggle(t => t.setValue(this.plugin.settings.defaultAutoplay).onChange(async v => { this.plugin.settings.defaultAutoplay = v; await this.plugin.saveSettings(); })); new Setting(containerEl).setName('Default loop').setDesc('Loop animations by default').addToggle(t => t.setValue(this.plugin.settings.defaultLoop).onChange(async v => { this.plugin.settings.defaultLoop = v; await this.plugin.saveSettings(); })); }}

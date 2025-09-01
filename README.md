# Obsidian Rive Plugin (WIP)

> Work in Progress – This plugin aims to integrate **Rive** animations into Obsidian. The codebase currently derives from the official sample plugin scaffold and is being transformed into a feature-rich animation/interaction layer for notes, dashboards, and custom panes.

## Current Feature Snapshot
| Area | Implemented |
|------|-------------|
| Fenced ```rive code block rendering | ✅ |
| Relative and vault-root path resolution | ✅ |
| Autoplay / loop defaults & per-block override | ✅ |
| Pause / Restart controls | ✅ |
| Command: Restart last animation | ✅ |
| Lazy runtime loading | ✅ |
| Runtime upgrade to @rive-app v2 (canvas/webgl/webgl2) | ✅ |
| Select artboard, stateMachine, animation | ✅ (single each) |
| Renderer selection per block (canvas / webgl / webgl2) | ✅ |
| Buffer cache (avoid re-read of same .riv) | ✅ |
| Auto-resize to container width | ✅ |
| Error handling (missing file, timeout) | ✅ (basic) |
| Auto deploy on build/watch (env or dev.local.json) | ✅ |
| Multiple animations/stateMachines | ✅ |
| Hotkeys (play/pause, restart) | ✅ |
| Frontmatter global overrides | ✅ |
| Asset loader (hosted assets) | ❌ (planned) |
| Playhead scrubber / progress bar | ❌ (planned) |
| Snapshot / export frame | ❌ (planned) |
| Performance: pause offscreen | ❌ (planned) |

## Quick Changelog (WIP)
| Version (dev) | Highlights |
|---------------|-----------|
| 0.1.0 (init) | Fork of sample plugin, basic notice & test command |
| 0.1.x +Rive | Added rive-js runtime, test load command, fenced block with pause/restart |
| 0.1.x caching | Added relative path resolution, safety guards, buffer cache |
| 0.1.x renderer | Switched to @rive-app/canvas & webgl/webgl2, artboard/stateMachine/animation & renderer selection |

## Mini Roadmap (Next Implementation Order)
1. (Done) Multiple animations / stateMachines per block (comma-separated lists)
2. (In progress) Hotkeys: global play/pause toggle & restart last animation
3. (Done) Frontmatter defaults (note-level: autoplay, loop, renderer)
4. Aspect ratio & intrinsic size detection (auto height, crisp scaling)
5. Asset loader support for hosted / referenced fonts & images
6. Playhead scrubber + progress bar (seek + current time display)
7. Snapshot / export current frame to PNG in vault
8. Performance: pause or throttle animations when pane not visible / unfocused



Planned capabilities (iterative roadmap):
- Embed a `.riv` animation inside a markdown code block or callout.
- Play / pause / scrub / loop controls via command palette.
- Trigger Rive state machine inputs from commands, hotkeys, or front‑matter.
- Optional auto-play on file open and reactive updates on metadata changes.
- Lightweight caching + lazy loading for performance.

Short-term TODO (initial milestones):
1. Add Rive Web runtime dependency + loading utility.
2. Define a fenced code block syntax (` ```rive {src: path/to/file.riv}` ).
3. Render a basic view with play / pause.
4. Expose a sample command to restart the active animation.
5. Persist simple per-animation settings (loop, autoplay).

Feel free to open issues or suggestions while this is in flux.

---

## Usage (Early Prototype)

Embed a Rive animation by adding a fenced code block in a note:

````
```rive
src: path/to/animation.riv
autoplay: true
loop: true
animations: Idle, Bounce, Spin
stateMachines: Interaction, HoverMachine
```
````

Buttons (Pause / Restart) appear under the canvas. The command palette provides:
- Rive: Test runtime load (debug)
- Rive: Restart last animation
- Rive: Toggle play/pause last animation

Settings (under plugin settings):
- Default autoplay
- Default loop

Notes:
- Paths now support relative resolution:
  - `src: ./file.riv` resolves relative to the folder of the note.
  - `src: sub/folder/file.riv` (no leading slash) also treated as relative to the note; if missing it will naturally still look like a vault path when resolved.
  - `src: /absolute/from/vaultRoot.riv` (leading slash) forces vault root.
  - Backslashes are normalized.
- Artboard / stateMachine / animation selection supported via block keys.
  - Multiple animations: `animations: Idle, Spin` (or multiple `animation:` keys)
  - Multiple state machines: `stateMachines: Main, Hover` (or multiple `stateMachine:` keys)
  - Frontmatter defaults: place under `rive:` group or prefixed keys (`riveAutoplay`, `riveLoop`, `riveRenderer`). Example:
    ```yaml
    ---
    rive:
      autoplay: false
      loop: true
      renderer: webgl2
    ---
    ```
- Basic error messages surface if the file is missing.

### Fast Deploy to Your Vault (Windows)

1. Set an environment variable once (PowerShell):
  ```powershell
  [Environment]::SetEnvironmentVariable('RIVE_VAULT','C:\\Path\\To\\YourVault',[EnvironmentVariableTarget]::User)
  ```
2. From the repo root build & deploy in one step:
  ```powershell
  npm run deploy
  ```
  (Runs a production build then copies `main.js`, `manifest.json`, `styles.css` into `$env:RIVE_VAULT/.obsidian/plugins/obsidian-rive-plugin/`.)
3. In Obsidian press `Ctrl+R` or toggle the plugin to load the update.

Alternative (one‑off path without env var):
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -VaultPath 'C:\\Path\\To\\YourVault' -Build
```

Verbose copy details:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Build -Verbose -VaultPath 'C:\\Path\\To\\YourVault'
```

If you just want to copy without rebuilding omit `-Build`.

### Automatic Deploy on Save

Set your vault path once (example):
```powershell
[Environment]::SetEnvironmentVariable('RIVE_VAULT','C:\\Users\\Cseper\\Documents\\Obsidian\\Larissa\\Larissa',[EnvironmentVariableTarget]::User)
```
Then run watch mode:
```powershell
npm run dev
```
Each rebuild copies `main.js`, `manifest.json`, `styles.css` directly into the vault plugin folder.

For a repo-local (non-env-var) setup create `dev.local.json` (not committed):
```json
{
  "vaultPath": "C:/Users/Cseper/Documents/Obsidian/Larissa/Larissa"
}
```
The build script will auto-detect this file if env vars are not set.

---

Original sample plugin README content preserved below for reference while scaffolding is retained:

---

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open Sample Modal" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint (optional)
- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code. 
- To use eslint with this project, make sure to install eslint from terminal:
  - `npm install -g eslint`
- To use eslint to analyze this project use this command:
  - `eslint main.ts`
  - eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder:
  - `eslint .\src\`

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API Documentation

See https://github.com/obsidianmd/obsidian-api

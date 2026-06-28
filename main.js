'use strict';

const { Plugin, ItemView, TFolder, PluginSettingTab, Setting, Notice, Menu, Modal } = require('obsidian');

const VIEW_TYPE = 'pin-board-view';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'ogv', 'm4v'];
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT]);

const DEFAULT_SETTINGS = {
  rootFolder: '',
  columnCount: 5,
  showCaptions: true,
  pageSize: 30,
  followFolderClicks: true,
};

class PinBoardPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new PinBoardView(leaf, this));

    this.addRibbonIcon('layout-grid', 'Open Pin Board', () => {
      this.activateView(this.settings.rootFolder || '/');
    });

    this.addCommand({
      id: 'open-pin-board',
      name: 'Open Pin Board',
      callback: () => this.activateView(this.settings.rootFolder || '/'),
    });

    // Right-click any folder in the file explorer -> "Open as Pin Board"
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('Open as Pin Board')
              .setIcon('layout-grid')
              .onClick(() => this.activateView(file.path));
          });
        }
      })
    );

    // When enabled, clicking a folder in any sidebar (the native file explorer
    // or Notebook Navigator) points the open board(s) at that folder. We resolve
    // the clicked element's path against the vault and only react when it's a
    // folder, so file clicks are left alone. Capture phase so we still see the
    // click even if the sidebar stops propagation on it.
    this.registerDomEvent(document, 'click', (evt) => this.handleFolderClick(evt), {
      capture: true,
    });

    this.addSettingTab(new PinBoardSettingTab(this.app, this));
  }

  onunload() {}

  handleFolderClick(evt) {
    if (!this.settings.followFolderClicks) return;
    const target = evt.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-path], [data-drag-path], [data-drop-path]');
    if (!el) return;
    const path =
      el.getAttribute('data-path') ||
      el.getAttribute('data-drag-path') ||
      el.getAttribute('data-drop-path');
    if (path == null) return;
    // The vault root may surface as "" or "/"; treat either as "everything".
    if (path === '' || path === '/') {
      this.setOpenBoardsFolder('/');
      return;
    }
    const af = this.app.vault.getAbstractFileByPath(path);
    if (af instanceof TFolder) this.setOpenBoardsFolder(af.path);
  }

  setOpenBoardsFolder(path) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof PinBoardView) leaf.view.setFolder(path);
    }
  }

  // Re-render every open board, e.g. after an appearance setting changes.
  refreshOpenBoards() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof PinBoardView) leaf.view.render();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView(folderPath) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
    }
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { folderPath: folderPath || '/' },
    });
    workspace.revealLeaf(leaf);
  }
}

class PinBoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.folderPath = plugin.settings.rootFolder || '/';
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return 'Pin Board';
  }

  getIcon() {
    return 'layout-grid';
  }

  async onOpen() {
    this.registerVaultEvents();
    this.setupDropZone();
    this.setupPaste();
    this.render();
  }

  async onClose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.teardownObserver();
  }

  teardownObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  getState() {
    return { folderPath: this.folderPath };
  }

  async setState(state, result) {
    if (state && typeof state.folderPath === 'string') {
      this.folderPath = state.folderPath;
    }
    this.render();
    return super.setState(state, result);
  }

  // Point this board at a folder (used by the follow-folder-clicks feature).
  setFolder(path) {
    if (this.folderPath === path) return;
    this.folderPath = path;
    this.render();
  }

  getAllFolders() {
    const out = [];
    const walk = (folder) => {
      out.push(folder);
      folder.children.forEach((child) => {
        if (child instanceof TFolder) walk(child);
      });
    };
    walk(this.app.vault.getRoot());
    return out;
  }

  getMediaFiles() {
    const prefix = this.folderPath === '/' || this.folderPath === '' ? '' : this.folderPath + '/';
    return this.app.vault
      .getFiles()
      .filter((f) => MEDIA_EXT.has(f.extension.toLowerCase()))
      .filter((f) => (prefix === '' ? true : f.path.startsWith(prefix)))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  // True if `path` falls inside the folder this board is currently showing.
  pathInFolder(path) {
    if (this.folderPath === '/' || this.folderPath === '') return true;
    return path.startsWith(this.folderPath + '/');
  }

  isMediaPath(path) {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return false;
    return MEDIA_EXT.has(path.slice(dot + 1).toLowerCase());
  }

  // The sidecar note for a pin, e.g. "Folder/photo.png.md".
  isCaptionNotePath(path) {
    if (!path.toLowerCase().endsWith('.md')) return false;
    const base = path.slice(0, -3);
    return this.isMediaPath(base) && this.pathInFolder(base);
  }

  // Watch the vault so the board updates the instant a file is added,
  // removed, or renamed in the folder it's showing — no manual refresh.
  // registerEvent ties these listeners to the view's lifecycle, so they're
  // cleaned up automatically when the board is closed.
  registerVaultEvents() {
    const onMediaChange = (file, oldPath) => {
      const newPath = file && file.path;
      const hit =
        (newPath && this.isMediaPath(newPath) && this.pathInFolder(newPath)) ||
        (oldPath && this.isMediaPath(oldPath) && this.pathInFolder(oldPath));
      if (hit) this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on('create', (f) => onMediaChange(f)));
    this.registerEvent(this.app.vault.on('delete', (f) => onMediaChange(f)));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => onMediaChange(f, oldPath)));

    // Live-update a pin's caption when its sidecar note changes.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.plugin.settings.showCaptions && file && this.isCaptionNotePath(file.path)) {
          this.scheduleRefresh();
        }
      })
    );
  }

  // Debounce so dropping a batch of files triggers a single rebuild, not one
  // per file. keepView preserves scroll depth so the board doesn't jump.
  scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.files) this.render({ keepView: true });
    }, 200);
  }

  // Let users drop image/video files straight onto the board from outside
  // Obsidian (Windows Explorer, a browser, etc.). Files are written into the
  // folder the board is currently showing; the vault 'create' events then
  // refresh the board on their own. Listeners live on contentEl, which
  // survives re-renders, so this is set up once in onOpen.
  setupDropZone() {
    const el = this.contentEl;
    const isFileDrag = (e) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    this.registerDomEvent(el, 'dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      el.addClass('pin-board-dragover');
    });
    this.registerDomEvent(el, 'dragleave', (e) => {
      if (e.target === el) el.removeClass('pin-board-dragover');
    });
    this.registerDomEvent(el, 'drop', async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.removeClass('pin-board-dragover');
      await this.importDroppedFiles(e.dataTransfer.files);
    });
  }

  async importDroppedFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const targetDir = this.folderPath === '/' || this.folderPath === '' ? '' : this.folderPath;
    const media = files.filter((f) => this.isMediaPath(f.name));

    let added = 0;
    for (const file of media) {
      try {
        const buf = await file.arrayBuffer();
        const path = await this.uniquePath(targetDir, file.name);
        await this.app.vault.createBinary(path, buf);
        added++;
      } catch (err) {
        console.error('Pin Board: failed to import', file.name, err);
      }
    }

    if (added) new Notice(`Pin Board: added ${added} pin${added === 1 ? '' : 's'}.`);
    const skipped = files.length - media.length;
    if (skipped) {
      new Notice(`Pin Board: skipped ${skipped} non-image/video file${skipped === 1 ? '' : 's'}.`);
    }
  }

  // Build a vault path inside `dir` for `name`, adding " 1", " 2", ... if a
  // file is already there, so a drop never overwrites an existing pin.
  async uniquePath(dir, name) {
    const base = dir ? dir + '/' : '';
    if (!this.app.vault.getAbstractFileByPath(base + name)) return base + name;

    const dot = name.lastIndexOf('.');
    const stem = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? '' : name.slice(dot);
    let n = 1;
    let candidate;
    do {
      candidate = `${base}${stem} ${n}${ext}`;
      n++;
    } while (this.app.vault.getAbstractFileByPath(candidate));
    return candidate;
  }

  // Paste an image from the clipboard (e.g. copied from a website) onto the
  // board. Works whenever a board is open and you're not typing into a text
  // field, so you can copy from a browser, click around, then Ctrl+V.
  setupPaste() {
    this.registerDomEvent(document, 'paste', (e) => {
      // Let pastes into the note editor or any text field behave normally.
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        return;
      }
      // Target the active board, or — if the sidebar is focused instead — the
      // first open board. Only that one instance handles the paste.
      let target = this.app.workspace.getActiveViewOfType(PinBoardView);
      if (!target) {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (leaves.length) target = leaves[0].view;
      }
      if (target !== this) return;

      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const images = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) images.push(f);
        }
      }
      if (images.length === 0) return;
      e.preventDefault();
      this.importPastedImages(images);
    });
  }

  async importPastedImages(images) {
    const targetDir = this.folderPath === '/' || this.folderPath === '' ? '' : this.folderPath;
    let added = 0;
    for (const file of images) {
      try {
        const buf = await file.arrayBuffer();
        const ext = this.extFromMime(file.type) || 'png';
        const path = await this.uniquePath(targetDir, `Pasted image ${this.timestamp()}.${ext}`);
        await this.app.vault.createBinary(path, buf);
        added++;
      } catch (err) {
        console.error('Pin Board: failed to paste image', err);
      }
    }
    if (added) new Notice(`Pin Board: pasted ${added} image${added === 1 ? '' : 's'}.`);
  }

  extFromMime(mime) {
    const map = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
    };
    return map[mime] || '';
  }

  timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // Right-click menu on a pin: open its note or delete it.
  showPinMenu(event, file) {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle('Open note').setIcon('pencil').onClick(() => this.openNote(file))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle('Delete pin').setIcon('trash').onClick(() => this.deletePin(file))
    );
    menu.showAtMouseEvent(event);
  }

  // Move the pin to trash (recoverable, per the user's deletion setting) and
  // take its caption note with it. The vault 'delete' event refreshes the board.
  deletePin(file) {
    const message =
      `Delete "${file.name}"? It will be moved to trash (recoverable), ` +
      'along with its caption note if it has one.';
    new ConfirmModal(this.app, 'Delete pin', message, 'Delete', async () => {
      const note = this.app.vault.getAbstractFileByPath(file.path + '.md');
      try {
        await this.app.fileManager.trashFile(file);
        if (note) await this.app.fileManager.trashFile(note);
      } catch (err) {
        console.error('Pin Board: failed to delete', file.name, err);
        new Notice('Pin Board: could not delete that pin.');
      }
    }).open();
  }

  getCaption(file) {
    const note = this.app.vault.getAbstractFileByPath(file.path + '.md');
    if (!note) return '';
    const cache = this.app.metadataCache.getFileCache(note);
    if (cache && cache.frontmatter && cache.frontmatter.caption) {
      return String(cache.frontmatter.caption);
    }
    return '';
  }

  async openNote(file) {
    const notePath = file.path + '.md';
    let note = this.app.vault.getAbstractFileByPath(notePath);
    if (!note) {
      note = await this.app.vault.create(
        notePath,
        `---\ncaption: "${file.basename}"\n---\n\n![[${file.path}]]\n\n`
      );
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(note);
  }

  // Full-size viewer that walks the whole board: arrow keys (or the on-screen
  // arrows) flip between pins, with the caption and an "X of Y" counter shown.
  openLightbox(index) {
    const overlay = this.contentEl.createDiv({ cls: 'pin-board-lightbox' });
    const stage = overlay.createDiv({ cls: 'pin-board-lightbox-stage' });
    const counter = overlay.createDiv({ cls: 'pin-board-lightbox-counter' });
    const caption = overlay.createDiv({ cls: 'pin-board-lightbox-caption' });
    const prevBtn = overlay.createEl('button', {
      cls: 'pin-board-lightbox-nav pin-board-lightbox-prev',
      text: '‹',
    });
    const nextBtn = overlay.createEl('button', {
      cls: 'pin-board-lightbox-nav pin-board-lightbox-next',
      text: '›',
    });

    let i = index;

    const show = () => {
      stage.empty();
      const file = this.files[i];
      const ext = file.extension.toLowerCase();
      const src = this.app.vault.getResourcePath(file);
      if (VIDEO_EXT.includes(ext)) {
        const v = stage.createEl('video');
        v.src = src;
        v.controls = true;
        v.autoplay = true;
      } else {
        const img = stage.createEl('img');
        img.src = src;
      }
      const cap = this.getCaption(file);
      caption.setText(cap || '');
      caption.toggleClass('is-hidden', !cap);
      counter.setText(`${i + 1} of ${this.files.length}`);
    };

    const go = (delta) => {
      const n = this.files.length;
      i = (i + delta + n) % n;
      show();
    };

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };

    // A single pin has nothing to flip through.
    if (this.files.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      counter.style.display = 'none';
    }

    overlay.addEventListener('click', close);
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      go(-1);
    });
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      go(1);
    });
    document.addEventListener('keydown', onKey);

    show();
  }

  renderPin(grid, file, index) {
    const pin = grid.createDiv({ cls: 'pin-board-pin' });
    pin.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showPinMenu(e, file);
    });
    const ext = file.extension.toLowerCase();
    const src = this.app.vault.getResourcePath(file);

    if (VIDEO_EXT.includes(ext)) {
      const v = pin.createEl('video', { cls: 'pin-board-media' });
      v.src = src;
      v.controls = true;
      v.muted = true;
      v.loop = true;
      v.preload = 'metadata';
    } else {
      const img = pin.createEl('img', { cls: 'pin-board-media' });
      img.src = src;
      img.loading = 'lazy';
      img.addEventListener('click', () => this.openLightbox(index));
    }

    const bar = pin.createDiv({ cls: 'pin-board-pin-bar' });
    const noteBtn = bar.createEl('button', { cls: 'pin-board-btn', text: '✎ Note' });
    noteBtn.setAttribute('aria-label', 'Add or edit this pin\u2019s note');
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openNote(file);
    });

    if (this.plugin.settings.showCaptions) {
      const caption = this.getCaption(file);
      if (caption) pin.createDiv({ cls: 'pin-board-caption', text: caption });
    }
  }

  render(opts = {}) {
    // On an auto-refresh, remember where the user was so the rebuild lands
    // them back in the same place instead of scrolling to the top.
    const keepView = !!opts.keepView;
    const prevScroll = keepView ? this.contentEl.scrollTop : 0;
    const targetShown = keepView ? this.shownCount || 0 : 0;

    this.teardownObserver();

    const container = this.contentEl;
    container.empty();
    container.addClass('pin-board-container');

    const header = container.createDiv({ cls: 'pin-board-header' });
    const select = header.createEl('select', { cls: 'dropdown pin-board-folder-select' });
    for (const folder of this.getAllFolders()) {
      const path = folder.path;
      const opt = select.createEl('option', {
        value: path,
        text: path === '/' ? 'Entire vault' : path,
      });
      if (path === (this.folderPath || '/')) opt.selected = true;
    }
    select.addEventListener('change', () => {
      this.folderPath = select.value;
      this.render();
    });

    // One-click jump to the combined "every pin in every folder" view.
    const allBtn = header.createEl('button', { cls: 'pin-board-all', text: 'All pins' });
    allBtn.setAttribute('aria-label', 'Show every pin from all folders together');
    allBtn.addEventListener('click', () => this.setFolder('/'));

    this.files = this.getMediaFiles();
    this.shownCount = 0;
    this.countEl = header.createDiv({ cls: 'pin-board-count' });

    const grid = container.createDiv({ cls: 'pin-board-grid' });
    grid.style.setProperty('column-count', String(this.plugin.settings.columnCount));

    if (this.files.length === 0) {
      this.countEl.setText('0 pins');
      grid.createDiv({
        cls: 'pin-board-empty',
        text: 'No images or videos here yet. Drop some into this folder and they\u2019ll show up.',
      });
      return;
    }

    // Footer holds the "Load more" button and the auto-load sentinel.
    const footer = container.createDiv({ cls: 'pin-board-footer' });
    this.loadMoreBtn = footer.createEl('button', { cls: 'pin-board-loadmore', text: 'Load more' });
    this.loadMoreBtn.addEventListener('click', () => this.renderNextPage(grid));
    this.sentinel = footer.createDiv({ cls: 'pin-board-sentinel' });

    // Auto-load the next batch when the sentinel scrolls into view.
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.renderNextPage(grid);
        }
      },
      { root: container, rootMargin: '300px' }
    );
    this.observer.observe(this.sentinel);

    // Render the first batch — or enough batches to restore how far the user
    // had scrolled before an auto-refresh.
    do {
      this.renderNextPage(grid);
    } while (this.shownCount < targetShown && this.shownCount < this.files.length);

    if (keepView && prevScroll) {
      requestAnimationFrame(() => {
        container.scrollTop = prevScroll;
      });
    }
  }

  renderNextPage(grid) {
    if (!this.files) return;
    const pageSize = this.plugin.settings.pageSize;
    const end = Math.min(this.shownCount + pageSize, this.files.length);
    for (let i = this.shownCount; i < end; i++) {
      this.renderPin(grid, this.files[i], i);
    }
    this.shownCount = end;

    if (this.countEl) {
      this.countEl.setText(
        this.shownCount >= this.files.length
          ? this.files.length + ' pins'
          : 'Showing ' + this.shownCount + ' of ' + this.files.length
      );
    }

    const done = this.shownCount >= this.files.length;
    if (done) {
      this.teardownObserver();
      if (this.loadMoreBtn) this.loadMoreBtn.remove();
      if (this.sentinel) this.sentinel.remove();
    } else if (this.loadMoreBtn) {
      this.loadMoreBtn.setText('Load more (' + (this.files.length - this.shownCount) + ' left)');
    }
  }
}

class PinBoardSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Default board folder')
      .setDesc('Folder opened by the ribbon icon and command. Leave blank for the entire vault.')
      .addText((t) =>
        t
          .setPlaceholder('e.g. Moodboards/Witchy')
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (v) => {
            this.plugin.settings.rootFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Columns across')
      .setDesc('How many columns the masonry shows. More columns = smaller pictures.')
      .addSlider((s) =>
        s
          .setLimits(1, 12, 1)
          .setValue(this.plugin.settings.columnCount)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.columnCount = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenBoards();
          })
      );

    new Setting(containerEl)
      .setName('Show captions')
      .setDesc('Show each pin\u2019s caption (the "caption" field from its note) under the image.')
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showCaptions).onChange(async (v) => {
          this.plugin.settings.showCaptions = v;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenBoards();
        })
      );

    new Setting(containerEl)
      .setName('Pins per batch')
      .setDesc('How many pins to load at a time as you scroll. Lower this if large boards feel heavy.')
      .addSlider((s) =>
        s
          .setLimits(10, 100, 10)
          .setValue(this.plugin.settings.pageSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.pageSize = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Follow folder clicks')
      .setDesc(
        'When on, clicking a folder in the file explorer or Notebook Navigator ' +
          'switches the open board to that folder. Turn off to only use the dropdown.'
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.followFolderClicks).onChange(async (v) => {
          this.plugin.settings.followFolderClicks = v;
          await this.plugin.saveSettings();
        })
      );
  }
}

// A small yes/no confirmation dialog used before deleting a pin.
class ConfirmModal extends Modal {
  constructor(app, title, message, confirmText, onConfirm) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl('p', { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: 'pin-board-modal-buttons' });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const confirmBtn = buttons.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    confirmBtn.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = PinBoardPlugin;

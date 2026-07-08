# Pin Board

A Pinterest-style board for Obsidian. Point it at a folder and it shows every
image and short video inside it as a vertical, scrollable masonry feed — no
spreading things out across a canvas. Optionally attach a note to any pin.

## Install (manual, no build step needed)

_Requires Obsidian 1.4.0 or newer._

1. In your vault, open the folder `.obsidian/plugins/` (create `plugins` if it
   isn't there). On your computer this is inside your vault folder; the
   `.obsidian` folder is hidden, so enable "show hidden files".
2. Make a new folder there called `pin-board`.
3. Copy these three files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. In Obsidian: Settings → Community plugins → turn on **Pin Board**.
   (You may need to toggle "Restricted mode" off first.)

## First time? Start here

1. Open the board: click the grid icon in the left ribbon (or run the **Open
   Pin Board** command).
2. **Pin the tab** so it can't get replaced: right-click the **Pin Board** tab
   at the top → **Pin**.
3. Point it at your pictures: pick a folder from the dropdown at the top-left,
   or just drag some images straight onto the board.

That's it — your masonry board is live. Everything below is extra detail.

## Use

- **Keep the board's tab pinned** so the whole board stays visible: right-click
  the **Pin Board** tab at the top → **Pin**. If it isn't pinned, clicking a
  picture replaces the board with that single image — pinning prevents that.
- Click the grid icon in the left ribbon, or run the command **Open Pin Board**.
- Switch which folder you're viewing with the dropdown at the top.
- Or just click a folder in the file explorer (or Notebook Navigator) and the
  open board switches to it automatically. Turn this off with "Follow folder
  clicks" in settings if you'd rather only use the dropdown.
- Click **All pins** in the board header (or pick "Entire vault" in the dropdown)
  to see every pin from every folder together in one masonry view.
- Drag image or video files from outside Obsidian (Windows Explorer, a browser)
  straight onto the board to add them to the folder you're viewing.
- Or right-click any folder in the file explorer → **Open as Pin Board**.
- Paste an image from your clipboard (Ctrl+V) with a board open to drop it
  straight into the folder you're viewing.
- Click an image to open it full-size. Use **← / →** (or the on-screen arrows)
  to flip through the whole board; **Esc** or click to close.
- Right-click any pin for **Open note**, **Move to another board…**, or **Delete
  pin**. Move copies the pin (and its caption note) into another folder you pick,
  then asks whether to keep a copy in the old board too or remove it. Delete
  moves the file (and its caption note) to trash, so it's recoverable.
- Hover a pin and click **✎ Note** to create/open a note for that pin. The note
  has a `caption:` field — whatever you put there shows under the pin.

## Notes

- A "board" is just a folder. Subfolders are included, so a topic folder with
  sub-topics shows everything together. Newest files appear first.
- Supported files: images (png, jpg, jpeg, gif, webp, svg, bmp, avif) and videos
  (mp4, webm, mov, m4v, ogv). Other file types in the folder are ignored.
- The board updates itself. Drop an image into the folder (or remove/rename one)
  while the board is open and the pin appears, disappears, or updates on its own
  — no manual refresh needed. Editing a pin's caption note updates the caption
  live too.
- Big boards load in small batches: only a handful of pins render at first, and
  more load as you scroll (or via the "Load more" button). Nothing renders the
  whole folder at once, so large boards stay light on memory. Adjust the batch
  size in settings ("Pins per batch") if you want it even lighter.
- Captions are stored in a sidecar note named `<image>.md` next to each file,
  so they're real, searchable Obsidian notes — nothing locked inside the plugin.
- Settings let you change the default folder, how many columns the masonry
  shows, caption display, batch size, and whether the board follows folder
  clicks.

## Troubleshooting

- **Only one picture shows, or the board "disappeared."** The tab wasn't pinned,
  so clicking a picture replaced the board with that single image. Reopen it
  (ribbon icon or **Open Pin Board**) and pin the tab (right-click it → **Pin**).
- **It's showing pictures from other folders.** The board is set to "All pins" /
  "Entire vault." Pick the folder you want from the dropdown at the top-left.
- **A picture I added isn't showing up.** Make sure it landed in the folder the
  board is currently set to (check the dropdown). The board updates on its own
  once the file is in the right folder.
- **Pictures are too big or too small.** Change **Columns across** in settings —
  fewer columns = bigger pictures, more columns = smaller. The masonry also fills
  out as you add more pictures, so a board with only a few will look sparse.
- **Notes/captions are showing on the board and I don't want them.** Turn off
  **Show captions** in settings. Your notes still exist; they just won't display
  under the pins.
- **I can't paste a video from a website.** Browsers can't copy video the way they
  copy images, so this isn't possible — see **Adding videos** above for how to add
  a video instead.

## Why this won't rot

It's plain JavaScript using only Obsidian's stable public API — no TypeScript,
no esbuild, no external dependencies. If something ever breaks, the whole plugin
is one short readable file you (or a helper) can patch in minutes.

## Support

If you enjoy Pin Board, you can support its development here:

[☕ Buy Me a Coffee](https://buymeacoffee.com/Rayvven)

## License

MIT — see the `LICENSE` file. You're free to use, modify, and share it.

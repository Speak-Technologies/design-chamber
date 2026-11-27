# Design system brand files

Fonts, logos and source documents (a brand guide, written notes) that belong to a design system. They
live in the system's own folder under the Designs folder: `_systems/<id>/assets/fonts/`,
`_systems/<id>/assets/logos/` and `_systems/<id>/sources/`. The New design system sheet and the
system page add them (the screens are built separately; this page describes the rules the local
service enforces).

## Two ways in
- **Pick or drop files.** The panel reads each file and sends it to the service in pieces of base64
  text (one request can't carry more than 64 000 characters). The service decodes each piece as it
  arrives and keeps only the bytes, so a 21 MB file never takes more than 21 MB of memory. At most
  two files upload at once; a third waits ("Another file is still uploading. Wait for it to
  finish."). If a piece is refused or fails to send, the panel tells the service to drop that
  upload at once (`DELETE /uploads/:id`), and the service drops a file whose piece isn't base64 or
  runs past its announced size by itself, so a failed upload never blocks the next one. An upload
  nobody finishes still expires after 10 minutes. Files are sent one at a time after the system is
  made, so nothing is written before **Make design system**.
- **Add from a folder.** The user names a folder; the service reads the files directly in it (not
  in subfolders). It must be a full path, not a whole drive, and not the Designs folder or any folder
  inside it (checked after following links, so a link into the Designs folder is refused too). Links
  and hidden files in the folder are skipped. At most 200 files are looked at. A file that turns
  into something else between the listing and the read (a sync tool swapping it for a folder) is
  refused by name ("logo.svg isn't a plain file, so it wasn't added."), never left out silently. The
  folder itself is only read, never changed.

## What is accepted
| Kind | File types | Largest file |
|---|---|---|
| Font | `.woff2 .woff .ttf .otf` | 5 MB |
| Logo (picture) | `.svg .png .jpg .jpeg .webp` | 10 MB |
| Source | `.pdf .md .txt`, or any picture or font above | 20 MB for documents, the picture or font limit otherwise |

- The file's **contents** must match its ending: font and picture files start with their format's
  signature, an SVG is text whose first element is `<svg`, Markdown and text are valid UTF-8 with no
  NUL. A renamed file is refused ("logo.png isn't a real PNG file.", "This font file can't be used.").
- Any other type is refused by its name and never opened ("brand.key isn't a file type design systems
  use."), so key files and `.env` files in a brand folder stay unread.
- A system holds at most 400 files and 100 MB across `assets/` and `sources/`.
- Each refused file is named with its reason; the others are still added.

## Names
The user's file name is only a suggestion. Folders and drive letters are dropped, odd characters
become `-`, the ending is lower-cased, and the name is at most 80 characters. A Windows device name
(`CON`, `NUL`, `COM1`…) gets `-file` added. A name already used in that folder, ignoring case, gets
`-2`, `-3`… A file already there is never replaced, even if one appears while the service writes.
The answer names the final file.

## What gets recorded
- `system.json` gets an entry per file: fonts with a family, weight and style guessed from the name
  (`Inter-SemiBoldItalic.woff2` → Inter, 600, italic), logos with a variant (`mark`, `icon`, `dark`,
  `light`, `white`, `mono` from the name, else `primary`), sources with the file. Every other key in
  the file is kept. The write only lands if nobody changed `system.json` since it was read (tried
  three times). If it is broken or keeps changing, the file stays and the answer is "Couldn't record
  acme.svg in system.json. Ask the agent to add it."
- `.chamber/state.json` lists the file under the brand source.
- The change counts as the user's own: the system gets a new revision at once and the panel refreshes.

## Not yet
A design system kept in a project repo will refuse brand files (the agent adds them in the repo);
until that part is built such a system answers "not built yet" and nothing is written.

## Where it lives
`src/service/uploads.ts` (base64 uploads), `src/service/systems/assets.ts` (checks, names, writes,
system.json), `src/service/systems/scan-folder.ts` (the folder rules), `src/service/routes/system-assets.ts`.
Tests: `test/service/core/uploads-binary.test.ts`, `test/service/systems/assets.test.ts`,
`test/service/systems/assets-routes.test.ts`.

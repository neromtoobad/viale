# Viale logo

Direction B, "Seal": the verified rosette the shops wear on their signs, with a V in it.
Colours: navy #1E2B4A, cream #F6F1E7, brass #C9A14A, sky #7FAEE3 (awning stripe accent).

- `final/` holds the finished files: mark, mark on dark, favicon (no ring, larger V), wordmark, lockups, app icon, PNG icons and the 1200×630 share image.
- `build.mjs` draws everything from code. The V and the wordmark are glyphs from **Fraunces 600** (SIL Open Font License, by Undercase Type) converted to outlines, so the SVGs need no font.
- `gen.mjs` + `directions.png` are the three directions we compared (A Awning V, B Seal, C Lamp); B was picked.

Rebuild: `FRAUNCES_TTF=/path/Fraunces-600.ttf NODE_PATH=<dir containing opentype.js> node build.mjs`

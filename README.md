# Swifter

A portrait-first falling-column match-3 puzzle prototype inspired by the 1991 VTech handheld **Swifter** and classic *Columns*-style gameplay.

## Gameplay

- A vertical stack of three gems falls into a 6×13 well.
- Move the stack left/right and cycle the three gems.
- Match 3+ gems horizontally, vertically, or diagonally.
- Matches disappear, gravity resolves the board, and cascades earn chain bonuses.
- Speed increases as the level rises.

### Controls

**Touch**
- Swipe left/right: move
- Tap falling stack / board: cycle gem order
- Swipe down: hard drop
- On-screen buttons are also available

**Keyboard**
- Left / Right: move
- Up, X, or Z: cycle
- Down: soft drop
- Space: hard drop
- P: pause

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## GitHub Pages

The repository includes `.github/workflows/pages.yml`, mirroring the Tactics deployment approach: every push to `main` builds with Vite and deploys the `build/` directory to GitHub Pages.

The Vite base is `/Swifter/`, so the expected Pages URL is:

`https://sjfranks.github.io/Swifter/`

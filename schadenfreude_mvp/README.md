# Schadenfreude.io MVP — Believability Test Harness

This is a **bot-first** playable MVP designed to test whether "trolling opponents" can feel social and human even when the server population is mostly bots.

## How to run
- Open `index.html` in a modern browser (Chrome/Edge/Firefox).
- No server is required (it is a single-file local simulation).

> If your browser blocks some features when opening local files, you can serve the folder with a tiny local server:
> - Python: `python -m http.server 8000`
> - Then open: `http://localhost:8000/index.html`

## Controls
- **WASD / Arrow keys**: move
- **Space**: dash
- **Q**: place banana peel
- **E**: throw decoy (aim with mouse)
- **C**: cycle camera mode (Player → Leader → Free)
- In **Free camera**:
  - **IJKL** pan
  - **- / =** zoom
- **F2**: toggle debug overlay (shows bot goals + paths + beliefs)
- **F3**: toggle BOT markers (useful in dev; keep hidden for projection tests)
- **G**: download JSON event log

## Game rules (MVP)
- Collect Salt orbs → increases **Held Salt**
- Deposit at the **Bank** (center circle) → converts Held Salt into **Banked Salt** (score)
- Step on opponent's **Peel** → you slip and drop part of Held Salt
- Pick up a **Decoy** → you drop some Held Salt, get slowed briefly, and lose composure
- When **Composure** hits 0 → you **Tilt**: short stun + bonus drop + brief comeback buff

## Believability tests to run

### Test A — Projection test (recommended)
**Setup:** 19 bots, hide BOT identity (default), play for a full season (10 minutes).  
**Question afterward:** *How many opponents felt human?*

**Pass (early goal):** testers are uncertain and estimate > 0 humans even in bot-only.

### Test B — Spectator realism
**Setup:** start in spectator mode, 20 bots.  
**Watch for:**
- bait / lead-through-corner moments
- revenge chases (same bot re-engages the same target after being pranked)
- stress mistakes (a bot occasionally falls for a decoy or wastes dash)

### Test C — Discrimination (manual, optional)
Record 30 short clips (or observe) and see if people can reliably say "bot vs human".

## Notes
- This build is intentionally **mechanics-light** and **AI-heavy**:
  - positional traps (peels) + greed bait (decoys) + bank vulnerability
- Networking is not included yet; the purpose is to validate the *bot believability premise* before building a real server.


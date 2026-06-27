# Cookie MinMax

A native-feeling [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) mod for min/max
automation. Single hosted file, loaded via `Game.LoadMod`. Inspired by FrozenCookies + ACABM
(both MIT; this is a clean-room reimplementation — no copied code).

Settings live in the game's own **Options** menu, in a "Cookie MinMax" section at the bottom.

## Features (v0.9.0)

All modules default **off**; flip them on in Options. One `logic`-hook scheduler drives everything
(no `setInterval`, no simulated DOM clicks). Modules whose prerequisites aren't unlocked in your
save are greyed out and can't be enabled.

| Module | What it does |
| --- | --- |
| **Auto-Click** | Auto-clicks the big cookie at a target rate (3-digit field × none/K/M/B). Defeats the native ~50/sec throttle and still registers clicks, the clicking stat, and click achievements. |
| **Auto-Buy (payback)** | Buys by lowest payback period. Marginal CpS is measured by toggling each item on, recomputing `Game.cookiesPs`, and reverting — so multiplier and multi-building upgrades are valued correctly. Granular toggles: buildings, upgrades, Frenzy-aware Lucky! bank protection, fast (drain all affordable each tick) vs patient (save for the single best), an adjustable speed (evaluations/sec), and a building bulk size (1×/10×/100×) that both the payback evaluation and the purchase respect. Shows a live readout of the next target and an ETA until it's affordable. |
| **Auto Golden Cookies** | Pops golden shimmers (skip wrath optional) and reindeer. |
| **Auto Wrinklers** | Pops wrinklers, keeping shiny ones and a configurable count. |
| **Auto Sugar Lump** | Harvests the sugar lump as soon as it's ripe. *(requires sugar lumps unlocked)* |
| **Auto Fortune** | Clicks news-ticker fortunes (triggers the game's own handler). |
| **Auto Pet Dragon** | Pets Krumblor while the dragon panel is open. *(requires the "Pet the dragon" heavenly upgrade)* |
| **Auto Grimoire** | Casts a chosen spell whenever magic is full. Defaults to Conjure Baked Goods (free cookies, no backfire); other spells selectable for those who know the risks. *(requires Wizard Tower Lvl 1)* |
| **Auto Garden** | Harvests mature plants (native `harvestAll`), leaving immortals and still-growing tiles — prevents decay-death losses. Leave it off while deliberately cross-breeding. *(requires Farm Lvl 1)* |
| **Auto Lucky Upgrades** | Grabs the three "Lucky" heavenly upgrades (*Lucky digit / number / payout*) — which unlock when your prestige level's digits contain ≥1 / ≥2 / ≥4 sevens — the moment you're eligible and can afford the heavenly chips. No ascension or reset required (the buy works in normal play; the mod just enforces the 7-count so it only takes what's legitimately available). One-shot: disarms after a grab. |
| **Ascend Now** *(manual)* | A button at the bottom of the section that triggers the game's own ascension screen, showing projected prestige gain. Never fires automatically — you confirm the reset in-game. |

### Roadmap

- Minigames: Stock Market, Pantheon

## Install

Cookie Clicker must be loaded, then run **one** of these:

**Bookmarklet** — make a bookmark with this as the URL, click it while playing:

```
javascript:(function(){Game.LoadMod('https://cdn.jsdelivr.net/gh/price-gaines/cookie-minmax@main/src/minmax.js')})();
```

**Console** — paste into the browser devtools console (F12):

```js
Game.LoadMod('https://cdn.jsdelivr.net/gh/price-gaines/cookie-minmax@main/src/minmax.js');
```

Then open **Options** — the "Cookie MinMax" section is at the bottom. Settings persist in your
save (the mod stores them via the game's own save string).

> jsDelivr caches `@main` for up to 24h. For a specific build use a commit hash, e.g.
> `@b402e97/src/minmax.js`.

## Architecture

Add-only: the mod registers hooks and wraps `Game.UpdateMenu` with passthrough. It never replaces
native game logic. See [`docs/superpowers/specs/2026-06-25-cookie-clicker-mod-design.md`](docs/superpowers/specs/2026-06-25-cookie-clicker-mod-design.md)
for the design and verified runtime facts, and [`CLAUDE.md`](CLAUDE.md) for the hard rules.

A console self-check is available: `MinMax._test()`.

## License

MIT

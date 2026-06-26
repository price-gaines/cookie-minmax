// Cookie MinMax — native min/max automation mod for Cookie Clicker.
// Load via: Game.LoadMod("<hosted-url>/minmax.js")
// Design + verified runtime facts: docs/superpowers/specs/2026-06-25-cookie-clicker-mod-design.md
//
// Hard rule: ADD-ONLY. We register hooks, wrap Game.UpdateMenu with passthrough, and call
// public Game APIs. We never replace native game *logic* (that is what killed FrozenCookies).

(function () {
	'use strict';

	var VERSION = '0.2.0';
	var MOD_ID = 'minmax';

	// ---- settings (persisted via mod save/load) -----------------------------
	// Defaults. load() deep-merges the saved object over these.
	var settings = {
		master: true,
		click:    { on: false, value: 1, unit: 'none' },   // value 1-999 * unit
		// autobuy: patient=false drains every affordable item in payback order each tick
		// (fast); patient=true saves up for the single best-payback item (FrozenCookies style).
		autobuy:  { on: false, protect: true, buildings: true, upgrades: true, patient: false, maxBuys: 200 },
		golden:   { on: false, popWrath: false, popReindeer: true },
		wrink:    { on: false, keepShiny: true, keepCount: 0 },
		lump:     { on: false },
		fortune:  { on: false },
		dragon:   { on: false },
	};

	var UNIT = { none: 1, K: 1e3, M: 1e6, B: 1e9 };

	function targetCps() {
		var v = Math.max(0, Math.min(999, parseInt(settings.click.value) || 0));
		return v * (UNIT[settings.click.unit] || 1);
	}

	// ---- modules -------------------------------------------------------------
	// Each: {id, label, interval (logic frames between ticks), tick(), menu()}.
	// Game.fps is 30, so interval 30 ~= once/sec, 150 ~= once/5s.

	var clickAcc = 0; // fractional-click accumulator for sub-fps target rates

	var modules = [
		{
			id: 'click', label: 'Auto-Click', interval: 1,
			tick: function () {
				var target = targetCps();
				if (target <= 0) return;
				clickAcc += target / Game.fps;
				var n = Math.floor(clickAcc);
				if (n < 1) return;
				clickAcc -= n;
				// One REAL click: bypass the ~50/sec throttle (lastClick guard) so it
				// registers, and fire the click mod-hook + a single particle/sound.
				Game.lastClick = 0;
				Game.ClickCookie();
				// Bulk the remainder: registers count + clicking stat + click achievements
				// without per-click visual/sound. (Earn alone would miss the two counters.)
				if (n > 1) {
					var cpc = Game.computedMouseCps, r = n - 1;
					Game.Earn(cpc * r);
					Game.handmadeCookies += cpc * r;
					Game.cookieClicks += r;
				}
			},
			menu: function () {
				return row('click',
					'Click rate: ' +
					numField('click.value', settings.click.value) +
					unitSelect('click.unit', settings.click.unit) +
					' = ' + Beautify(targetCps()) + '/sec target');
			},
		},

		{
			id: 'golden', label: 'Auto Golden Cookies', interval: 3,
			tick: function () {
				for (var i = Game.shimmers.length - 1; i >= 0; i--) {
					var s = Game.shimmers[i];
					if (!s) continue;
					if (s.type === 'golden' && s.wrath && !settings.golden.popWrath) continue;
					if (s.type === 'reindeer' && !settings.golden.popReindeer) continue;
					s.pop();
				}
			},
			menu: function () {
				return row('golden', 'Pop golden cookies' +
					check('golden.popWrath', settings.golden.popWrath, 'incl. wrath') +
					check('golden.popReindeer', settings.golden.popReindeer, 'incl. reindeer'));
			},
		},

		{
			id: 'wrink', label: 'Auto Wrinklers', interval: 150,
			tick: function () {
				var list = [];
				for (var i in Game.wrinklers) {
					var w = Game.wrinklers[i];
					if (w && w.phase > 0 && w.hp > 0) list.push(w);
				}
				if (settings.wrink.keepShiny) list = list.filter(function (w) { return w.type !== 1; });
				var keep = Math.max(0, parseInt(settings.wrink.keepCount) || 0);
				for (var j = 0; j < list.length - keep; j++) list[j].hp = -10; // game collects on next update
			},
			menu: function () {
				return row('wrink', 'Pop wrinklers' +
					check('wrink.keepShiny', settings.wrink.keepShiny, 'keep shiny') +
					' keep ' + numField('wrink.keepCount', settings.wrink.keepCount, 2));
			},
		},

		{
			id: 'lump', label: 'Auto Sugar Lump', interval: 150,
			req: 'sugar lumps unlocked',
			avail: function () { return !!(Game.canLumps && Game.canLumps()); },
			tick: function () {
				if (Game.canLumps && Game.canLumps() &&
					(Date.now() - Game.lumpT) >= Game.lumpRipeAge) {
					Game.clickLump(); // guaranteed harvest once ripe
				}
			},
			menu: function () { return row('lump', 'Harvest sugar lump when ripe'); },
		},

		{
			id: 'fortune', label: 'Auto Fortune', interval: 15,
			tick: function () {
				if (Game.TickerEffect && Game.TickerEffect.type === 'fortune' && Game.tickerL) {
					// Trigger the game's own ticker click handler (add-only).
					Game.tickerL.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				}
			},
			menu: function () { return row('fortune', 'Click news-ticker fortunes'); },
		},

		{
			id: 'dragon', label: 'Auto Pet Dragon', interval: 30,
			req: "'Pet the dragon' heavenly upgrade",
			avail: function () { return !!Game.Has('Pet the dragon'); },
			tick: function () {
				// ponytail: only pets while the dragon panel is open (drop logic requires it).
				// Auto-opening the special menu would hijack the user's UI; left as upgrade path.
				if (Game.specialTab === 'dragon' && Game.dragonLevel >= 4 &&
					Game.Has('Pet the dragon')) Game.ClickSpecialPic();
			},
			menu: function () { return row('dragon', 'Pet Krumblor (dragon panel open)'); },
		},

		{
			id: 'autobuy', label: 'Auto-Buy (payback)', interval: 15,
			tick: function () { autoBuyTick(); },
			menu: function () {
				var s = settings.autobuy;
				return row('autobuy', 'Buy by payback period' +
					check('autobuy.buildings', s.buildings, 'buildings') +
					check('autobuy.upgrades', s.upgrades, 'upgrades') +
					check('autobuy.protect', s.protect, 'protect Lucky!/Frenzy bank') +
					check('autobuy.patient', s.patient, s.patient ? 'patient (save for best)' : 'fast (drain affordable)'));
			},
		},
	];

	// ---- payback engine ------------------------------------------------------
	// Marginal CpS by toggle-on -> recompute Game.cookiesPs -> diff -> revert.
	// Handles multiplier and multi-building upgrades that price/storedTotalCps misses.

	function recalcPs() { Game.CalculateGains(); return Game.cookiesPs; }

	function marginalBuilding(obj, base) {
		obj.amount++; var p = recalcPs();
		obj.amount--; recalcPs();
		return p - base;
	}
	function marginalUpgrade(u, base) {
		var b = u.bought, un = u.unlocked;
		u.bought = 1; u.unlocked = 1; var p = recalcPs();
		u.bought = b; u.unlocked = un; recalcPs();
		return p - base;
	}

	// Frenzy-aware Lucky! bank reserve (community-tuned: cps*1200, *7 outside Frenzy so a
	// future Frenzy+Lucky pays its cap). No point reserving without the "Get lucky" upgrade.
	function luckyReserve() {
		if (!settings.autobuy.protect || !Game.Has('Get lucky')) return 0;
		var mult = Game.hasBuff('Frenzy') ? 1 : 7;
		return mult * Game.cookiesPs * 1200;
	}

	var SKIP_POOLS = { toggle: 1, debug: 1, prestige: 1 };

	// PP = max(price - usableBank, 0)/cps + price/dcps ; lower is better.
	function pp(price, dcps, cps, usableBank) {
		if (dcps <= 0) return Infinity;
		return Math.max(price - usableBank, 0) / cps + price / dcps;
	}

	// Rank every candidate once (the expensive marginal-cps pass), then drain cheaply.
	function rankItems(cps, usable, base) {
		var items = [], i, s = settings.autobuy;
		if (s.buildings) for (i = 0; i < Game.ObjectsById.length; i++) {
			var o = Game.ObjectsById[i]; if (!o || o.locked) continue;
			var d = marginalBuilding(o, base);
			items.push({ pp: pp(o.getPrice(), d, cps, usable), obj: o, isBld: true });
		}
		if (s.upgrades) for (i = 0; i < Game.UpgradesInStore.length; i++) {
			var u = Game.UpgradesInStore[i]; if (!u || SKIP_POOLS[u.pool]) continue;
			var du = marginalUpgrade(u, base);
			items.push({ pp: pp(u.getPrice(), du, cps, usable), obj: u, isBld: false });
		}
		items.sort(function (a, b) { return a.pp - b.pp; });
		return items;
	}

	function autoBuyTick() {
		var cps = Game.cookiesPs;
		if (cps <= 0) return;
		var base = recalcPs();
		var reserve = luckyReserve();
		var ranked = rankItems(cps, Math.max(0, Game.cookies - reserve), base);
		var bought = 0, max = settings.autobuy.maxBuys, patient = settings.autobuy.patient;

		// Walk best-payback first. Fast mode (default): buy every item affordable now -> drains
		// the cheap backlog in one tick instead of one buy/sec. Patient mode: only the single
		// best item, saving up for it (skips cheaper-but-worse buys).
		for (var i = 0; i < ranked.length && bought < max; i++) {
			var it = ranked[i];
			if (it.pp === Infinity) break; // no positive-CpS items left
			// Re-fetch price each buy: building prices climb as we buy them.
			while (bought < max && it.obj.getPrice() <= Game.cookies - reserve) {
				it.obj.buy(1); bought++;
				if (!it.isBld) break; // upgrades are one-shot
			}
			if (patient) break;                       // saved for the best; stop
		}
	}

	// ---- scheduler -----------------------------------------------------------
	var frame = 0;
	function onLogic() {
		if (!settings.master) return;
		frame++;
		for (var i = 0; i < modules.length; i++) {
			var m = modules[i];
			if (!settings[m.id] || !settings[m.id].on) continue;
			if (m.avail && !m.avail()) continue; // prerequisite not unlocked in this save
			if (frame % m.interval !== 0) continue;
			try { m.tick(); } catch (e) { console.error('[MinMax] ' + m.id + ' tick:', e); }
		}
	}

	// ---- menu UI (safe wrapper of Game.UpdateMenu) ---------------------------
	function getSetting(path) {
		var p = path.split('.'), o = settings;
		for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
		return { obj: o, key: p[p.length - 1] };
	}

	// Public surface for inline onclick/onchange handlers (run in global scope).
	window.MinMax = {
		version: VERSION,
		settings: settings,
		toggle: function (id) {
			var m = modById(id);
			if (m && m.avail && !m.avail()) return; // can't enable a locked module
			settings[id].on = !settings[id].on; Game.UpdateMenu();
		},
		set: function (path, val) {
			var s = getSetting(path), cur = s.obj[s.key];
			s.obj[s.key] = (typeof cur === 'boolean') ? !cur :
				(typeof cur === 'number') ? (parseFloat(val) || 0) : val;
			Game.UpdateMenu();
		},
		_test: selfTest,
	};

	function onoff(on) { return on ? 'ON' : 'OFF'; }
	function modById(id) {
		for (var i = 0; i < modules.length; i++) if (modules[i].id === id) return modules[i];
		return null;
	}
	function row(id, body) {
		var m = modById(id);
		if (m && m.avail && !m.avail()) // prerequisite not unlocked: grey out, no toggle
			return '<div class="listing"><a class="option off" style="opacity:.45;cursor:default;">[—] ' +
				m.label + '</a> <span style="opacity:.55;">(requires ' + (m.req || 'unlock') + ')</span></div>';
		var on = settings[id] && settings[id].on;
		return '<div class="listing"><a class="option' + (on ? '' : ' off') +
			'" ' + Game.clickStr + '="MinMax.toggle(\'' + id + '\');">[' + onoff(on) +
			'] ' + (m ? m.label : id) + '</a> ' + body + '</div>';
	}
	function numField(path, val, size) {
		size = size || 3;
		return '<input type="text" style="width:' + (size * 12) + 'px;text-align:center;" value="' +
			val + '" onchange="MinMax.set(\'' + path + '\',this.value);" ' +
			'onkeyup="if(event.key===\'Enter\')this.blur();"/>';
	}
	function unitSelect(path, val) {
		var opts = ['none', 'K', 'M', 'B'], s = '<select onchange="MinMax.set(\'' + path + '\',this.value);">';
		for (var i = 0; i < opts.length; i++)
			s += '<option value="' + opts[i] + '"' + (opts[i] === val ? ' selected' : '') + '>' +
				(opts[i] === 'none' ? '×1' : '×' + opts[i]) + '</option>';
		return s + '</select>';
	}
	function check(path, val, label) {
		return ' <a class="option' + (val ? '' : ' off') + '" ' + Game.clickStr +
			'="MinMax.set(\'' + path + '\');">[' + (val ? '✓' : '✗') + '] ' + label + '</a>';
	}

	function buildMenu() {
		var menu = document.getElementById('menu');
		if (!menu || document.getElementById('minmaxMenu')) return;
		var html = '<div class="subsection" id="minmaxMenu"><div class="title">' +
			'Cookie MinMax v' + VERSION + '</div>' +
			'<div class="listing"><a class="option' + (settings.master ? '' : ' off') + '" ' +
			Game.clickStr + '="MinMax.toggle(\'master\');">[' + onoff(settings.master) +
			'] Master switch</a></div>';
		for (var i = 0; i < modules.length; i++) html += modules[i].menu();
		html += '</div>';
		menu.insertAdjacentHTML('beforeend', html);
	}
	// master isn't a module; give it a {on} shape so toggle() works.
	settings.master = settings.master; // (already boolean) — wrap for toggle:
	(function () {
		var v = settings.master;
		Object.defineProperty(settings, 'master', {
			get: function () { return v; }, set: function (x) { v = x; }, enumerable: true,
		});
	})();
	// allow MinMax.toggle('master')
	var _toggle = window.MinMax.toggle;
	window.MinMax.toggle = function (id) {
		if (id === 'master') { settings.master = !settings.master; Game.UpdateMenu(); return; }
		_toggle(id);
	};

	function wrapMenu() {
		if (Game.UpdateMenu._minmax) return;
		var orig = Game.UpdateMenu;
		Game.UpdateMenu = function () {
			orig.apply(this, arguments);
			try { if (Game.onMenu === 'prefs') buildMenu(); }
			catch (e) { console.error('[MinMax] menu:', e); }
		};
		Game.UpdateMenu._minmax = true;
	}

	// ---- self-check (runnable: MinMax._test()) -------------------------------
	function selfTest() {
		function assert(c, m) { if (!c) throw new Error('selfTest: ' + m); }
		// PP ordering: cheaper-per-cps wins; bank covers price -> first term 0.
		assert(pp(100, 10, 1, 0) > pp(100, 20, 1, 0), 'higher dcps should be better');
		assert(pp(100, 10, 1, 1000) < pp(100, 10, 1, 0), 'bank coverage lowers PP');
		assert(pp(100, 0, 1, 0) === Infinity, 'zero dcps -> Infinity');
		// unit resolution
		var sv = settings.click.value, su = settings.click.unit;
		settings.click.value = 50; settings.click.unit = 'M';
		assert(targetCps() === 50e6, 'unit math 50M');
		settings.click.value = 999; settings.click.unit = 'B';
		assert(targetCps() === 999e9, 'unit math 999B');
		settings.click.value = sv; settings.click.unit = su;
		var pr = settings.autobuy.protect; settings.autobuy.protect = false;
		assert(luckyReserve() === 0, 'protect off -> no reserve'); settings.autobuy.protect = pr;
		console.log('[MinMax] selfTest OK');
		return true;
	}

	// ---- register ------------------------------------------------------------
	Game.registerMod(MOD_ID, {
		name: 'Cookie MinMax',
		init: function () {
			wrapMenu();
			Game.registerHook('logic', onLogic);
			selfTest();
			console.log('[MinMax] v' + VERSION + ' loaded.');
		},
		save: function () { return JSON.stringify(settings); },
		load: function (str) {
			try {
				var s = JSON.parse(str);
				for (var k in s) if (settings[k] && typeof settings[k] === 'object')
					for (var j in s[k]) settings[k][j] = s[k][j];
				else if (k in settings) settings[k] = s[k];
			} catch (e) { console.error('[MinMax] load:', e); }
		},
	});
})();

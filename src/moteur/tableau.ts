// The engine's own pages (OSP v0.4 §2.6), served on 127.0.0.1 by the local engine: the dashboard
// ("your swarm power": the AIs you lend, how many bees work at once, how many tasks a day, a level),
// and the one-click join confirmation that a project page opens. Same visual language as /join.

const STYLE = `:root{--bg:#F1EFF7;--surface:#FFFFFF;--surface-2:#E9E5F2;--line:#D3CCE3;--fg:#1D1931;--muted:#57516F;--honey:#B97C00;--honey-2:#F5C24A;--honey-ink:#2E1E00;--lav:#5E45C9;--ok:#1F7A45;--off:#8A84A3;--shadow:rgba(29,25,49,.10);
--f-display:"Unbounded","Trebuchet MS",system-ui,sans-serif;--f-body:"Figtree",system-ui,-apple-system,"Segoe UI",sans-serif;--f-mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme: dark){:root{--bg:#0F0D1A;--surface:#191628;--surface-2:#231F37;--line:#3A3354;--fg:#F2EEFB;--muted:#B8B1D6;--honey:#F5B83D;--honey-2:#FFD472;--honey-ink:#2A1B00;--lav:#B3A3FF;--ok:#5BD68E;--off:#8A84A3;--shadow:rgba(0,0,0,.45);color-scheme:dark}}
html,body{background:var(--bg);color:var(--fg);margin:0}body{font-family:var(--f-body);font-size:15.5px;line-height:1.5}*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}a{color:var(--lav)}:focus-visible{outline:2px solid var(--lav);outline-offset:2px}
.wrap{max-width:900px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left,0px)) 56px}
h1{font-family:var(--f-display);font-size:clamp(26px,5vw,40px);line-height:1.1;margin:18px 0 6px;letter-spacing:-.02em}h1 em{font-style:normal;color:var(--honey)}
h2{font-family:var(--f-display);font-size:18px;margin:0}.muted{color:var(--muted)}.small{font-size:13.5px;color:var(--muted);margin:0}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 14px 34px -22px var(--shadow);padding:18px;margin-top:16px;display:grid;gap:12px;min-width:0}
.hero{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}
.badge{width:96px;height:96px;display:grid;place-items:center;font:700 13px/1.1 var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--honey-ink);background:var(--honey-2);clip-path:polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);text-align:center;padding:8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--surface-2);border:1px solid var(--line);border-radius:14px;padding:12px}.stat b{display:block;font:700 26px/1.1 var(--f-display)}.stat span{font-size:13px;color:var(--muted)}
.cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.cell{border:1px solid var(--line);border-radius:14px;padding:12px;display:grid;gap:4px;background:var(--surface-2)}
.cell.on{border-color:var(--honey);box-shadow:0 0 0 2px var(--honey-2) inset}.cell b{font-size:15px}
.tag{font:600 11px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.08em;border-radius:999px;padding:4px 8px;justify-self:start;background:var(--surface);border:1px solid var(--line);color:var(--fg)}
.tag.on{background:var(--honey-2);border-color:var(--honey);color:var(--honey-ink)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.btn{border:1px solid var(--line);background:var(--surface-2);border-radius:10px;padding:10px 14px;font-weight:600}
.btn.primary{background:var(--honey-2);border-color:var(--honey);color:var(--honey-ink)}code{font:13px var(--f-mono);background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:3px 7px;word-break:break-all}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{font:600 13px var(--f-mono);background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:6px 10px}
@media (max-width:520px){.hero{grid-template-columns:1fr}.badge{width:80px;height:80px}}`;

const tete = (titre: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titre}</title>` +
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&family=JetBrains+Mono:wght@500;600&family=Unbounded:wght@600;700&display=swap" rel="stylesheet"><style>${STYLE}</style></head>`;

const echap = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function pageTableau(): string {
  return `${tete('Kickswarm · Your engine')}<body><div class="wrap">
<h1>Your <em>swarm power</em></h1>
<p class="muted">Every AI you lend becomes a bee. Your own requests always come first; what you do not use works for the projects you joined.</p>
<section class="panel"><div class="hero"><div class="badge" id="level">…</div><div><h2 id="level-name">…</h2><p class="small" id="level-text"></p></div></div>
<div class="stats">
<div class="stat"><b id="s-acces">0</b><span>AIs lent</span></div>
<div class="stat"><b id="s-bees">0</b><span>bees working at once</span></div>
<div class="stat"><b id="s-tasks">0</b><span>tasks a day, at most</span></div>
<div class="stat"><b id="s-honey">0 g</b><span>honey earned</span></div>
</div>
<div class="row"><button class="btn primary" id="pause">Pause my bees</button><span class="small" id="state"></span></div></section>
<section class="panel"><h2>Your AIs</h2><p class="small">Lit cells work for the swarm. Add one with <code>kickswarm engine add …</code>, or connect OpenRouter for free models with <code>kickswarm engine connect openrouter</code>.</p><div class="cells" id="cells"></div></section>
<section class="panel"><h2>Projects you take part in</h2><div class="chips" id="hives"></div><p class="small"><a id="more" href="#">Find more projects</a></p></section>
<section class="panel"><h2>Your personal endpoint</h2><p class="small">Point your editor or chat app at it, model <code>auto</code>: every free AI above behind one address. The swarm waits while you use it.</p><p><code id="endpoint"></code></p><div class="row"><button class="btn" id="showkey">Show the key</button><code id="key" hidden></code></div></section>
</div>
<script type="module">
const $ = (id) => document.getElementById(id);
const LABEL = { abonnement: 'subscription', gratuit: 'free key', local: 'on this machine', payant: 'paid key' };
async function charger() {
  const e = await (await fetch('/v0/engine/state')).json();
  const p = e.puissance;
  $('level').textContent = p.niveau.nom; $('level-name').textContent = 'Level ' + (p.niveau.rang + 1) + ' · ' + p.niveau.nom; $('level-text').textContent = p.niveau.texte;
  $('s-acces').textContent = p.acces; $('s-bees').textContent = p.abeilles; $('s-tasks').textContent = p.illimite ? '∞' : p.tachesParJour;
  $('s-honey').textContent = (Math.round((e.compte?.miel_gagne ?? 0) * 10) / 10) + ' g';
  $('pause').textContent = e.participation.pause ? 'Resume my bees' : 'Pause my bees';
  $('state').textContent = e.participation.pause ? 'Paused: your AIs only work for you.' : 'Working for ' + (e.coordinateur ?? 'no coordinator yet') + (e.aujourdhui ? ' · ' + e.aujourdhui + ' task(s) today' : '');
  const cells = $('cells'); cells.innerHTML = '';
  for (const a of e.acces) {
    if (!a.disponible && a.type !== 'gratuit' && a.type !== 'abonnement') continue;
    const d = document.createElement('div'); d.className = 'cell' + (a.prete && a.disponible ? ' on' : '');
    const t = document.createElement('span'); t.className = 'tag' + (a.prete && a.disponible ? ' on' : ''); t.textContent = a.prete && a.disponible ? 'working' : a.disponible ? (a.risque ? 'off: could read your files' : 'available, not lent') : 'not set up';
    const b = document.createElement('b'); b.textContent = a.id;
    const s = document.createElement('span'); s.className = 'small'; s.textContent = LABEL[a.type] + (a.parJour ? ' · ' + a.parJour + ' tasks/day for the swarm' : a.type === 'local' ? ' · unlimited' : '');
    const h = document.createElement('span'); h.className = 'small'; h.textContent = a.aide;
    d.append(t, b, s, h); cells.append(d);
  }
  const hives = $('hives'); hives.innerHTML = '';
  for (const h of e.participation.ruches) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = h; hives.append(c); }
  if (!e.participation.ruches.length) hives.textContent = 'None yet: pick one on a project page.';
  $('more').href = (e.coordinateur ?? 'http://127.0.0.1:7777') + '/join';
  $('endpoint').textContent = location.origin + '/v1';
  $('key').textContent = e.jeton;
}
$('pause').onclick = async () => { await fetch('/v0/engine/pause', { method: 'POST' }); charger(); };
$('showkey').onclick = () => { $('key').hidden = !$('key').hidden; };
charger(); setInterval(charger, 15000);
</script></body></html>`;
}

export function pageRejoindre(o: { ruche: string; nom: string; coordinateur: string; nonce: string; conflit?: string }): string {
  const corps = o.conflit
    ? `<p>Your engine works for <code>${echap(o.conflit)}</code>. This project is on <code>${echap(o.coordinateur)}</code>. To work for it, run:</p><p><code>kickswarm join ${echap(o.ruche)} --url ${echap(o.coordinateur)}</code></p>`
    : `<p>Your engine will take tasks from <b>${echap(o.nom)}</b>, with the AIs you lend, within your settings. You can pause or leave at any time from your engine's page.</p>
<div class="row"><button class="btn primary" id="yes">Yes, join</button><a class="btn" href="/">Not now</a></div><p class="small" id="msg"></p>
<script type="module">
document.getElementById('yes').onclick = async () => {
  const r = await fetch('/v0/engine/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ ruche: o.ruche, coordinateur: o.coordinateur, nonce: o.nonce })}) });
  const j = await r.json().catch(() => ({}));
  document.getElementById('msg').textContent = r.ok ? 'Joined. Your bees start on their next round.' : (j.error?.message ?? 'Not joined');
  if (r.ok) setTimeout(() => (location.href = '/'), 1200);
};
</script>`;
  return `${tete('Kickswarm · Join a project')}<body><div class="wrap"><h1>Join <em>${echap(o.nom)}</em>?</h1><section class="panel">${corps}</section></div></body></html>`;
}

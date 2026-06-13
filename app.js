// Aucune donnée n'est collectée : les choix vivent en mémoire, rien n'est envoyé
// ni stocké de façon persistante. Tout est recalculé côté navigateur.

const LABELS = { pour: 'Pour', contre: 'Contre', abstention: 'Abstention' };
const choix = {};            // id du texte -> 'pour' | 'contre' | 'abstention'
let filtreTheme = 'Tous';
let DATA = null;

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

init();

async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    DATA = await res.json();
  } catch (e) {
    $('#textes').innerHTML = '<p class="empty">Données momentanément indisponibles. Réessayez plus tard.</p>';
    return;
  }
  $('#maj').textContent = DATA.maj || '';
  renderKpi();
  renderThemes();
  renderTextes();
}

function renderKpi() {
  const list = $('#kpi-list');
  list.innerHTML = '';
  (DATA.groupes || []).forEach(g => {
    if (g.participation == null) return;
    const row = el('div', 'kpi-row');
    row.append(
      el('span', 'kpi-name', esc(g.nom)),
      el('div', 'kpi-bar', `<span style="width:${g.participation}%"></span>`),
      el('span', 'kpi-val mono', g.participation + '%')
    );
    list.append(row);
  });
}

function renderThemes() {
  const box = $('#themes');
  box.innerHTML = '';
  const themes = ['Tous', ...(DATA.themes || [])];
  themes.forEach(t => {
    const b = el('button', 'chip', esc(t));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(t === filtreTheme));
    b.onclick = () => { filtreTheme = t; renderThemes(); renderTextes(); };
    box.append(b);
  });
}

function renderTextes() {
  const box = $('#textes');
  box.innerHTML = '';
  const liste = (DATA.textes || []).filter(t => filtreTheme === 'Tous' || t.theme === filtreTheme);
  if (!liste.length) { box.innerHTML = '<p class="empty">Aucun texte dans cette thématique.</p>'; return; }
  liste.forEach(t => box.append(carteTexte(t)));
}

function carteTexte(t) {
  const c = el('article', 'texte');

  const meta = el('div', 't-meta');
  meta.append(el('span', 't-theme', esc(t.theme)));
  if (t.date) meta.append(el('span', null, dateFR(t.date)));
  if (t.sort) {
    const s = el('span', 't-sort ' + (t.sort === 'adopté' ? 'adopte' : 'rejete'), t.sort === 'adopté' ? 'Texte adopté' : 'Texte rejeté');
    meta.append(s);
  }
  c.append(meta);

  c.append(el('h3', 't-titre', esc(t.titre)));

  const choixBox = el('div', 'choix');
  ['pour', 'contre', 'abstention'].forEach(v => {
    const b = el('button', 'choix-b', LABELS[v]);
    b.type = 'button'; b.dataset.v = v;
    b.onclick = () => { choix[t.id] = v; majCarte(c, t); };
    choixBox.append(b);
  });
  c.append(choixBox);

  const reveal = el('div', 'reveal');
  reveal.hidden = true;
  c.append(reveal);

  majCarte(c, t);
  return c;
}

function majCarte(c, t) {
  const mon = choix[t.id];
  c.querySelectorAll('.choix button').forEach(b => b.classList.toggle('sel', b.dataset.v === mon));
  const reveal = $('.reveal', c);
  if (!mon) { reveal.hidden = true; reveal.innerHTML = ''; return; }

  reveal.hidden = false;
  reveal.innerHTML = '<h4>Ce qu\'ont voté les groupes</h4>';
  const groupes = el('div', 'groupes');

  const entries = Object.entries(t.groupes || {})
    .sort((a, b) => somme(b[1]) - somme(a[1]));
  let accord = 0, total = 0;
  entries.forEach(([nom, g]) => {
    const match = g.position === mon;
    if (g.position) { total++; if (match) accord++; }
    const row = el('div', 'grp' + (match ? ' match' : ''));
    row.append(
      el('span', 'grp-name', esc(nom)),
      el('span', 'grp-pos ' + g.position, LABELS[g.position] || '—'),
      el('span', 'grp-detail mono', `${g.pour}/${g.contre}/${g.abstention}`)
    );
    groupes.append(row);
  });
  reveal.append(groupes);
  reveal.append(el('p', 'accord', '<span class="grp-detail mono">Chiffres : pour / contre / abstention</span>'));

  if (total) {
    reveal.append(el('p', 'accord',
      `Vous êtes d'accord avec la position majoritaire de <strong>${accord}</strong> groupe${accord > 1 ? 's' : ''} sur ${total}.`));
  }
  const a = el('a', 't-lien');
  a.href = t.lienTexte; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = 'Lire le texte et le détail du vote ↗';
  reveal.append(a);
}

const somme = g => (g.pour || 0) + (g.contre || 0) + (g.abstention || 0) + (g.nonVotant || 0);
function dateFR(iso) {
  const [y, m, d] = (iso || '').split('-');
  if (!y) return '';
  const mois = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${+d} ${mois[+m]} ${y}`;
}

// Aucune donnée n'est collectée : les choix vivent en mémoire, rien n'est envoyé
// ni stocké durablement. Tout est recalculé côté navigateur.

const LABELS = { pour: 'Pour', contre: 'Contre', abstention: 'Abstention' };
const choix = {};               // id du texte -> 'pour' | 'contre' | 'abstention'
let DATA = null;
let theme = 'Tous';
let annee = 'Toutes';
let liste = [];                 // questions filtrées (récentes d'abord)
let idx = 0;

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const anneeDe = (t) => (t.date || '').slice(0, 4);

init();

async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    DATA = await res.json();
  } catch (e) {
    $('#question').innerHTML = '<p class="empty">Données momentanément indisponibles. Réessayez plus tard.</p>';
    return;
  }
  $('#maj').textContent = DATA.maj || '';
  rebuild();
}

function rebuild() {
  liste = (DATA.textes || [])
    .filter(t => theme === 'Tous' || t.theme === theme)
    .filter(t => annee === 'Toutes' || anneeDe(t) === annee)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  idx = 0;
  renderFiltres();
  render();
}

function renderFiltres() {
  // Thèmes
  const tbox = $('#themes'); tbox.innerHTML = '';
  ['Tous', ...(DATA.themes || [])].forEach(t => {
    const b = el('button', 'chip', esc(t)); b.type = 'button';
    b.setAttribute('aria-pressed', String(t === theme));
    b.onclick = () => { theme = t; rebuild(); };
    tbox.append(b);
  });
  // Années (distinctes, décroissantes)
  const abox = $('#annees'); abox.innerHTML = '';
  const annees = [...new Set((DATA.textes || []).map(anneeDe).filter(Boolean))].sort().reverse();
  ['Toutes', ...annees].forEach(a => {
    const b = el('button', 'chip', esc(a)); b.type = 'button';
    b.setAttribute('aria-pressed', String(a === annee));
    b.onclick = () => { annee = a; rebuild(); };
    abox.append(b);
  });
}

function render() {
  const q = $('#question'); const nav = $('#nav');
  q.innerHTML = ''; nav.innerHTML = '';
  if (!liste.length) { q.innerHTML = '<p class="empty">Aucun texte ne correspond à ces filtres.</p>'; return; }
  if (idx >= liste.length) idx = liste.length - 1;

  const t = liste[idx];
  q.append(el('p', 'progress', `Question ${idx + 1} / ${liste.length}`));
  q.append(carteTexte(t));
  renderNav();
}

function carteTexte(t) {
  const c = el('article', 'texte');

  const meta = el('div', 't-meta');
  meta.append(el('span', 't-theme', esc(t.theme)));
  if (t.type) meta.append(el('span', null, esc(t.type)));
  if (t.lecture) meta.append(el('span', null, esc(t.lecture)));
  if (t.date) meta.append(el('span', null, dateFR(t.date)));
  if (t.sort) meta.append(el('span', 't-sort ' + (t.sort === 'adopté' ? 'adopte' : 'rejete'), t.sort === 'adopté' ? 'Texte adopté' : 'Texte rejeté'));
  c.append(meta);

  c.append(el('h2', 't-titre', esc(t.titre || t.titreOfficiel || '')));

  if (t.contexte) {
    c.append(el('div', 't-contexte', '<span class="ctx-label">De quoi s\'agit-il ?</span>' + esc(t.contexte)));
  }

  const choixBox = el('div', 'choix');
  ['pour', 'contre', 'abstention'].forEach(v => {
    const b = el('button', null, LABELS[v]); b.type = 'button'; b.dataset.v = v;
    b.onclick = () => { choix[t.id] = v; render(); };
    choixBox.append(b);
  });
  c.append(choixBox);

  const mon = choix[t.id];
  c.querySelectorAll('.choix button').forEach(b => b.classList.toggle('sel', b.dataset.v === mon));

  if (!mon) {
    c.append(el('p', 'hint', 'Choisissez pour voir comment ont voté les groupes.'));
  } else {
    c.append(reveal(t, mon));
  }
  return c;
}

function reveal(t, mon) {
  const r = el('div', 'reveal', '<h4>Ce qu\'ont voté les groupes</h4>');
  const groupes = el('div', 'groupes');
  const entries = Object.entries(t.groupes || {}).sort((a, b) => somme(b[1]) - somme(a[1]));
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
  r.append(groupes);
  r.append(el('p', 'legend mono', 'Chiffres : pour / contre / abstention'));
  if (total) r.append(el('p', 'accord', `Vous rejoignez la position majoritaire de <strong>${accord}</strong> groupe${accord > 1 ? 's' : ''} sur ${total}.`));
  const a = el('a', 't-lien'); a.href = t.lienTexte; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = 'Lire le texte et le détail du vote ↗';
  r.append(a);
  return r;
}

function renderNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  const t = liste[idx];
  const prev = el('button', null, '← Précédent'); prev.type = 'button';
  prev.disabled = idx === 0;
  prev.onclick = () => { if (idx > 0) { idx--; render(); scrollTop(); } };
  nav.append(prev);

  // « Suivant » apparaît une fois qu'on a répondu (sinon on invite à choisir).
  if (choix[t.id] && idx < liste.length - 1) {
    const next = el('button', 'primary', 'Question suivante →'); next.type = 'button';
    next.onclick = () => { idx++; render(); scrollTop(); };
    nav.append(next);
  } else if (choix[t.id] && idx === liste.length - 1) {
    nav.append(el('span', 'hint', 'Vous avez parcouru tous les textes de cette sélection.'));
  }
}

function scrollTop() {
  const y = document.querySelector('#quiz').getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

const somme = g => (g.pour || 0) + (g.contre || 0) + (g.abstention || 0) + (g.nonVotant || 0);
function dateFR(iso) {
  const [y, m, d] = (iso || '').split('-');
  if (!y) return '';
  const mois = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${+d} ${mois[+m]} ${y}`;
}

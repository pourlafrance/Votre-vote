// Aucune donnée n'est collectée : la réponse vit en mémoire pour la question
// affichée uniquement, rien n'est envoyé ni conservé. À chaque changement de
// question ou de filtre, on repart d'un état vierge (aucune réponse sélectionnée).

const LABELS = { pour: 'Pour', contre: 'Contre', abstention: 'Abstention' };
let DATA = null;
let theme = 'Tous';
let annee = 'Toutes';
let liste = [];       // questions filtrées (récentes d'abord)
let idx = 0;
let reponse = null;   // réponse de la SEULE question affichée (réinitialisée à chaque navigation)

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
  $('#prev').onclick = () => { if (idx > 0) { reponse = null; idx--; render(); scrollTop(); } };
  $('#next').onclick = () => { if (idx < liste.length - 1) { reponse = null; idx++; render(); scrollTop(); } };
  rebuild();
}

function rebuild() {
  liste = (DATA.textes || [])
    .filter(t => theme === 'Tous' || t.theme === theme)
    .filter(t => annee === 'Toutes' || anneeDe(t) === annee)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  idx = 0;
  reponse = null;          // changement de filtre => rien de sélectionné
  renderFiltres();
  render();
}

function renderFiltres() {
  const tbox = $('#themes'); tbox.innerHTML = '';
  ['Tous', ...(DATA.themes || [])].forEach(t => {
    const b = el('button', 'chip', esc(t)); b.type = 'button';
    b.setAttribute('aria-pressed', String(t === theme));
    b.onclick = () => { theme = t; rebuild(); };
    tbox.append(b);
  });
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
  const q = $('#question'); q.innerHTML = '';
  const prev = $('#prev'), next = $('#next');
  if (!liste.length) {
    $('#progress').textContent = '';
    q.innerHTML = '<p class="empty">Aucun texte ne correspond à ces filtres.</p>';
    prev.classList.add('hidden'); next.classList.add('hidden');
    return;
  }
  if (idx >= liste.length) idx = liste.length - 1;
  prev.classList.remove('hidden'); next.classList.remove('hidden');
  prev.disabled = idx === 0;
  next.disabled = idx === liste.length - 1;
  $('#progress').textContent = `Question ${idx + 1} / ${liste.length}`;
  q.append(carteTexte(liste[idx]));
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
  if (t.contexte) c.append(el('div', 't-contexte', '<span class="ctx-label">De quoi s\'agit-il ?</span>' + esc(t.contexte)));

  const choixBox = el('div', 'choix');
  ['pour', 'contre', 'abstention'].forEach(v => {
    const b = el('button', null, LABELS[v]); b.type = 'button'; b.dataset.v = v;
    b.classList.toggle('sel', reponse === v);
    b.onclick = () => { reponse = v; render(); };
    choixBox.append(b);
  });
  c.append(choixBox);

  if (!reponse) c.append(el('p', 'hint', 'Choisissez pour voir comment ont voté les groupes.'));
  else c.append(reveal(t, reponse));
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

function scrollTop() {
  const y = $('#quiz').getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

const somme = g => (g.pour || 0) + (g.contre || 0) + (g.abstention || 0) + (g.nonVotant || 0);
function dateFR(iso) {
  const [y, m, d] = (iso || '').split('-');
  if (!y) return '';
  const mois = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${+d} ${mois[+m]} ${y}`;
}

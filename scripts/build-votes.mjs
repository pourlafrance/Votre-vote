#!/usr/bin/env node
/**
 * Génère data.json : la liste des votes « sur l'ensemble » d'un texte à l'Assemblée
 * (17e législature), avec, pour chaque texte, ce qu'a voté chaque GROUPE politique,
 * et un KPI de participation par groupe.
 *
 * Deux sources open data officielles :
 *  - Scrutins (Assemblée nationale)  : qui a voté quoi, nominativement.
 *  - Datan (data.gouv, d'après l'AN)  : pour nommer le groupe de chaque député.
 *
 * AUCUNE donnée utilisateur n'est touchée : ce script ne produit que des données
 * publiques agrégées. Le site est statique et ne collecte rien.
 *
 * Fail-safe : la moindre erreur => on n'écrase pas data.json existant.
 */

import { writeFileSync, readFileSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../data.json')

const DATAN_CSV = 'https://www.data.gouv.fr/fr/datasets/r/092bd7bb-1543-405b-b53c-932ebb49bb8e'
const SCRUTINS_ZIP = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip'
const AUJOURDHUI = new Date().toISOString().slice(0, 10)

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v])

// ---- Thématiques (classification automatique par mots-clés, 1er match) ----
const THEMES = [
  ['Budget & fiscalité', /budget|finances?|fiscal|imp[oô]t|taxe|s[ée]curit[ée] sociale|\bplf\b|plfss/i],
  ['Travail & retraites', /travail|emploi|retraite|ch[oô]mage|salari|pouvoir d.achat|smic/i],
  ['Santé', /sant[ée]|h[oô]pital|m[ée]dic|soin|s[ée]curit[ée] sociale/i],
  ['Immigration & asile', /immigration|asile|[ée]tranger|s[ée]jour|naturalisation/i],
  ['Sécurité & justice', /s[ée]curit[ée]|justice|p[ée]nal|d[ée]linqu|police|terroris|prison|narcotrafic/i],
  ['Environnement & énergie', /environnement|climat|[ée]nergie|nucl[ée]aire|[ée]cologi|renouvelable|pollution|eau\b/i],
  ['Agriculture', /agricol|agricultur|p[eê]che|alimentation|[ée]levage|paysan/i],
  ['Éducation & recherche', /[ée]ducation|[ée]cole|universit|enseignement|recherche|[ée]tudiant/i],
  ['Logement', /logement|habitat|loyer|urbanisme|locati/i],
  ['Économie & entreprises', /[ée]conomi|entreprise|industri|commerce|consommation|num[ée]rique|simplification/i],
  ['Institutions & élections', /constitution|[ée]lection|r[ée]f[ée]rendum|institution|d[ée]centralisation|collectivit|scrutin/i],
  ['International & défense', /d[ée]fense|arm[ée]e|militaire|international|trait[ée]|ukraine|union europ[ée]enne|\botan\b|gaza/i],
  ['Société & libertés', /bio[ée]thique|fin de vie|la[ïi]cit|famille|[ée]galit|discrimination|libert/i]
]
const themeDe = (txt) => (THEMES.find(([, re]) => re.test(txt)) || ['Autre'])[0]

// ---- CSV (Datan, séparateur point-virgule, guillemets) ----
function parseCSV(text) {
  const rows = []; let f = '', row = [], q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ';') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f.length || row.length) { row.push(f); rows.push(row) }
  const h = rows.shift().map(x => x.trim())
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((x, i) => [x, (r[i] ?? '').trim()])))
}

function walkJSON(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name); const s = statSync(p)
    if (s.isDirectory()) out.push(...walkJSON(p))
    else if (name.endsWith('.json')) out.push(p)
  }
  return out
}

// Récupère, par acteurRef, le bucket de vote (pour/contre/abstention/nonVotant).
function votantsParBucket(scrutin) {
  const out = []
  const groupes = arr(scrutin?.ventilationVotes?.organe?.groupes?.groupe)
  const buckets = [['pours', 'pour'], ['contres', 'contre'], ['abstentions', 'abstention'],
                   ['nonVotants', 'nonVotant'], ['nonVotantsVolontaires', 'nonVotant']]
  for (const g of groupes) {
    const dn = g?.vote?.decompteNominatif
    if (!dn) continue
    for (const [cle, bucket] of buckets) {
      for (const v of arr(dn[cle]?.votant)) if (v?.acteurRef) out.push([v.acteurRef, bucket])
    }
  }
  return out
}

function main() {
  // 1) Roster Datan : acteurRef -> nom de groupe
  let groupeDe = {}
  try {
    console.log('→ Datan (groupes des députés)…')
    const txt = execSync(`curl -fsSL "${DATAN_CSV}"`, { encoding: 'utf8', maxBuffer: 1 << 28 })
    for (const r of parseCSV(txt)) {
      if (r.id) groupeDe[String(r.id)] = { nom: r.groupe || r.groupeAbrev || 'Non inscrit', abrev: r.groupeAbrev || '' }
    }
  } catch (e) { console.warn('⚠️ Datan indisponible :', e.message); return }
  if (!Object.keys(groupeDe).length) { console.warn('⚠️ roster vide'); return }

  // 2) Scrutins AN
  let dir
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'scr-'))
    const zip = join(tmp, 's.zip')
    console.log('→ Scrutins (Assemblée nationale)…')
    execSync(`curl -fsSL "${SCRUTINS_ZIP}" -o "${zip}"`, { stdio: 'ignore' })
    execSync(`unzip -oq "${zip}" -d "${tmp}"`, { stdio: 'ignore' })
    dir = tmp
  } catch (e) { console.warn('⚠️ Scrutins indisponibles :', e.message); return }

  const fichiers = walkJSON(dir).filter(f => /scrutin/i.test(f))
  const textes = []
  const kpi = {}  // groupe -> { exprimes, effectif, votes }

  for (const f of fichiers) {
    let s
    try { s = JSON.parse(readFileSync(f, 'utf8')).scrutin } catch { continue }
    if (!s) continue
    const objet = (s.objet?.libelle || s.titre || '').trim()
    if (!/l['’]ensemble/i.test(objet)) continue   // votes finaux sur un texte

    const date = (s.dateScrutin || '').slice(0, 10)
    const numero = s.numero || ''
    const sort = (s.sort?.libelle || s.sort?.code || '').toLowerCase()
    const adopte = /adopt/.test(sort)

    const parGroupe = {}      // nom -> {pour,contre,abstention,nonVotant}
    const global = { pour: 0, contre: 0, abstention: 0 }
    for (const [ref, bucket] of votantsParBucket(s)) {
      const g = groupeDe[String(ref)]
      if (!g) continue
      const k = g.nom
      ;(parGroupe[k] ||= { pour: 0, contre: 0, abstention: 0, nonVotant: 0 })[bucket]++
      if (bucket !== 'nonVotant') global[bucket]++
    }
    if (!Object.keys(parGroupe).length) continue

    // position majoritaire du groupe + KPI participation
    const groupes = {}
    for (const [nom, c] of Object.entries(parGroupe)) {
      const expr = c.pour + c.contre + c.abstention
      const eff = expr + c.nonVotant
      const position = c.pour >= c.contre && c.pour >= c.abstention ? 'pour'
                     : c.contre >= c.abstention ? 'contre' : 'abstention'
      groupes[nom] = { ...c, position }
      const a = (kpi[nom] ||= { exprimes: 0, effectif: 0, votes: 0 })
      a.exprimes += expr; a.effectif += eff; if (eff) a.votes++
    }

    textes.push({
      id: numero || f, date, titre: objet, theme: themeDe(objet),
      sort: adopte ? 'adopté' : (sort ? 'rejeté' : ''),
      global, groupes,
      lienTexte: numero ? `https://www.assemblee-nationale.fr/dyn/17/scrutins/${numero}` : 'https://www.assemblee-nationale.fr/dyn/17/scrutins'
    })
  }

  if (!textes.length) { console.warn('⚠️ aucun texte retenu, on n\'écrase pas'); return }
  textes.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const groupes = Object.entries(kpi)
    .map(([nom, a]) => ({ nom, participation: a.effectif ? Math.round(a.exprimes / a.effectif * 100) : null, votes: a.votes }))
    .filter(g => g.votes >= 3)
    .sort((a, b) => b.votes - a.votes)

  const themes = [...new Set(textes.map(t => t.theme))]

  writeFileSync(OUT, JSON.stringify({ maj: AUJOURDHUI, legislature: 17, nbTextes: textes.length, groupes, themes, textes }), 'utf8')
  console.log(`✓ ${textes.length} textes, ${groupes.length} groupes. → data.json`)
}

try { main() } catch (e) { console.warn('⚠️ build-votes ignoré :', e.message); process.exit(0) }

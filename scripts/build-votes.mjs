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
const ghNotice = m => console.log(`::notice::${m}`)
const ghError = m => console.log(`::error::${m}`)

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

// Nettoie l'intitulé officiel en titre lisible.
function titrePropre(objet) {
  let s = objet.replace(/^l['’]ensemble\s+(du |de la |des |de l['’]|d['’])?/i, '').trim()
  s = s.replace(/\s*\((première|deuxième|nouvelle|nouvelle lecture|lecture définitive)[^)]*\)\s*$/i, '').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : objet
}
const typeDe = (o) => /proposition de loi/i.test(o) ? 'Proposition de loi'
  : /projet de loi/i.test(o) ? 'Projet de loi'
  : /proposition de r[ée]solution/i.test(o) ? 'Proposition de résolution'
  : /motion/i.test(o) ? 'Motion' : 'Texte'
const lectureDe = (o) => (o.match(/(première lecture|deuxième lecture|nouvelle lecture|lecture définitive)/i) || [''])[0].toLowerCase()

// Contexte : surcouche manuelle (contextes.json) prioritaire ; sinon phrase factuelle.
let CONTEXTES = {}
try {
  const p = resolve(__dirname, '../contextes.json')
  if (existsSync(p)) CONTEXTES = JSON.parse(readFileSync(p, 'utf8'))
} catch { /* ignore */ }
function contexteDe(numero, type, lecture, theme) {
  const m = CONTEXTES[String(numero)]
  if (m && typeof m === 'string' && m.trim()) return m.trim()
  const bits = [type]
  if (lecture) bits.push(lecture)
  return `${bits.join(', ')}. Vote sur l'ensemble du texte. Thématique : ${theme}.`
}

// ---- CSV (Datan, séparateur point-virgule, guillemets) ----
function parseCSV(text) {
  const firstNL = text.indexOf('\n')
  const head = text.slice(0, firstNL < 0 ? text.length : firstNL)
  const delim = head.split(';').length > head.split(',').length ? ';' : ','
  const rows = []; let f = '', row = [], q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === delim) { row.push(f); f = '' }
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

async function main() {
  // 1) Roster Datan : acteurRef -> nom de groupe
  let groupeDe = {}
  try {
    console.log('→ Datan (groupes des députés)…')
    const res = await fetch(DATAN_CSV, { headers: { 'User-Agent': 'registre-votes (open data)' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    for (const r of parseCSV(await res.text())) {
      if (r.id) groupeDe[String(r.id)] = { nom: r.groupe || r.groupeAbrev || 'Non inscrit', abrev: r.groupeAbrev || '' }
    }
    ghNotice(`Datan : ${Object.keys(groupeDe).length} députés chargés`)
  } catch (e) { throw new Error('Datan indisponible : ' + e.message) }
  if (!Object.keys(groupeDe).length) throw new Error('roster Datan vide')

  // 2) Scrutins AN
  let dir
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'scr-'))
    const zip = join(tmp, 's.zip')
    console.log('→ Scrutins (Assemblée nationale)…')
    execSync(`curl -fsSL -A "registre-votes (open data)" "${SCRUTINS_ZIP}" -o "${zip}"`, { stdio: 'ignore' })
    execSync(`unzip -oq "${zip}" -d "${tmp}"`, { stdio: 'ignore' })
    dir = tmp
  } catch (e) { throw new Error('Scrutins indisponibles : ' + e.message) }

  const fichiers = walkJSON(dir).filter(f => /scrutin/i.test(f))
  ghNotice(`${fichiers.length} fichiers de scrutins`)
  let vusEnsemble = 0, sansGroupe = 0
  const textes = []

  for (const f of fichiers) {
    let s
    try { s = JSON.parse(readFileSync(f, 'utf8')).scrutin } catch { continue }
    if (!s) continue
    const objet = (s.objet?.libelle || s.titre || '').trim()
    if (!/l['’]ensemble/i.test(objet)) continue   // votes finaux sur un texte
    vusEnsemble++

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
    if (!Object.keys(parGroupe).length) { sansGroupe++; continue }

    // position majoritaire du groupe
    const groupes = {}
    for (const [nom, c] of Object.entries(parGroupe)) {
      const position = c.pour >= c.contre && c.pour >= c.abstention ? 'pour'
                     : c.contre >= c.abstention ? 'contre' : 'abstention'
      groupes[nom] = { pour: c.pour, contre: c.contre, abstention: c.abstention, nonVotant: c.nonVotant, position }
    }

    const theme = themeDe(objet)
    const type = typeDe(objet)
    const lecture = lectureDe(objet)
    textes.push({
      id: numero || f, date,
      titre: titrePropre(objet), titreOfficiel: objet,
      type, lecture, theme,
      contexte: contexteDe(numero, type, lecture, theme),
      sort: adopte ? 'adopté' : (sort ? 'rejeté' : ''),
      global, groupes,
      lienTexte: numero ? `https://www.assemblee-nationale.fr/dyn/17/scrutins/${numero}` : 'https://www.assemblee-nationale.fr/dyn/17/scrutins'
    })
  }

  ghNotice(`${vusEnsemble} votes « sur l'ensemble », ${sansGroupe} sans correspondance de groupe, ${textes.length} retenus`)
  if (!textes.length) throw new Error('aucun texte « sur l\'ensemble » retenu (sur ' + vusEnsemble + ' candidats)')
  textes.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const themes = [...new Set(textes.map(t => t.theme))]

  writeFileSync(OUT, JSON.stringify({ maj: AUJOURDHUI, legislature: 17, nbTextes: textes.length, themes, textes }), 'utf8')
  ghNotice(`✓ ${textes.length} textes écrits dans data.json`)
}

try { await main() } catch (e) { ghError('build-votes a ÉCHOUÉ : ' + e.message); process.exit(1) }

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
  ['Budget & fiscalité', /budget|finances?|fiscal|imp[oô]t|taxe|s[ée]curit[ée] sociale|\bplf\b|plfss|fin de gestion|frais bancaires|recouvrement des cr[ée]ances|op[ée]rateurs de l.[ée]tat|patrimoine immobilier de l.[ée]tat|compensation financi[eè]re/i],
  ['Travail & retraites', /travail|emploi|retraite|retrait[ée]s|ch[oô]mage|salari|pouvoir d.achat|smic|titres?.restaurant|contrat de professionnalisation|agents publics|fonctionnaires/i],
  ['Agriculture', /agricol|agricultur|agriculteur|p[eê]che|alimentation|[ée]levage|paysan|vignes|apicole|denr[ée]es alimentaires|cultures v[ée]g[ée]tales/i],
  ['Santé', /sant[ée]|h[oô]pital|m[ée]dic|m[ée]decin|soin|s[ée]curit[ée] sociale|maladie|cancer|infirmier|orthophonist|mortalit[ée] infantile|vapotage|fauteuils roulants|assurance maladie|sclérose|soignants/i],
  ['Immigration & asile', /immigration|asile|[ée]tranger|s[ée]jour|naturalisation|nationalit[ée]|r[ée]tention/i],
  ['Éducation & recherche', /[ée]ducation|[ée]cole|scolaire|[ée]l[eè]ves|universit|enseignement|recherche|[ée]tudiant/i],
  ['Sécurité & justice', /s[ée]curit[ée]|justice|p[ée]nal|d[ée]linqu|police|terroris|prison|narcotrafic|juridictions?|criminalit[ée]|criminel|procureur|plainte|violences|p[ée]docriminalit|homicide|fraudes?|avoirs saisis|s[ûu]ret[ée]|sapeurs-pompiers|nullit[ée]s|avocat/i],
  ['Environnement & énergie', /environnement|climat|[ée]nergie|nucl[ée]aire|[ée]cologi|renouvelable|pollution|eau\b|hydro[ée]lectric|plastique|chlord[ée]cone|perfluoro|frelon|montagne|v[ée]lique/i],
  ['Logement', /logement|habitat|loyer|urbanisme|locati|meubl[ée]s de tourisme|sans-abrisme|ascenseur|ascenceur|indivision|indivison|successions?/i],
  ['Économie & entreprises', /[ée]conomi|entreprise|industri|commerce|consommat|num[ée]rique|simplification|r[ée]seaux sociaux|tiktok|droits voisins|d[ée]bits de boissons|d[ée]marchage|baux commerciaux|vie ch[eè]re|moyens de paiement|transport maritime/i],
  ['Institutions & élections', /constitution|[ée]lection|r[ée]f[ée]rendum|institution|d[ée]centralisation|collectivit|scrutin|[ée]lus? locaux|[ée]lu local|mandat|candidats|affaires courantes|mayotte|nouvelle-cal[ée]donie|polyn[ée]sie|outre-mer|organique|gouvernance territoriale|vote par correspondance/i],
  ['International & défense', /d[ée]fense|arm[ée]e|militaire|international|\btrait[ée]s?\b|ukraine|union europ[ée]enne|\botan\b|gaza|brexit|biens culturels|jeux olympiques/i],
  ['Société & libertés', /bio[ée]thique|fin de vie|aide [àa] mourir|la[ïi]cit|famille|[ée]galit|discrimination|libert|enfants?|mineurs|parents|devoir conjugal|homosexualit|code noir|r[ée]union en france|crèches|creches|croix de la valeur/i]
]
const themeDe = (txt) => (THEMES.find(([, re]) => re.test(txt)) || ['Autre'])[0]

// Nettoie l'intitulé officiel en titre lisible.
function titrePropre(objet) {
  let s = objet.replace(/^l['’]ensemble\s+(de\s+)?(du |de la |des |de l['’]|d['’])?/i, '').trim()
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
    execSync(`curl -fsSL "${SCRUTINS_ZIP}" -o "${zip}"`, { stdio: 'ignore' })
    execSync(`unzip -oq "${zip}" -d "${tmp}"`, { stdio: 'ignore' })
    dir = tmp
  } catch (e) { throw new Error('Scrutins indisponibles : ' + e.message) }

  const fichiers = walkJSON(dir)
  ghNotice(`${fichiers.length} fichiers JSON extraits`)
  let vusEnsemble = 0, sansGroupe = 0
  const textes = []

  for (const f of fichiers) {
    let s
    try { s = JSON.parse(readFileSync(f, 'utf8')).scrutin } catch { continue }
    if (!s) continue
    const objet = (s.objet?.libelle || s.titre || '').trim()
    if (!/^l['’]ensemble\b/i.test(objet)) continue   // votes finaux sur un texte (pas les amendements ni les articles)
    vusEnsemble++

    const date = (s.dateScrutin || '').slice(0, 10)
    const numero = s.numero || ''
    const sort = (s.sort?.libelle || s.sort?.code || '').toLowerCase()
    const code = (s.sort?.code || '').toLowerCase()
    const adopte = code ? /^adopt/.test(code) : (/adopt/.test(sort) && !/n['’]a pas adopt/.test(sort))

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
    // Total officiel de l'Assemblée (inclut les députés remplacés depuis, absents du roster Datan)
    const dc = s.syntheseVote?.decompte
    if (dc && dc.pour != null) {
      global.pour = Number(dc.pour) || 0
      global.contre = Number(dc.contre) || 0
      global.abstention = Number(dc.abstentions) || 0
    }

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

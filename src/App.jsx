import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import Login from './Login'
import Crest from './Crest'
import Headshot from './Headshot'
import LogoEquipe from './LogoEquipe'
import { IconeFeu, IconeGlace, IconePlasteur } from './Icones'
import SelecteurJoueur from './SelecteurJoueur'
import Pastille from './Pastille'
import BoutonTheme from './Theme'
// Participants, ordre de base et rotation : une seule liste partagée avec les
// fonctions Netlify (netlify/functions/_participants.js).
import {
  PARTICIPANTS,
  ORDRE_BASE,
  NOMS,
  ADMIN_ID,
  completerOrdre,
} from '../netlify/functions/_participants.js'
import './App.css'

// Texte des délais de choix du règlement : 30 min d'écart entre chaque position
// (3 participants : 1h30 / 1h / 30 min; 4 participants : 2h / 1h30 / 1h / 30 min).
function formaterDelaiChoix(minutes) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function texteDelaisChoix() {
  const n = ORDRE_BASE.length
  return ORDRE_BASE.map((_, i) => {
    const rang = i === 0 ? '1er' : `${i + 1}e`
    return `le ${rang} choix doit être fait ${formaterDelaiChoix((n - i) * 30)} avant le match`
  })
    .join(', ')
    .replace(/, ([^,]*)$/, ' et $1')
}

// Calendrier : défile jusqu'à une tuile de match et la fait briller un instant.
// `ouvrirJoues` déplie d'abord la section « Matchs joués » (repliée par défaut).
function allerAuMatch(id, ouvrirJoues) {
  if (ouvrirJoues) {
    const section = document.getElementById('cal-joues')
    if (section) section.open = true
  }
  requestAnimationFrame(() => {
    const el = document.getElementById(id)
    if (!el) return
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'center' })
    el.classList.remove('cal-flash')
    void el.offsetWidth
    el.classList.add('cal-flash')
    setTimeout(() => el.classList.remove('cal-flash'), 2000)
  })
}

// Icônes de téléphone génériques (dessinées ici) pour distinguer les
// consignes iPhone et Android : encoche en pilule vs trou de caméra.
function IconeAppareil({ type }) {
  return (
    <svg
      className="icone-appareil"
      viewBox="0 0 24 24"
      width="1.3em"
      height="1.3em"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="5.5"
        y="1.8"
        width="13"
        height="20.4"
        rx={type === 'iphone' ? 3.4 : 2.4}
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {type === 'iphone' ? (
        <>
          <rect x="9.6" y="4.3" width="4.8" height="1.5" rx="0.75" fill="currentColor" />
          <rect x="9.8" y="19" width="4.4" height="1" rx="0.5" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="12" cy="5.2" r="0.95" fill="currentColor" />
          <rect x="10.4" y="19" width="3.2" height="1" rx="0.5" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

function saisonEnCours(date = new Date()) {
  const mois = date.getUTCMonth()
  const anneeDebut = mois >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
  return {
    libelle: `${anneeDebut}-${anneeDebut + 1}`,
    debutSaison: new Date(Date.UTC(anneeDebut, 6, 1)), // 1er juillet
  }
}

const VAPID_PUBLIC_KEY =
  'BPezOa7aC0WZoaKvBg6axfi3A1xB9iV8PPiyTJYDpOlD1bKLPm7Nd45t_bryyRg_KhPPJjQtxenXwVAbY78HLbA'

// Découpe le temps restant en jours / heures / minutes / secondes, pour
// l'afficher en blocs séparés à la manière d'une horloge d'aréna.
function partiesCompteARebours(ms) {
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  return {
    jours: Math.floor(total / 86400),
    heures: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    secondes: total % 60,
  }
}

// Chrono style tableau de pointage : panneau sombre, chiffres lumineux,
// deux-points qui clignotent à la seconde. Passe au rouge quand ça presse.
function Chrono({ ms, urgent }) {
  const p = partiesCompteARebours(ms)
  if (!p) return null

  const blocs = [
    ...(p.jours > 0 ? [{ cle: 'j', valeur: p.jours, label: 'JRS' }] : []),
    { cle: 'h', valeur: p.heures, label: 'HRS' },
    { cle: 'm', valeur: p.minutes, label: 'MIN' },
    { cle: 's', valeur: p.secondes, label: 'SEC' },
  ]

  return (
    <div className={urgent ? 'chrono urgent' : 'chrono'}>
      <div className="chrono-titre">Temps restant pour choisir</div>
      <div className="chrono-blocs">
        {blocs.map((b, i) => (
          <Fragment key={b.cle}>
            {i > 0 && <span className="chrono-sep">:</span>}
            <span className="chrono-groupe">
              <span className="chrono-bloc">
                <span className="chrono-chiffres">
                  {String(b.valeur).padStart(2, '0')}
                </span>
              </span>
              <span className="chrono-label">{b.label}</span>
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// Convertit une date UTC en heure de Montréal SANS dépendre du fuseau
// horaire du navigateur (certains navigateurs comme Brave brouillent
// volontairement ces infos pour la vie privée). On calcule nous-mêmes le
// décalage EDT/EST selon la date, puis on affiche en 'UTC' pour éviter que
// le navigateur réinterprète l'heure avec son propre fuseau.
// Jour du mois (UTC) du n-ième dimanche d'un mois (n = 1 : le premier).
function nieDimancheDuMois(annee, mois, n) {
  const jourDuPremier = new Date(Date.UTC(annee, mois, 1)).getUTCDay() // 0 = dimanche
  return 1 + ((7 - jourDuPremier) % 7) + (n - 1) * 7
}

function estHeureAvanceeEst(date) {
  // Règle exacte de l'Est (Canada / États-Unis) : l'heure avancée (EDT, UTC-4)
  // commence le 2e dimanche de mars à 2 h (heure normale) = 07:00 UTC, et finit
  // le 1er dimanche de novembre à 2 h (heure avancée) = 06:00 UTC.
  const annee = date.getUTCFullYear()
  const debut = Date.UTC(annee, 2, nieDimancheDuMois(annee, 2, 2), 7)
  const fin = Date.UTC(annee, 10, nieDimancheDuMois(annee, 10, 1), 6)
  const t = date.getTime()
  return t >= debut && t < fin
}

function versHeureMontreal(dateUTC) {
  const decalageHeures = estHeureAvanceeEst(dateUTC) ? 4 : 5
  return new Date(dateUTC.getTime() - decalageHeures * 60 * 60 * 1000)
}

function formaterDateHeureMontreal(dateUTC, options) {
  return versHeureMontreal(dateUTC).toLocaleString('fr-CA', { ...options, timeZone: 'UTC' })
}

// L'API de la NHL utilise DEUX états pour un match terminé : "FINAL" juste
// après la fin, puis "OFF" une fois le pointage officialisé. Il faut les
// deux, sinon le score n'apparaît pas pendant les heures qui suivent.
function matchTermine(statut) {
  return statut === 'OFF' || statut === 'FINAL'
}

// ===== Tri des tableaux (cliquer sur un en-tête de colonne) =====
// Au premier clic sur une colonne de texte (nom, équipe) : ordre A-Z.
// Au premier clic sur une colonne de chiffres (buts, points...) : la plus
// grande valeur en premier, ce qui est ce qu'on veut voir la plupart du
// temps ("qui a le plus de buts"). Un deuxième clic sur la même colonne
// inverse le sens.
function basculerColonneTri(triActuel, colonne, estTexte) {
  if (triActuel?.colonne === colonne) {
    return { colonne, direction: triActuel.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { colonne, direction: estTexte ? 'asc' : 'desc' }
}

function appliquerTri(liste, tri, valeurColonne) {
  if (!tri) return liste
  const triee = [...liste].sort((a, b) => {
    const va = valeurColonne(a, tri.colonne)
    const vb = valeurColonne(b, tri.colonne)
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va ?? '').localeCompare(String(vb ?? ''))
    }
    return (va ?? 0) - (vb ?? 0)
  })
  return tri.direction === 'desc' ? triee.reverse() : triee
}

// Points provisoires d'un match en cours : même règle que calculer-points
// (but = 2, passe = 1, tour du chapeau = +3), mais calculée côté site à partir
// du boxscore en direct. Rien n'est enregistré, c'est juste de l'affichage.
function pointsProvisoires(choix, statsDirect) {
  const s = statsDirect?.[choix.joueurs?.nhl_id] || { buts: 0, passes: 0 }
  const tc = s.buts >= 3
  return { buts: s.buts, passes: s.passes, points: s.buts * 2 + s.passes + (tc ? 3 : 0) }
}

// Classement du pool = points officiels en base + points provisoires du match.
function classementProvisoire(classement, choix, statsDirect) {
  const total = {}
  for (const uid of ORDRE_BASE) total[uid] = 0
  for (const c of classement) total[c.user_id] = c.points || 0
  for (const ch of choix) {
    total[ch.user_id] = (total[ch.user_id] || 0) + pointsProvisoires(ch, statsDirect).points
  }
  return Object.entries(total)
    .map(([user_id, points]) => ({ user_id, points }))
    .sort((a, b) => b.points - a.points)
}

// Points cumulés de chaque participant, match après match (du plus vieux au plus récent).
function serieCumulee(historique) {
  const parMatch = {}
  for (const r of historique) {
    if (!parMatch[r.match_id]) {
      parMatch[r.match_id] = {
        id: r.match_id,
        date: r.matchs?.date_match,
        adversaire: r.matchs?.adversaire,
        points: {},
      }
    }
    parMatch[r.match_id].points[r.user_id] = (parMatch[r.match_id].points[r.user_id] || 0) + r.points
  }
  const matchs = Object.values(parMatch).sort((a, b) => new Date(a.date) - new Date(b.date))
  const total = {}
  for (const uid of ORDRE_BASE) total[uid] = 0
  const cumul = matchs.map((m) => {
    const ligne = {}
    for (const uid of ORDRE_BASE) {
      total[uid] += m.points[uid] || 0
      ligne[uid] = total[uid]
    }
    return ligne
  })
  return { matchs, cumul }
}

// Trophées de la saison, calculés à partir de l'historique. Retourne seulement
// ceux qui ont au moins un gagnant.
function calculerTrophees(historique) {
  const { matchs } = serieCumulee(historique)
  const trophees = []
  const noms = (uids) => uids.map((u) => NOMS[u] || 'Inconnu').join(' et ')
  const meilleurs = (compte, minimum = 1) => {
    const max = Math.max(...ORDRE_BASE.map((u) => compte[u] || 0))
    if (max < minimum) return null
    return { max, uids: ORDRE_BASE.filter((u) => (compte[u] || 0) === max) }
  }

  // 🎩 Roi du chapeau
  const chapeaux = {}
  for (const r of historique) if (r.tour_chapeau) chapeaux[r.user_id] = (chapeaux[r.user_id] || 0) + 1
  const roi = meilleurs(chapeaux)
  if (roi) {
    trophees.push({
      icone: '🎩',
      titre: 'Roi du chapeau',
      gagnant: noms(roi.uids),
      detail: `${roi.max} tour${roi.max > 1 ? 's' : ''} du chapeau`,
    })
  }

  // 🎯 Devin du pool (le plus de pointages devinés exactement)
  const devins = {}
  for (const r of historique) if ((r.bonus || 0) > 0) devins[r.user_id] = (devins[r.user_id] || 0) + 1
  const devin = meilleurs(devins)
  if (devin) {
    trophees.push({
      icone: '🎯',
      titre: 'Devin du pool',
      gagnant: noms(devin.uids),
      detail: `${devin.max} pointage${devin.max > 1 ? 's' : ''} exact${devin.max > 1 ? 's' : ''}`,
    })
  }

  // 💥 Meilleur match (plus de points en un match avec un seul joueur, sans le bonus du pointage deviné)
  const pointsJoueur = (r) => r.points - (r.bonus || 0)
  const meilleur = [...historique].sort((a, b) => pointsJoueur(b) - pointsJoueur(a))[0]
  if (meilleur && pointsJoueur(meilleur) > 0) {
    trophees.push({
      icone: '💥',
      titre: 'Meilleur match',
      gagnant: NOMS[meilleur.user_id] || 'Inconnu',
      detail: `${pointsJoueur(meilleur)} pts avec ${meilleur.joueurs?.nom || '?'}`,
    })
  }

  // 🥇 Le plus de matchs gagnés (seulement si un seul gagnant dans le match)
  const victoires = {}
  for (const m of matchs) {
    const pts = ORDRE_BASE.map((u) => m.points[u] || 0)
    const top = Math.max(...pts)
    const gagnants = ORDRE_BASE.filter((u) => (m.points[u] || 0) === top)
    if (top > 0 && gagnants.length === 1) victoires[gagnants[0]] = (victoires[gagnants[0]] || 0) + 1
  }
  const roiVictoires = meilleurs(victoires)
  if (roiVictoires) {
    trophees.push({
      icone: '🥇',
      titre: 'Plus de matchs gagnés',
      gagnant: noms(roiVictoires.uids),
      detail: `${roiVictoires.max} match${roiVictoires.max > 1 ? 's' : ''}`,
    })
  }

  // 🔥 Plus longue série de matchs avec au moins 1 point
  const series = {}
  for (const uid of ORDRE_BASE) {
    let courante = 0
    let max = 0
    for (const m of matchs) {
      if (m.points[uid] !== undefined && m.points[uid] > 0) {
        courante += 1
        max = Math.max(max, courante)
      } else {
        courante = 0
      }
    }
    series[uid] = max
  }
  const roiSerie = meilleurs(series, 2)
  if (roiSerie) {
    trophees.push({
      icone: '🔥',
      titre: 'Plus longue série',
      gagnant: noms(roiSerie.uids),
      detail: `${roiSerie.max} matchs de suite avec des points`,
    })
  }

  // 🧊 Le plus de matchs à 0 point
  const zeros = {}
  for (const m of matchs) {
    for (const uid of ORDRE_BASE) {
      if (m.points[uid] !== undefined && m.points[uid] === 0) zeros[uid] = (zeros[uid] || 0) + 1
    }
  }
  const malchanceux = meilleurs(zeros)
  if (malchanceux) {
    trophees.push({
      icone: '🧊',
      titre: 'Le plus malchanceux',
      gagnant: noms(malchanceux.uids),
      detail: `${malchanceux.max} match${malchanceux.max > 1 ? 's' : ''} à 0 point`,
    })
  }

  return trophees
}

const VARIABLE_COULEUR = Object.fromEntries(
  PARTICIPANTS.map((p) => [p.id, `var(--serie-${p.serie})`])
)

// Courbe des points cumulés. SVG maison, sans bibliothèque. Toucher/survoler
// une colonne affiche le détail du match; une vue en tableau est disponible.
function CourbeClassement({ historique }) {
  const [survol, setSurvol] = useState(null)
  const { matchs, cumul } = serieCumulee(historique)
  if (matchs.length === 0) return null

  const L = 320
  const H = 190
  const marge = { g: 30, d: 58, h: 12, b: 26 }
  const largeurUtile = L - marge.g - marge.d
  const hauteurUtile = H - marge.h - marge.b
  const maxBrut = Math.max(1, ...cumul.flatMap((l) => ORDRE_BASE.map((u) => l[u])))
  const pas = maxBrut <= 10 ? 2 : maxBrut <= 30 ? 5 : maxBrut <= 60 ? 10 : 20
  const maxY = Math.ceil(maxBrut / pas) * pas
  const x = (i) =>
    matchs.length === 1 ? marge.g + largeurUtile / 2 : marge.g + (i * largeurUtile) / (matchs.length - 1)
  const y = (v) => marge.h + hauteurUtile - (v / maxY) * hauteurUtile
  const graduations = []
  for (let v = 0; v <= maxY; v += pas) graduations.push(v)
  const dateCourte = (d) =>
    d ? formaterDateHeureMontreal(new Date(d), { day: 'numeric', month: 'short' }) : ''

  // Étiquettes de fin de ligne, espacées d'au moins 12px pour ne pas se chevaucher
  const dernier = cumul[cumul.length - 1]
  const etiquettes = ORDRE_BASE.map((u) => ({ uid: u, valeur: dernier[u], y: y(dernier[u]) })).sort(
    (a, b) => a.y - b.y
  )
  for (let i = 1; i < etiquettes.length; i++) {
    if (etiquettes[i].y - etiquettes[i - 1].y < 13) etiquettes[i].y = etiquettes[i - 1].y + 13
  }

  const actif = survol !== null ? survol : matchs.length - 1
  const pasEtiquetteX = Math.ceil(matchs.length / 6)

  return (
    <details className="repliable courbe-classement" open>
      <summary className="repliable-titre">📈 Évolution du classement</summary>
      <div className="courbe-legende">
        {ORDRE_BASE.map((u) => (
          <span key={u} className="courbe-legende-item">
            <span className="courbe-legende-trait" style={{ background: VARIABLE_COULEUR[u] }} />
            {NOMS[u]}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${L} ${H}`} className="courbe-svg" role="img" aria-label="Points cumulés par participant, match après match">
        {graduations.map((v) => (
          <g key={v}>
            <line x1={marge.g} x2={L - marge.d} y1={y(v)} y2={y(v)} className="courbe-grille" />
            <text x={marge.g - 6} y={y(v) + 3} textAnchor="end" className="courbe-axe">
              {v}
            </text>
          </g>
        ))}
        {matchs.map((m, i) =>
          i % pasEtiquetteX === 0 || i === matchs.length - 1 ? (
            <text key={m.id} x={x(i)} y={H - 8} textAnchor="middle" className="courbe-axe">
              {dateCourte(m.date)}
            </text>
          ) : null
        )}
        <line x1={x(actif)} x2={x(actif)} y1={marge.h} y2={marge.h + hauteurUtile} className="courbe-repere" />
        {ORDRE_BASE.map((u) => (
          <g key={u}>
            {matchs.length > 1 && (
              <polyline
                points={cumul.map((l, i) => `${x(i)},${y(l[u])}`).join(' ')}
                fill="none"
                stroke={VARIABLE_COULEUR[u]}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {cumul.map((l, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(l[u])}
                r={i === actif ? 4.5 : 3}
                fill={VARIABLE_COULEUR[u]}
                className="courbe-point"
              />
            ))}
          </g>
        ))}
        {etiquettes.map((e) => (
          <text key={e.uid} x={L - marge.d + 8} y={e.y + 3} className="courbe-etiquette" fill="currentColor">
            {NOMS[e.uid]} {e.valeur}
          </text>
        ))}
        {matchs.map((m, i) => (
          <rect
            key={m.id}
            x={x(i) - largeurUtile / Math.max(1, matchs.length - 1) / 2}
            y={marge.h}
            width={Math.max(24, largeurUtile / Math.max(1, matchs.length - 1))}
            height={hauteurUtile}
            fill="transparent"
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
            onClick={() => setSurvol(i)}
          />
        ))}
      </svg>
      <p className="courbe-detail">
        <strong>
          vs {matchs[actif].adversaire} · {dateCourte(matchs[actif].date)}
        </strong>
        {' : '}
        {[...ORDRE_BASE]
          .sort((a, b) => cumul[actif][b] - cumul[actif][a])
          .map((u) => `${NOMS[u]} ${cumul[actif][u]} pts`)
          .join(' · ')}
      </p>
      <details className="courbe-tableau">
        <summary>Voir en tableau</summary>
        <div className="table-stats-conteneur">
          <table className="table-stats">
            <thead>
              <tr>
                <th>Match</th>
                {ORDRE_BASE.map((u) => (
                  <th key={u}>{NOMS[u]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchs.map((m, i) => (
                <tr key={m.id}>
                  <td>
                    {dateCourte(m.date)} vs {m.adversaire}
                  </td>
                  {ORDRE_BASE.map((u) => (
                    <td key={u}>{cumul[i][u]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </details>
  )
}

function Trophees({ historique }) {
  const liste = calculerTrophees(historique)
  if (liste.length === 0) return null
  return (
    <details className="repliable trophees" open>
      <summary className="repliable-titre">🏅 Trophées de la saison</summary>
      <div className="trophees-grille">
        {liste.map((t) => (
          <div key={t.titre} className="trophee">
            <span className="trophee-icone">{t.icone}</span>
            <span className="trophee-titre">{t.titre}</span>
            <span className="trophee-gagnant">{t.gagnant}</span>
            <span className="trophee-detail">{t.detail}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

// Retrouve le dernier match joué à partir des lignes brutes d'historique
// (même regroupement que HistoriqueOnglet, en gardant juste le plus récent).
function dernierMatchDeHistorique(historique) {
  if (!historique || historique.length === 0) return null
  const parMatch = {}
  for (const r of historique) {
    const cle = r.match_id
    if (!parMatch[cle]) {
      parMatch[cle] = { date: r.matchs?.date_match, adversaire: r.matchs?.adversaire, choix: [] }
    }
    parMatch[cle].choix.push(r)
  }
  const matchs = Object.values(parMatch).sort((a, b) => new Date(b.date) - new Date(a.date))
  return matchs[0] || null
}

// Construit le petit résumé texte à coller dans le groupe de texto : le
// classement actuel, et le détail du dernier match s'il y en a un.
function genererResumeClassement(classement, dernierMatch) {
  const medailles = ['🥇', '🥈', '🥉']
  const lignesClassement = classement.map((c, i) => {
    const rang = medailles[i] || `${i + 1}.`
    return `${rang} ${NOMS[c.user_id] || 'Inconnu'} — ${c.points} pts`
  })

  let texte = `🏒 POOL DE HOCKEY — CLASSEMENT\n\n${lignesClassement.join('\n')}`

  if (dernierMatch) {
    const dateTexte = dernierMatch.date
      ? formaterDateHeureMontreal(new Date(dernierMatch.date), { day: 'numeric', month: 'long' })
      : ''
    const lignesChoix = dernierMatch.choix
      .slice()
      .sort((a, b) => b.points - a.points)
      .map((c) => `• ${NOMS[c.user_id] || 'Inconnu'} → ${c.joueurs?.nom || '?'} (${c.points} pts${c.bonus > 0 ? `, dont 🎯 +${c.bonus}` : ''})`)
    texte += `\n\nDernier match : vs ${dernierMatch.adversaire}${dateTexte ? ` (${dateTexte})` : ''}\n${lignesChoix.join('\n')}`
  }

  return texte
}

// Petite fenêtre qui affiche le résumé généré, avec un bouton pour le
// copier dans le presse-papier (ou le sélectionner à la main si le
// navigateur refuse l'accès au presse-papier).
function PartageResume({ texte, onFermer }) {
  const [copie, setCopie] = useState(false)
  const zoneRef = useRef(null)

  if (!texte) return null

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte)
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      zoneRef.current?.select()
    }
  }

  return (
    <div className="fiche-joueur-fond" onClick={onFermer}>
      <div className="partage-resume-carte" onClick={(e) => e.stopPropagation()}>
        <button className="fiche-joueur-fermer" onClick={onFermer} aria-label="Fermer">
          ✕
        </button>
        <h3 className="partage-resume-titre">Résumé à partager</h3>
        <textarea ref={zoneRef} className="partage-resume-zone" readOnly value={texte} />
        <button className="bouton-copier" onClick={copier}>
          {copie ? '✓ Copié dans le presse-papier' : '📋 Copier'}
        </button>
        <p className="partage-resume-astuce">Colle ça dans votre groupe de texto!</p>
      </div>
    </div>
  )
}

// Fenêtre d'annonce (réservée à Eric) : écrire un texte, l'envoyer en
// notification à tout le monde.
function AnnonceModal({ ouverte, accessToken, onFermer }) {
  const [texte, setTexte] = useState('')
  const [destinataire, setDestinataire] = useState('tous')
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState('')

  if (!ouverte) return null

  async function envoyer() {
    setEnCours(true)
    setResultat('')
    try {
      const res = await fetch('/.netlify/functions/annonce', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ texte, destinataire }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResultat(`❌ ${data.erreur || data.error || `Erreur ${res.status}`}`)
      } else {
        const manquants = data.pasRecus?.length
          ? ` (pas reçu : ${data.pasRecus.join(', ')}, notifications pas activées)`
          : ''
        setResultat(
          data.envoyes === 0
            ? `⚠️ Personne n'a reçu le message${manquants}`
            : `✓ Envoyé à ${data.envoyes} personne(s)${manquants}`
        )
        setTexte('')
      }
    } catch (err) {
      setResultat(`❌ ${err.message}`)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="fiche-joueur-fond" onClick={onFermer}>
      <div className="partage-resume-carte" onClick={(e) => e.stopPropagation()}>
        <button className="fiche-joueur-fermer" onClick={onFermer} aria-label="Fermer">
          ✕
        </button>
        <h3 className="partage-resume-titre">📣 Annonce</h3>
        <label className="annonce-destinataire">
          Envoyer à :{' '}
          <select value={destinataire} onChange={(e) => setDestinataire(e.target.value)}>
            <option value="tous">Tout le monde</option>
            {ORDRE_BASE.map((uid) => (
              <option key={uid} value={uid}>
                {NOMS[uid]}
              </option>
            ))}
          </select>
        </label>
        <textarea
          className="partage-resume-zone"
          placeholder="Écris ton message ici..."
          maxLength={300}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        <button
          className="bouton-copier"
          onClick={envoyer}
          disabled={enCours || texte.trim().length === 0}
        >
          {enCours ? '⏳ Envoi...' : destinataire === 'tous' ? '📤 Envoyer à tout le monde' : `📤 Envoyer à ${NOMS[destinataire]}`}
        </button>
        {resultat && <p className="partage-resume-astuce">{resultat}</p>}
      </div>
    </div>
  )
}

// Assistant pas-à-pas pour iPhone : Apple interdit à un site de s'ajouter tout
// seul à l'écran d'accueil, alors on guide la personne, une étape à la fois.
function GuideIphone({ ouverte, horsSafari, onFermer }) {
  const [etape, setEtape] = useState(0)
  if (!ouverte) return null

  const etapes = [
    ...(horsSafari
      ? [
          {
            icone: '🧭',
            texte:
              'Copie ce lien : **https://pool-hockey.netlify.app**. Ouvre **Safari** (la boussole bleue), appuie dans la **barre de recherche en haut**, colle le lien (appui long → Coller) et appuie sur **Aller**.',
          },
        ]
      : []),
    {
      icone: '⬆️',
      texte: "Appuie sur le bouton **Partager** (le carré avec une flèche vers le haut), en bas de l'écran.",
    },
    {
      icone: '➕',
      texte: "Descends et appuie sur **« Sur l'écran d'accueil »**, puis sur **Ajouter**.",
    },
    {
      icone: '📲',
      texte: 'Ferme Safari et ouvre **Pool de Hockey** avec la nouvelle icône sur ton écran d\'accueil.',
    },
    {
      icone: '🔔',
      texte:
        'Dans l\'app, appuie sur **🔔 Activer** puis **Autoriser**. Tu vas recevoir une **notification de test**. Si tu ne la reçois pas, **contacte Eric** : les notifications sont obligatoires.',
    },
  ]
  const derniere = etape === etapes.length - 1
  const courante = etapes[etape]

  function fermer() {
    setEtape(0)
    onFermer()
  }

  return (
    <div className="fiche-joueur-fond" onClick={fermer}>
      <div className="partage-resume-carte" onClick={(e) => e.stopPropagation()}>
        <button className="fiche-joueur-fermer" onClick={fermer} aria-label="Fermer">
          ✕
        </button>
        <h3 className="partage-resume-titre">📱 Activer les notifications</h3>
        <p className="guide-compteur">
          Étape {etape + 1} sur {etapes.length}
        </p>
        <div className="guide-etape">
          <div className="guide-icone">{courante.icone}</div>
          <p>
            {courante.texte
              .split('**')
              .map((morceau, j) => (j % 2 ? <strong key={j}>{morceau}</strong> : morceau))}
          </p>
        </div>
        <button className="bouton-copier" onClick={derniere ? fermer : () => setEtape(etape + 1)}>
          {derniere ? "✅ J'ai compris" : "✅ C'est fait, suivant"}
        </button>
        {etape > 0 && (
          <button className="bouton-lien guide-retour" onClick={() => setEtape(etape - 1)}>
            ← Retour
          </button>
        )}
      </div>
    </div>
  )
}

// Après l'activation : on demande si la notification de test est arrivée.
function ConfirmationTest({ etat, onReponse }) {
  if (!etat) return null
  return (
    <div className="fiche-joueur-fond">
      <div className="partage-resume-carte">
        <h3 className="partage-resume-titre">🔔 Test des notifications</h3>
        {etat === 'demande' && (
          <>
            <p className="guide-etape">
              Une notification de test vient d'être envoyée. <strong>Est-ce que tu l'as reçue?</strong>
            </p>
            <button className="bouton-copier" onClick={() => onReponse('oui')}>
              ✅ Oui, je l'ai reçue
            </button>
            <button className="bouton-lien guide-retour" onClick={() => onReponse('non')}>
              ❌ Non, rien reçu
            </button>
          </>
        )}
        {etat === 'oui' && (
          <>
            <p className="guide-etape">🎉 Parfait, tout fonctionne!</p>
            <button className="bouton-copier" onClick={() => onReponse('fin')}>
              Fermer
            </button>
          </>
        )}
        {etat === 'non' && (
          <>
            <p className="guide-etape">
              ⚠️ Ça n'a pas fonctionné. <strong>Contacte Eric</strong> : les notifications sont
              obligatoires pour une bonne communication dans le pool.
            </p>
            <button className="bouton-copier" onClick={() => onReponse('fin')}>
              Fermer
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Grande carte avec photo + stats d'un joueur, ouverte en cliquant sur son
// nom dans Stats CH ou Stats LNH. Les champs optionnels (tours_chapeau,
// forme, plus_minus, pun...) ne s'affichent que s'ils existent, pour servir
// les deux tableaux sans dupliquer le composant.
function FicheJoueur({ joueur, onFermer }) {
  if (!joueur) return null
  return (
    <div className="fiche-joueur-fond" onClick={onFermer}>
      <div className="fiche-joueur-carte" onClick={(e) => e.stopPropagation()}>
        <button className="fiche-joueur-fermer" onClick={onFermer} aria-label="Fermer">
          ✕
        </button>
        <Headshot nhlId={joueur.playerId} taille={96} />
        <h3 className="fiche-joueur-nom">{joueur.nom}</h3>
        <p className="fiche-joueur-sous-titre">
          {joueur.equipe && <LogoEquipe abbrev={joueur.equipe} taille={20} />}
          {joueur.equipe}
          {joueur.position ? ` · ${joueur.position}` : ''}
        </p>
        <div className="fiche-joueur-stats">
          <div className="fiche-joueur-case">
            <span className="fiche-joueur-valeur">{joueur.matchs_joues}</span>
            <span className="fiche-joueur-label">PJ</span>
          </div>
          <div className="fiche-joueur-case">
            <span className="fiche-joueur-valeur">{joueur.buts}</span>
            <span className="fiche-joueur-label">Buts</span>
          </div>
          <div className="fiche-joueur-case">
            <span className="fiche-joueur-valeur">{joueur.passes}</span>
            <span className="fiche-joueur-label">Passes</span>
          </div>
          <div className="fiche-joueur-case">
            <span className="fiche-joueur-valeur">{joueur.points}</span>
            <span className="fiche-joueur-label">Points</span>
          </div>
          {joueur.tours_chapeau !== undefined && (
            <div className="fiche-joueur-case">
              <span className="fiche-joueur-valeur">{joueur.tours_chapeau}</span>
              <span className="fiche-joueur-label">Tours du chapeau</span>
            </div>
          )}
          {joueur.plus_minus !== undefined && (
            <div className="fiche-joueur-case">
              <span className="fiche-joueur-valeur">
                {joueur.plus_minus > 0 ? `+${joueur.plus_minus}` : joueur.plus_minus}
              </span>
              <span className="fiche-joueur-label">+/-</span>
            </div>
          )}
          {joueur.pun !== undefined && (
            <div className="fiche-joueur-case">
              <span className="fiche-joueur-valeur">{joueur.pun}</span>
              <span className="fiche-joueur-label">PUN</span>
            </div>
          )}
        </div>
        {joueur.forme === 'chaud' && (
          <p className="fiche-joueur-forme">
            <IconeFeu /> En feu depuis 5 matchs
          </p>
        )}
        {joueur.forme === 'froid' && (
          <p className="fiche-joueur-forme">
            <IconeGlace /> Dans un creux depuis 5 matchs
          </p>
        )}
        {joueur.blesse ? (
          <p className="fiche-joueur-forme">
            <IconePlasteur /> Possiblement blessé
          </p>
        ) : null}
      </div>
    </div>
  )
}

// En-tête de colonne cliquable, avec la petite flèche qui indique le tri actif.
function ThTriable({ colonne, tri, onTrier, estTexte, enfant }) {
  const actif = tri?.colonne === colonne
  return (
    <th
      className="th-triable"
      onClick={() => onTrier(basculerColonneTri(tri, colonne, estTexte))}
    >
      {enfant}
      <span className="fleche-tri">{actif ? (tri.direction === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </th>
  )
}

// Confettis de célébration, en CSS pur (aucune librairie externe). Les
// morceaux sont générés une seule fois au montage pour qu'ils ne sautillent
// pas quand le reste de la page se rafraîchit (le compte à rebours
// re-rend la page à chaque seconde).
const COULEURS_CONFETTIS = ['#ce0e2d', '#0c1e3d', '#ffffff', '#d4af37', '#2f5bb8']

function Confettis() {
  const [morceaux] = useState(() =>
    Array.from({ length: 50 }, (_, i) => ({
      gauche: Math.random() * 100,
      delai: Math.random() * 0.7,
      duree: 2.4 + Math.random() * 1.6,
      couleur: COULEURS_CONFETTIS[i % COULEURS_CONFETTIS.length],
      rotation: 360 + Math.random() * 720,
      derive: Math.random() * 120 - 60,
    }))
  )

  return (
    <div className="confettis" aria-hidden="true">
      {morceaux.map((m, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${m.gauche}%`,
            background: m.couleur,
            animationDelay: `${m.delai}s`,
            animationDuration: `${m.duree}s`,
            '--rot': `${m.rotation}deg`,
            '--derive': `${m.derive}px`,
          }}
        />
      ))}
    </div>
  )
}

// Avertissement affiché en haut de la page. Se referme tout seul après
// quelques secondes (une petite barre montre le temps qui reste) ou
// immédiatement avec le bouton ×.
const DUREE_ALERTE_MS = 9000

function Alerte({ message, onFermer }) {
  // On garde la fonction de fermeture dans une référence pour que la
  // minuterie ne reparte pas à zéro à chaque re-rendu de la page (le
  // compte à rebours en provoque un à la seconde).
  const fermerRef = useRef(onFermer)

  // Mis à jour après chaque rendu (jamais pendant), pour rester correct
  // avec le rendu concurrent de React.
  useEffect(() => {
    fermerRef.current = onFermer
  })

  useEffect(() => {
    const minuterie = setTimeout(() => fermerRef.current(), DUREE_ALERTE_MS)
    return () => clearTimeout(minuterie)
  }, [message])

  return (
    <div className="alerte" role="alert">
      <p className="alerte-texte">{message}</p>
      <button
        type="button"
        className="alerte-fermer"
        onClick={() => fermerRef.current()}
        aria-label="Fermer l'avertissement"
      >
        ×
      </button>
      <span className="alerte-jauge" />
    </div>
  )
}

// Tableau de pointage pendant et après le match. Affiche un point rouge
// qui bat quand c'est en direct, et la période en cours.
function libellePeriode(periode, typePeriode, termine) {
  if (typePeriode === 'SO') return termine ? 'Fusillade' : 'Fusillade en cours'
  if (typePeriode === 'OT') return termine ? 'Prolongation' : 'Prolongation'
  if (!periode) return termine ? 'Terminé' : ''
  if (termine) return 'Terminé'
  return `${periode}${periode === 1 ? 're' : 'e'} période`
}

function TableauDirect({ infos, adversaire }) {
  if (!infos) return null
  const termine = matchTermine(infos.statut)
  const scoreMtl = infos.score_mtl ?? 0
  const scoreAdv = infos.score_adversaire ?? 0
  const gagne = termine && scoreMtl > scoreAdv

  return (
    <div className={infos.en_direct ? 'direct direct-actif' : 'direct'}>
      <div className="direct-entete">
        {infos.en_direct && <span className="direct-point" aria-hidden="true" />}
        <span className="direct-etiquette">
          {infos.en_direct ? 'EN DIRECT' : termine ? 'FINAL' : 'MATCH COMMENCÉ'}
        </span>
        {libellePeriode(infos.periode, infos.type_periode, termine) && (
          <span className="direct-periode">
            · {libellePeriode(infos.periode, infos.type_periode, termine)}
          </span>
        )}
      </div>
      <div className="direct-pointage">
        <span className="direct-equipe">
          <LogoEquipe abbrev="MTL" taille={30} />
          MTL
        </span>
        <span className={gagne ? 'direct-score gagnant' : 'direct-score'}>{scoreMtl}</span>
        <span className="direct-tiret">—</span>
        <span className={termine && !gagne && scoreAdv > scoreMtl ? 'direct-score gagnant' : 'direct-score'}>
          {scoreAdv}
        </span>
        <span className="direct-equipe">
          <LogoEquipe abbrev={adversaire} taille={30} />
          {adversaire}
        </span>
      </div>
    </div>
  )
}

// Podium : la 1re place sur le bloc le plus haut au centre, l'argent à
// gauche, le bronze à droite. Les blocs poussent du bas en s'affichant.
function Podium({ classement }) {
  const [premier, deuxieme, troisieme] = classement
  // Ordre visuel du podium (2 - 1 - 3), pas l'ordre du classement
  const marches = [
    { place: 2, entree: deuxieme, medaille: '🥈', classe: 'argent' },
    { place: 1, entree: premier, medaille: '🥇', classe: 'or' },
    { place: 3, entree: troisieme, medaille: '🥉', classe: 'bronze' },
  ].filter((m) => m.entree)

  return (
    <div className="podium">
      {marches.map((m) => (
        <div key={m.place} className="podium-colonne">
          <span className="podium-medaille">{m.medaille}</span>
          <Pastille userId={m.entree.user_id} nom={NOMS[m.entree.user_id]} taille={38} />
          <span className="podium-nom">{NOMS[m.entree.user_id] || 'Inconnu'}</span>
          <div className={`podium-bloc podium-${m.classe}`}>
            <span className="podium-points">{m.entree.points}</span>
            <span className="podium-pts-label">PTS</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// Squelette de chargement (shimmer) affiché pendant qu'on attend les
// données, à la place d'un simple texte "Chargement...".
function Squelette({ lignes = 4, hauteur = 46 }) {
  return (
    <div className="squelette-groupe">
      {Array.from({ length: lignes }).map((_, i) => (
        <div key={i} className="squelette-ligne" style={{ height: hauteur }} />
      ))}
    </div>
  )
}

// Messenger / Facebook / Instagram ouvrent les liens dans un mini-navigateur
// où les notifications et l'installation ne fonctionnent pas.
const URL_SITE = 'https://pool-hockey.netlify.app'
// Notifications seulement sur téléphone/tablette : rien à afficher sur ordinateur
const EST_MOBILE =
  /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
function estNavigateurIntegre() {
  return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Snapchat|Line\//i.test(navigator.userAgent)
}

function NavigateurIntegre({ onContinuer }) {
  const [copie, setCopie] = useState(false)
  const estAndroid = /android/i.test(navigator.userAgent)

  function ouvrirChrome() {
    window.location.href = `intent://${URL_SITE.replace('https://', '')}/#Intent;scheme=https;package=com.android.chrome;end`
  }

  async function copierLien() {
    try {
      await navigator.clipboard.writeText(URL_SITE)
      setCopie(true)
    } catch {
      // pas grave
    }
  }

  return (
    <div className="ecran-centre">
      <div className="partage-resume-carte" style={{ textAlign: 'center' }}>
        <div className="guide-icone">⚠️</div>
        <h3 className="partage-resume-titre">Ouvre le site dans ton navigateur</h3>
        <p className="regle-alerte">Sinon les notifications ne fonctionneront pas</p>
        <p className="guide-etape">
          Tu es dans le mini-navigateur de Messenger. Pour activer les notifications, il faut ouvrir le
          site dans {estAndroid ? 'Chrome' : 'Safari'}.
        </p>
        {estAndroid ? (
          <>
            <button className="bouton-copier" onClick={ouvrirChrome}>
              🌐 Ouvrir dans Chrome
            </button>
            <p className="guide-etape">
              Ça ne marche pas? Appuie sur les <strong>⋯</strong> (3 points) en haut à droite, puis{' '}
              <strong>« Ouvrir dans le navigateur »</strong>.
            </p>
          </>
        ) : (
          <p className="guide-etape">
            1. Appuie sur les <strong>⋯</strong> (3 points) en haut à droite
            <br />
            2. Choisis <strong>« Ouvrir dans Safari »</strong>
          </p>
        )}
        <button className="bouton-lien guide-retour" onClick={copierLien}>
          {copie ? '✅ Lien copié' : '📋 Copier le lien'}
        </button>
        <button className="bouton-lien guide-retour" onClick={onContinuer}>
          Continuer quand même
        </button>
      </div>
    </div>
  )
}

// ===== Classement LNH : qualification pour les séries =====
// 16 équipes sur 32 : les 3 premières de chaque division + 2 cartes sauvages
// par conférence (les 2 meilleures équipes restantes de la conférence).
const CONFERENCE_PAR_DIVISION = {
  Atlantique: 'Est',
  Métropolitaine: 'Est',
  Centrale: 'Ouest',
  Pacifique: 'Ouest',
}

function conferenceDe(e) {
  return e.conference || CONFERENCE_PAR_DIVISION[e.division] || ''
}

function calculerQualifications(equipes) {
  const qualifs = {}
  const parConference = {}
  for (const e of equipes) {
    const c = conferenceDe(e)
    if (!parConference[c]) parConference[c] = []
    parConference[c].push(e)
  }
  for (const liste of Object.values(parConference)) {
    const restantes = []
    for (const e of liste) {
      if (e.rang_division <= 3) qualifs[e.abbrev] = { type: 'div', libelle: '✔' }
      else restantes.push(e)
    }
    restantes.sort(
      (a, b) => b.points - a.points || b.victoires - a.victoires || b.differentiel - a.differentiel
    )
    restantes.slice(0, 2).forEach((e, i) => {
      qualifs[e.abbrev] = { type: 'wc', libelle: `WC${i + 1}` }
    })
  }
  return qualifs
}

function EquipeNhlLigne({ e, rang, qualif }) {
  return (
    <tr className={(e.abbrev === 'MTL' ? 'ligne-mtl ' : '') + (qualif ? 'qualifiee qualifiee-' + qualif.type : '')}>
      <td>{rang}</td>
      <td className="classement-nhl-equipe">
        <LogoEquipe abbrev={e.abbrev} taille={22} />
        {e.nom}
        {qualif && <span className={'badge-series badge-' + qualif.type}>{qualif.libelle}</span>}
      </td>
      <td>{e.matchs_joues}</td>
      <td>{e.victoires}</td>
      <td>{e.defaites}</td>
      <td>{e.defaites_prolongation}</td>
      <td className="col-cle">{e.points}</td>
      <td>{e.differentiel > 0 ? `+${e.differentiel}` : e.differentiel}</td>
    </tr>
  )
}

// equipes déjà dans l'ordre par défaut ; ligneApres = nombre d'équipes avant
// la ligne « séries » (affichée seulement quand aucun tri n'est choisi).
function TableauNhl({ equipes, rangs, qualifs, tri, onTrier, ligneApres }) {
  const lignes = tri
    ? appliquerTri(equipes, tri, (e, col) => e[col]).map((e, i) => ({ e, rang: i + 1 }))
    : equipes.map((e, i) => ({ e, rang: rangs ? rangs[i] : i + 1 }))
  return (
    <div className="table-stats-conteneur">
      <table className="table-stats">
        <thead>
          <tr>
            <th>#</th>
            <ThTriable colonne="nom" tri={tri} onTrier={onTrier} estTexte enfant="Équipe" />
            <ThTriable colonne="matchs_joues" tri={tri} onTrier={onTrier} enfant="PJ" />
            <ThTriable colonne="victoires" tri={tri} onTrier={onTrier} enfant="V" />
            <ThTriable colonne="defaites" tri={tri} onTrier={onTrier} enfant="D" />
            <ThTriable colonne="defaites_prolongation" tri={tri} onTrier={onTrier} enfant="DP" />
            <ThTriable colonne="points" tri={tri} onTrier={onTrier} enfant="Pts" />
            <ThTriable colonne="differentiel" tri={tri} onTrier={onTrier} enfant="Diff" />
          </tr>
        </thead>
        <tbody>
          {lignes.map(({ e, rang }, i) => (
            <Fragment key={e.abbrev}>
              <EquipeNhlLigne e={e} rang={rang} qualif={qualifs[e.abbrev]} />
              {!tri && ligneApres != null && i === ligneApres - 1 && i < lignes.length - 1 && (
                <tr className="ligne-series">
                  <td colSpan={8}>
                    <span>▲ Dans les séries</span>
                    <span>Hors des séries ▼</span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [ignorerNavigateur, setIgnorerNavigateur] = useState(false)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        setChargement(false)
      })
      .catch(() => setChargement(false)) // pas de session lisible : on affiche la connexion
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (estNavigateurIntegre() && !ignorerNavigateur) {
    return <NavigateurIntegre onContinuer={() => setIgnorerNavigateur(true)} />
  }
  if (chargement) return <div className="ecran-centre" />
  if (!session) return <Login />

  return <Pool session={session} />
}

// Lit la réponse d'une fonction Netlify et sort un message clair si ça ne marche pas
// (fonction pas encore publiée = 404 en HTML, erreur du serveur, etc.).
async function lireReponseFonction(res, nomFonction) {
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (res.ok && data) return data
  if (res.status === 401) {
    throw new Error(
      'Ta session a expiré. Ferme le site et rouvre-le, ou fais ☰ → Déconnexion puis reconnecte-toi.'
    )
  }
  if (res.status === 404 || !data) {
    throw new Error(
      `La fonction « ${nomFonction} » n’est pas encore publiée (fichier à uploader dans netlify/functions, puis attendre « Published »).`
    )
  }
  // Une fonction qui plante côté Netlify répond en JSON avec errorMessage
  throw new Error(data.erreur || data.error || data.errorMessage || `Erreur ${res.status}`)
}

// Vrai si une nouvelle version du site a été publiée depuis que cette page est
// ouverte : le fichier JS référencé par le index.html du serveur n'est plus
// celui qui tourne ici. (En développement local, il n'y a pas de fichier
// /assets/index-xxx.js : on répond « non ».)
async function nouvelleVersionDisponible() {
  try {
    const actuel = [...document.scripts]
      .map((s) => s.src)
      .find((src) => /\/assets\/index-[^/]+\.js$/.test(src))
    if (!actuel) return false
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })
    const html = await res.text()
    const publie = html.match(/\/assets\/index-[^"'\s]+\.js/)
    return !!publie && !actuel.endsWith(publie[0])
  } catch {
    return false
  }
}

// Appelle une fonction Netlify avec une clé de connexion TOUJOURS fraîche.
// getSession() renouvelle tout seul une clé expirée; si le serveur répond quand
// même 401, on force un renouvellement et on réessaie une fois.
// (Avant, « Devine le pointage » gardait la clé du premier chargement : après
// ~1 h elle expirait et la mise à jour automatique donnait « Session invalide ».)
async function fetchAvecSession(url, options = {}) {
  const cle = async (forcer) => {
    const { data } = forcer
      ? await supabase.auth.refreshSession()
      : await supabase.auth.getSession()
    return data?.session?.access_token || null
  }
  const lancer = (jeton) =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${jeton}` },
    })
  const jeton = await cle(false)
  if (!jeton) {
    throw new Error(
      'Ta session a expiré. Ferme le site et rouvre-le, ou fais ☰ → Déconnexion puis reconnecte-toi.'
    )
  }
  let res = await lancer(jeton)
  if (res.status === 401) {
    const neuf = await cle(true)
    if (neuf) res = await lancer(neuf)
  }
  return res
}

// Petit compteur − / + pour un pointage deviné (0 à 20). Vide au départ.
function CompteurPointage({ valeur, onChange, etiquette }) {
  return (
    <div className="pred-compteur">
      <button
        type="button"
        className="pred-btn"
        onClick={() => onChange(Math.max(0, (valeur ?? 0) - 1))}
        disabled={valeur === null || valeur <= 0}
        aria-label={`Un but de moins pour ${etiquette}`}
      >
        −
      </button>
      <span className={valeur === null ? 'pred-valeur vide' : 'pred-valeur'}>
        {valeur === null ? '–' : valeur}
      </span>
      <button
        type="button"
        className="pred-btn"
        onClick={() => onChange(valeur === null ? 0 : Math.min(20, valeur + 1))}
        disabled={valeur !== null && valeur >= 20}
        aria-label={`Un but de plus pour ${etiquette}`}
      >
        +
      </button>
    </div>
  )
}

// Pronostic : deviner le pointage final du match (+2 points si exact, prolongation
// et fusillade incluses). Modifiable jusqu'au début du match; les pronostics des
// autres ne s'affichent qu'une fois le match commencé (pour qu'on ne copie pas).
function PronosticPointage({ session, match, ferme, version = 0 }) {
  const [etat, setEtat] = useState(null)
  const [mtl, setMtl] = useState(null)
  const [adv, setAdv] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [indisponible, setIndisponible] = useState(false)
  const [raison, setRaison] = useState('')
  const valeursInitialisees = useRef(null)
  const dernierAppel = useRef(0)
  const matchId = match?.id

  async function charger() {
    // Une réponse qui arrive après un appel plus récent est périmée : on l'ignore
    // (sinon un vieux sondage pourrait écraser un pointage qu'on vient d'enregistrer).
    const numero = ++dernierAppel.current
    try {
      const res = await fetchAvecSession(
        `/.netlify/functions/prediction?match_id=${encodeURIComponent(matchId)}`
      )
      const data = await lireReponseFonction(res, 'prediction')
      if (numero !== dernierAppel.current) return
      setEtat(data)
      setIndisponible(false)
      setRaison('')
      // Au premier chargement de ce match : on remplit avec mon pointage déjà enregistré
      if (valeursInitialisees.current !== matchId) {
        valeursInitialisees.current = matchId
        if (data.mienne) {
          setMtl(data.mienne.score_mtl)
          setAdv(data.mienne.score_adversaire)
        }
      }
    } catch (e) {
      if (numero !== dernierAppel.current) return
      setIndisponible(true)
      setRaison(e.message)
    }
  }

  useEffect(() => {
    if (!matchId) return
    setEtat(null)
    setMtl(null)
    setAdv(null)
    setMessage('')
    setErreur('')
    valeursInitialisees.current = null
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, ferme])

  // Bouton « Bouton à Pa! » du haut : relit les pointages tout de suite, sans
  // toucher à ce que tu es en train de taper.
  useEffect(() => {
    if (version > 0 && matchId) charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  // Met à jour les pointages des autres pendant que le bloc est affiché
  useEffect(() => {
    if (!matchId) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') charger()
    }, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  async function enregistrer() {
    setEnvoi(true)
    setMessage('')
    setErreur('')
    try {
      const res = await fetchAvecSession('/.netlify/functions/prediction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, score_mtl: mtl, score_adversaire: adv }),
      })
      await lireReponseFonction(res, 'prediction')
      setMessage('✅ Pointage enregistré!')
      await charger()
    } catch (e) {
      setErreur(e.message)
    } finally {
      setEnvoi(false)
    }
  }

  if (!match) return null

  const titre = (
    <h3 className="pool-titre">
      <span className="pool-titre-icone">🔮</span>Devine le pointage
      <span className="pred-points">+2 pts</span>
    </h3>
  )

  if (indisponible && !etat) {
    return (
      <div className="pool-bloc">
        {titre}
        <p className="note-tc pred-note">Le pointage deviné n’est pas disponible pour l’instant.</p>
        {raison && <p className="alignement-raison">Détail technique : {raison}</p>}
      </div>
    )
  }

  if (!etat) {
    return (
      <div className="pool-bloc">
        {titre}
        <p className="note-tc pred-note">Chargement…</p>
      </div>
    )
  }

  const fermeReel = ferme || etat.commence
  const sauve = etat.mienne
  const complet = mtl !== null && adv !== null
  const modifie = !sauve || sauve.score_mtl !== mtl || sauve.score_adversaire !== adv

  const listePronostics = (
    <ul className="pred-liste">
      {ORDRE_BASE.map((uid) => {
        const p = uid === session.user.id ? etat.mienne : etat.autres.find((a) => a.user_id === uid)
        return (
          <li key={uid} className={p ? 'pred-ligne' : 'pred-ligne vide'}>
            <Pastille userId={uid} nom={NOMS[uid]} taille={26} />
            <span className="pred-nom">
              {NOMS[uid] || 'Inconnu'}
              {uid === session.user.id && <span className="pred-toi"> (toi)</span>}
            </span>
            <span className="pred-score">
              {p
                ? `MTL ${p.score_mtl} – ${p.score_adversaire} ${match.adversaire}`
                : etat.ont_predit.includes(uid)
                  ? '✅ a deviné'
                  : 'n’a pas deviné'}
            </span>
          </li>
        )
      })}
    </ul>
  )

  if (fermeReel) {
    return (
      <div className="pool-bloc">
        {titre}
        <p className="note-tc pred-note">🔒 Le match a commencé, les pointages devinés sont fermés.</p>
        {listePronostics}
      </div>
    )
  }

  return (
    <div className="pool-bloc">
      {titre}
      <p className="note-tc pred-note">
        Trouve le pointage final exact (prolongation et fusillade incluses) et gagne 2 points.
        Modifiable jusqu’au début du match.
      </p>

      <div className="pred-affiche">
        <div className="pred-equipe">
          <LogoEquipe abbrev="MTL" taille={40} />
          <span className="pred-abbrev">MTL</span>
          <CompteurPointage valeur={mtl} onChange={setMtl} etiquette="MTL" />
        </div>
        <span className="pred-tiret">–</span>
        <div className="pred-equipe">
          <LogoEquipe abbrev={match.adversaire} taille={40} />
          <span className="pred-abbrev">{match.adversaire}</span>
          <CompteurPointage valeur={adv} onChange={setAdv} etiquette={match.adversaire} />
        </div>
      </div>

      <button
        type="button"
        className="pred-enregistrer"
        onClick={enregistrer}
        disabled={envoi || !complet || !modifie}
      >
        {envoi
          ? '⏳ Enregistrement…'
          : !sauve
            ? '🔮 Enregistrer mon pointage'
            : modifie
              ? '🔮 Modifier mon pointage'
              : '✅ Pointage enregistré'}
      </button>
      {message && <p className="pred-message">{message}</p>}
      {erreur && <p className="pred-erreur">{erreur}</p>}

      <p className="pred-sous-titre">🙈 Les pointages des autres sont cachés jusqu’au début du match</p>
      <ul className="pred-qui">
        {ORDRE_BASE.map((uid) => {
          const aDevine = etat.ont_predit.includes(uid)
          return (
            <li key={uid} className={aDevine ? 'pred-qui-item fait' : 'pred-qui-item'}>
              <Pastille userId={uid} nom={NOMS[uid]} taille={20} />
              {NOMS[uid] || 'Inconnu'}
              <span>{aDevine ? '✅' : '⏳'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Pool({ session }) {
  const [match, setMatch] = useState(null)
  const [joueurs, setJoueurs] = useState([])
  const [infosNhl, setInfosNhl] = useState(null)
  const [rafraichissementEnCours, setRafraichissementEnCours] = useState(false)
  const [majGlobaleEnCours, setMajGlobaleEnCours] = useState(false)
  const [majResultat, setMajResultat] = useState('') // '', 'ok' ou 'partiel' (affiché 3 s sur le bouton)
  const [versionMaj, setVersionMaj] = useState(0) // +1 à chaque mise à jour manuelle
  const [messageMaj, setMessageMaj] = useState('')
  const [pointsDirect, setPointsDirect] = useState(null)
  const [alignementEnErreur, setAlignementEnErreur] = useState(false)
  const [raisonAlignement, setRaisonAlignement] = useState('')
  const [tousLesChoix, setTousLesChoix] = useState([])
  const [classement, setClassement] = useState([])
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(true)
  const [onglet, setOnglet] = useState('pool')
  const [statsEquipe, setStatsEquipe] = useState([])
  const [chargementStats, setChargementStats] = useState(false)
  const [notifsActivees, setNotifsActivees] = useState(false)
  const [guideIphone, setGuideIphone] = useState(false)
  const [confirmTest, setConfirmTest] = useState('')
  const [verifNotifsFaite, setVerifNotifsFaite] = useState(false)
  const [rappelNotifsFerme, setRappelNotifsFerme] = useState(() => {
    // Le rappel plein écran ne s'affiche qu'une seule fois par appareil
    try {
      return localStorage.getItem('rappelNotifsVu') === '1'
    } catch {
      return false
    }
  })
  const [aideNotifs, setAideNotifs] = useState('')
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [clignoteAide, setClignoteAide] = useState(false)
  const [aideVue, setAideVue] = useState(() => {
    try {
      return localStorage.getItem('aideNotifsVue') === '1'
    } catch {
      return false
    }
  })
  const installPrompt = useRef(null)
  const horsSafariIOS = /FBAN|FBAV|Instagram|Messenger|CriOS|FxiOS|EdgiOS|Line\//i.test(
    navigator.userAgent
  )

  useEffect(() => {
    const capter = (e) => {
      e.preventDefault()
      installPrompt.current = e
    }
    window.addEventListener('beforeinstallprompt', capter)
    return () => window.removeEventListener('beforeinstallprompt', capter)
  }, [])
  const [calendrier, setCalendrier] = useState([])
  const [chargementCalendrier, setChargementCalendrier] = useState(false)
  const [maintenant, setMaintenant] = useState(new Date())
  const [historique, setHistorique] = useState([])
  const [chargementHistorique, setChargementHistorique] = useState(false)
  const [classementNhl, setClassementNhl] = useState([])
  const [chargementClassementNhl, setChargementClassementNhl] = useState(false)
  const [statsLigue, setStatsLigue] = useState([])
  const [chargementStatsLigue, setChargementStatsLigue] = useState(false)
  const [rechercheStatsLigue, setRechercheStatsLigue] = useState('')
  const [triStats, setTriStats] = useState(null)
  const [triStatsLigue, setTriStatsLigue] = useState(null)
  const [triClassementNhl, setTriClassementNhl] = useState(null)
  const [ficheJoueur, setFicheJoueur] = useState(null)
  const [resumePartage, setResumePartage] = useState(null)
  const [annonceOuverte, setAnnonceOuverte] = useState(false)
  const [rappelEnCours, setRappelEnCours] = useState(null)
  const [messageRappel, setMessageRappel] = useState('')
  const [celebration, setCelebration] = useState(false)
  const celebrationVictoireFaite = useRef(false)

  // Lance les confettis pour quelques secondes
  function lancerCelebration() {
    setCelebration(true)
    setTimeout(() => setCelebration(false), 4200)
  }

  const matchCommence = match ? maintenant >= new Date(match.date_match) : false

  // Si le pointage fraîchement demandé (bouton 🔄) dit que le match est
  // vraiment en cours ou fini, on se fie à ça même si l'horloge du
  // téléphone n'a pas encore atteint l'heure prévue — au cas où le match
  // aurait démarré un peu avant/après l'heure enregistrée.
  const matchDemarrePourVrai =
    !!infosNhl && ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(infosNhl.statut)
  const jumbotronMontreLePointage = matchCommence || matchDemarrePourVrai
  // Dernières stats en direct gardées en base par notifier-points (la dernière
  // fois que n'importe qui a cliqué 🔄 Mise à jour). Ça permet à tout le monde
  // de revoir le classement provisoire en ouvrant le site, sans rappeler la
  // NHL. Il disparaît tout seul quand le match passe à "terminé".
  let statsDepuisBase = null
  if (match?.derniere_stats_direct) {
    try {
      const parUser = JSON.parse(match.derniere_stats_direct)
      statsDepuisBase = {}
      for (const c of tousLesChoix) {
        const st = parUser[c.user_id]
        if (st && c.joueurs?.nhl_id) statsDepuisBase[c.joueurs.nhl_id] = st
      }
    } catch {
      statsDepuisBase = null
    }
  }
  const statsDirectEffectives = pointsDirect?.stats || statsDepuisBase
  const matchEnCoursProvisoire = !!statsDirectEffectives && match?.statut !== 'termine'

  const prochainAChoisir =
    match?.ordre_choix?.find((uid) => !tousLesChoix.some((c) => c.user_id === uid)) || null
  const monTour = !prochainAChoisir || prochainAChoisir === session.user.id

  // Mon choix pour ce match, enrichi des infos de l'alignement (numéro,
  // position, forme) pour la carte du joueur choisi.
  const maLigneDeChoix = tousLesChoix.find((c) => c.user_id === session.user.id)
  const monJoueurDetails = maLigneDeChoix?.joueurs?.nhl_id
    ? joueurs.find((j) => j.nhl_id === maLigneDeChoix.joueurs.nhl_id)
    : null

  useEffect(() => {
    const intervalle = setInterval(() => setMaintenant(new Date()), 1000)
    return () => clearInterval(intervalle)
  }, [])

  // Va chercher le pointage à jour tout de suite, sans attendre le prochain
  // passage automatique. Sert à l'intervalle ci-dessous ET au bouton
  // 🔄 manuel du tableau en direct.
  async function rafraichirPointage() {
    setRafraichissementEnCours(true)
    setMessageMaj('')
    const problemes = []
    try {
      // 1. Force le calcul des points si un match est terminé (appelle la NHL).
      // Netlify interdit d'appeler par URL la fonction planifiée « calculer-points » :
      // on passe par « calculer-points-maintenant » (même calcul, jamais fait deux fois).
      try {
        let resCalcul = await fetch('/.netlify/functions/calculer-points-maintenant')
        // Pas encore publiée : on essaie l'ancienne adresse
        if (resCalcul.status === 404) resCalcul = await fetch('/.netlify/functions/calculer-points')
        if (!resCalcul.ok) problemes.push(`calcul des points (erreur ${resCalcul.status})`)
      } catch {
        problemes.push('calcul des points (pas de réponse)')
      }

      // 2. Pointage / période du match en direct. Si la NHL renvoie un AUTRE match
      // que celui affiché, c'est que le nôtre est terminé : on passera au suivant
      // plus bas, sans mélanger le pointage du prochain match avec celui-ci.
      let infosFraiches = null
      let autreMatch = false
      try {
        const res = await fetch('/.netlify/functions/prochain-match')
        const data = await res.json()
        if (data.match) {
          if (match && data.match.nhl_game_id !== match.nhl_game_id) {
            autreMatch = true
          } else {
            infosFraiches = data.match
            setInfosNhl(data.match)
          }
        }
      } catch {
        problemes.push('score du match')
      }

      // 2b. Points provisoires en direct (buts/passes du boxscore NHL), tant
      // que le match n'est pas encore calculé officiellement
      try {
        if (match) {
          const { data: matchFrais } = await supabase
            .from('matchs')
            .select('*')
            .eq('id', match.id)
            .maybeSingle()
          if (matchFrais) setMatch(matchFrais)

          const aDemarre =
            (infosFraiches && ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(infosFraiches.statut)) ||
            new Date() >= new Date(match.date_match)
          if (matchFrais?.statut !== 'termine' && aDemarre) {
            const resDirect = await fetch(
              `/.netlify/functions/points-en-direct?id=${match.nhl_game_id}`
            )
            if (!resDirect.ok) throw new Error('boxscore')
            setPointsDirect(await resDirect.json())
            // Prévient tout le monde (notification) si des points ont changé
            // depuis la dernière notif. Le serveur évite les doublons.
            fetch('/.netlify/functions/notifier-points', {
              method: 'POST',
              body: JSON.stringify({ match_id: match.id }),
            }).catch(() => {})
          } else {
            setPointsDirect(null)
          }
        }
      } catch {
        problemes.push('points en direct')
      }

      // 3. Choix de tout le monde pour le match affiché + classement du pool
      try {
        if (match) {
          const { data: choixFrais, error: erreurChoix } = await supabase
            .from('choix')
            .select('*, joueurs(nom, nhl_id)')
            .eq('match_id', match.id)
          // En cas d'erreur on garde ce qui est affiché (au lieu de tout vider)
          if (erreurChoix) throw erreurChoix
          setTousLesChoix(choixFrais || [])
        }
        await chargerClassement()
      } catch {
        problemes.push('classement du pool')
      }

      // 4. Les onglets déjà ouverts (les autres se chargent frais quand on clique dessus)
      const rechargements = []
      if (statsEquipe.length > 0) rechargements.push(chargerStatsEquipe())
      if (calendrier.length > 0) rechargements.push(chargerCalendrier())
      if (classementNhl.length > 0) rechargements.push(chargerClassementNhl())
      if (statsLigue.length > 0) rechargements.push(chargerStatsLigue())
      if (historique.length > 0) rechargements.push(chargerHistorique())
      await Promise.all(rechargements)

      // 5. Le match affiché est terminé et la NHL en annonce un autre : on passe
      // au suivant sur place (sans écran de chargement).
      if (autreMatch) await initialiser({ silencieux: true })

      setMessageMaj(
        problemes.length === 0
          ? '✓ Tout est à jour!'
          : `⚠️ Mis à jour, sauf : ${problemes.join(', ')}.`
      )
      return problemes.length === 0
    } finally {
      setRafraichissementEnCours(false)
    }
  }

  // Réservé à Eric : rappel amical « c'est ton tour de choisir » à une personne.
  async function envoyerRappel(userId) {
    setRappelEnCours(userId)
    setMessageRappel('')
    try {
      const res = await fetch('/.netlify/functions/rappel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: userId, match_id: match.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessageRappel(`❌ ${data.erreur || data.error || `Erreur ${res.status}`}`)
      } else if (data.envoye) {
        setMessageRappel(`✓ Rappel envoyé à ${NOMS[userId]}`)
      } else {
        setMessageRappel(`⚠️ ${data.raison || 'Pas envoyé'}`)
      }
    } catch (err) {
      setMessageRappel(`❌ ${err.message}`)
    } finally {
      setRappelEnCours(null)
    }
  }

  // Bouton d'en-tête "Bouton à Pa!" : force le calcul des points (ce qui va
  // chercher le boxscore à l'API de la NHL, au cas où le cron automatique
  // n'aurait pas encore tourné), puis relit tout SUR PLACE (match, choix,
  // classement, onglets déjà ouverts, pointages devinés). Plus de rechargement
  // de la page : on reste sur le même onglet, au même endroit.
  // Seule exception : si une NOUVELLE VERSION du site a été publiée (après un
  // upload sur GitHub), on recharge quand même la page pour la récupérer, sinon
  // un cellulaire qui garde le site ouvert resterait sur l'ancienne version.
  async function toutMettreAJour() {
    setMajGlobaleEnCours(true)
    setMajResultat('')
    let ok = false
    try {
      ok = await rafraichirPointage()
      setVersionMaj((v) => v + 1)
      if (await nouvelleVersionDisponible()) {
        setMajResultat('version')
        window.location.reload()
        return
      }
    } catch {
      ok = false
    }
    setMajGlobaleEnCours(false)
    setMajResultat(ok ? 'ok' : 'partiel')
    setTimeout(() => setMajResultat(''), 3000)
  }

  // Le message « Tout est à jour » sous les boutons disparaît tout seul
  useEffect(() => {
    if (!messageMaj) return undefined
    const t = setTimeout(() => setMessageMaj(''), 6000)
    return () => clearTimeout(t)
  }, [messageMaj])

  // Plus aucun rafraîchissement automatique pendant un match : le pointage
  // vient du chargement de la page et du bouton 🔄 manuel sur le tableau
  // en direct, point final. Zéro appel à la NHL tant que personne ne clique.

  useEffect(() => {
    initialiser()
  }, [])

  useEffect(() => {
    verifierAbonnementExistant().then((actif) => {
      // les deux d'un coup : évite que le rappel clignote avant le résultat
      setNotifsActivees(actif)
      setVerifNotifsFaite(true)
    })
  }, [])

  // L'alignement vient de l'API du NHL via notre fonction. Quand elle est
  // lente ou indisponible, on veut le dire clairement plutôt que d'afficher
  // une liste vide sans explication.
  async function chargerAlignement() {
    setAlignementEnErreur(false)
    setRaisonAlignement('')
    try {
      const res = await fetch('/.netlify/functions/roster')
      const data = await res.json()
      const liste = data.joueurs || []
      setJoueurs(liste)
      if (liste.length === 0) {
        setAlignementEnErreur(true)
        setRaisonAlignement(data.raison || data.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      setJoueurs([])
      setAlignementEnErreur(true)
      setRaisonAlignement(err.message)
    }
  }

  // silencieux : met tout à jour sur place, sans écran de chargement (donc sans
  // perdre la page, l'onglet ni ce qu'on est en train de taper).
  async function initialiser({ silencieux = false } = {}) {
    if (!silencieux) setChargement(true)
    try {
      const resMatch = await fetch('/.netlify/functions/prochain-match')
      if (!resMatch.ok) {
        // NHL en panne : on affiche au moins le classement avant de signaler l'erreur
        await chargerClassement().catch(() => {})
        throw new Error(`Impossible de lire le prochain match (erreur ${resMatch.status}).`)
      }
      const dataMatch = await resMatch.json()

      if (!dataMatch.match) {
        // Pas de match à venir : on charge quand même le classement
        await chargerClassement()
        return
      }

      // Infos fraîches venant de la NHL (pointage, période, en direct) —
      // la ligne en base ne contient que ce qui est figé.
      setInfosNhl(dataMatch.match)

      // Remet l'ordre de choix des matchs à venir (sans choix) en règle : rotation,
      // nouveau participant. Sans danger si tout est déjà correct.
      const remettreOrdresEnRegle = () => fetch('/.netlify/functions/ordre-choix').catch(() => {})
      await remettreOrdresEnRegle()

      let { data: matchExistant, error: erreurMatchExistant } = await supabase
        .from('matchs')
        .select('*')
        .eq('nhl_game_id', dataMatch.match.nhl_game_id)
        .maybeSingle()
      if (erreurMatchExistant) throw erreurMatchExistant

      if (!matchExistant) {
        // Ordre provisoire : la fonction ordre-choix met ensuite la bonne rotation
        const { data: nouveauMatch, error } = await supabase
          .from('matchs')
          .insert({
            nhl_game_id: dataMatch.match.nhl_game_id,
            date_match: dataMatch.match.date_match,
            adversaire: dataMatch.match.adversaire,
            statut: 'a_venir',
            ordre_choix: ORDRE_BASE,
          })
          .select()
          .single()
        if (error) throw error
        await remettreOrdresEnRegle()
        const { data: relu } = await supabase
          .from('matchs')
          .select('*')
          .eq('id', nouveauMatch.id)
          .maybeSingle()
        matchExistant = relu || nouveauMatch
      }
      // Filet de sécurité : si la fonction ordre-choix n'a pas pu passer, on ajoute au
      // moins les participants manquants à la fin (tant que le match n'a pas commencé).
      if (
        matchExistant.statut !== 'termine' &&
        new Date() < new Date(matchExistant.date_match)
      ) {
        const ordreComplet = completerOrdre(matchExistant.ordre_choix)
        if (ordreComplet.length !== (matchExistant.ordre_choix || []).length) {
          const { data: misAJour } = await supabase
            .from('matchs')
            .update({ ordre_choix: ordreComplet })
            .eq('id', matchExistant.id)
            .select()
            .maybeSingle()
          matchExistant = misAJour || { ...matchExistant, ordre_choix: ordreComplet }
        }
      }
      setMatch(matchExistant)

      await chargerAlignement()

      const { data: choixExistants, error: erreurChoixExistants } = await supabase
        .from('choix')
        .select('*, joueurs(nom, nhl_id)')
        .eq('match_id', matchExistant.id)
      if (erreurChoixExistants) throw erreurChoixExistants

      setTousLesChoix(choixExistants || [])

      await chargerClassement()
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargement(false)
    }
  }

  async function chargerClassement() {
    const { debutSaison } = saisonEnCours()

    // On filtre par la date du match (via la table matchs) pour ne compter
    // que la saison en cours — ça "reset" automatiquement chaque nouvelle
    // saison sans jamais effacer l'historique des saisons passées.
    // La date sert aussi à retrouver le match le plus récent, pour les
    // flèches de tendance et le badge « en série ».
    const { data: matchsSaison, error: erreurMatchsSaison } = await supabase
      .from('matchs')
      .select('id, date_match')
      .gte('date_match', debutSaison.toISOString())
    if (erreurMatchsSaison) throw erreurMatchsSaison // on garde l'affichage actuel

    const idsMatchsSaison = new Set((matchsSaison || []).map((m) => m.id))
    if (idsMatchsSaison.size === 0) {
      setClassement([])
      return
    }

    const { data, error: erreurResultats } = await supabase
      .from('resultats')
      .select('user_id, match_id, points, buts, passes, tour_chapeau')
      .in('match_id', Array.from(idsMatchsSaison))
    if (erreurResultats) throw erreurResultats
    if (!data) return

    function totaliser(lignes) {
      const totaux = {}
      // Tout le monde apparaît au classement, même sans point encore (nouveau participant)
      if (lignes.length > 0) {
        for (const uid of ORDRE_BASE) {
          totaux[uid] = { user_id: uid, points: 0, buts: 0, passes: 0, tc: 0 }
        }
      }
      for (const r of lignes) {
        if (!totaux[r.user_id]) {
          totaux[r.user_id] = { user_id: r.user_id, points: 0, buts: 0, passes: 0, tc: 0 }
        }
        totaux[r.user_id].points += r.points
        totaux[r.user_id].buts += r.buts || 0
        totaux[r.user_id].passes += r.passes || 0
        totaux[r.user_id].tc += r.tour_chapeau ? 1 : 0
      }
      return Object.values(totaux).sort((a, b) => b.points - a.points)
    }

    const liste = totaliser(data)

    // Matchs déjà calculés, du plus récent au plus vieux (par date, pas par
    // ordre d'arrivée des résultats).
    const idsAvecResultats = new Set(data.map((r) => r.match_id))
    const matchsCalculesTries = (matchsSaison || [])
      .filter((m) => idsAvecResultats.has(m.id))
      .sort((a, b) => new Date(b.date_match) - new Date(a.date_match))

    // Flèches de tendance : rang avant/après le dernier match calculé.
    const dernierMatchId = matchsCalculesTries[0]?.id
    const listeAvantDernier = totaliser(data.filter((r) => r.match_id !== dernierMatchId))
    const rangAvant = {}
    listeAvantDernier.forEach((c, i) => {
      rangAvant[c.user_id] = i
    })

    // Badge « en série » : qui a le plus de points dans les 3 derniers
    // matchs calculés. Seulement si c'est net (pas d'égalité) et qu'on a
    // au moins 2 matchs de recul pour que « série » veuille dire quelque
    // chose.
    const troisDerniersIds = new Set(matchsCalculesTries.slice(0, 3).map((m) => m.id))
    const totauxRecents = {}
    for (const r of data) {
      if (!troisDerniersIds.has(r.match_id)) continue
      totauxRecents[r.user_id] = (totauxRecents[r.user_id] || 0) + r.points
    }
    let idEnSerie = null
    if (matchsCalculesTries.length >= 2) {
      const tries = Object.entries(totauxRecents).sort((a, b) => b[1] - a[1])
      if (tries.length > 0 && tries[0][1] > 0 && (tries.length === 1 || tries[0][1] !== tries[1][1])) {
        idEnSerie = tries[0][0]
      }
    }

    liste.forEach((c, i) => {
      const avant = rangAvant[c.user_id]
      // positif = a monté au classement, négatif = a descendu, 0/undefined = pas de changement à montrer
      c.tendance = avant === undefined ? 0 : avant - i
      c.enSerie = c.user_id === idEnSerie
    })

    setClassement(liste)
  }

  async function choisirJoueur(joueurNhl) {
    setErreur('')

    const dejaChoisi = tousLesChoix.some((c) => c.user_id === session.user.id)

    if (!monTour && !dejaChoisi) {
      setErreur(`⏳ ATTENDS TON TOUR TRICHEUR ! 😄 C'est à ${NOMS[prochainAChoisir]} de choisir.`)
      return
    }

    const dejaPrisParAutre = tousLesChoix.some(
      (c) => c.user_id !== session.user.id && c.joueurs?.nom === joueurNhl.nom
    )
    if (dejaPrisParAutre) {
      setErreur(`🚫 ${joueurNhl.nom} est déjà choisi par quelqu'un d'autre pour ce match!`)
      return
    }

    try {
      const { data: joueurDb, error: erreurJoueur } = await supabase
        .from('joueurs')
        .upsert({ nhl_id: joueurNhl.nhl_id, nom: joueurNhl.nom }, { onConflict: 'nhl_id' })
        .select()
        .single()

      if (erreurJoueur) throw erreurJoueur

      const { error: erreurChoix } = await supabase.from('choix').upsert(
        {
          match_id: match.id,
          user_id: session.user.id,
          joueur_id: joueurDb.id,
        },
        { onConflict: 'match_id,user_id' }
      )

      if (erreurChoix) throw erreurChoix

      await initialiser({ silencieux: true })
      lancerCelebration()

      if (dejaChoisi) {
        notifierChangementChoix(joueurNhl.nom)
      } else {
        notifierProchainJoueur()
      }
    } catch (err) {
      setErreur(err.message)
    }
  }

  async function notifierChangementChoix(nouveauNomJoueur) {
    try {
      await fetchAvecSession('/.netlify/functions/notifier-changement', {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id, nouveau_joueur: nouveauNomJoueur }),
      })
    } catch {
      // pas grave si ça échoue, c'est juste une notif
    }
  }

  async function notifierProchainJoueur() {
    // Trouver qui doit choisir après ce choix
    const { data: choixMaj } = await supabase
      .from('choix')
      .select('user_id')
      .eq('match_id', match.id)

    const dejaChoisi = new Set((choixMaj || []).map((c) => c.user_id))
    const prochain = match.ordre_choix?.find((uid) => !dejaChoisi.has(uid))
    if (!prochain) return

    try {
      await fetchAvecSession('/.netlify/functions/envoyer-notification', {
        method: 'POST',
        body: JSON.stringify({
          user_id: prochain,
          titre: 'Pool de Hockey 🏒',
          corps: "C'est ton tour de choisir un joueur !",
        }),
      })
    } catch {
      // pas grave si ça échoue, c'est juste une notif
    }
  }

  // Retourne true si les notifications sont vraiment activées (téléphone ET base).
  async function verifierAbonnementExistant() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
      if (Notification.permission !== 'granted') return false

      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      if (!registration) return false

      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return false

      // Le téléphone se souvient d'un abonnement : on vérifie qu'il existe
      // aussi dans la base (sinon il a été remis à zéro → switch OFF).
      let actifSurServeur = true
      try {
        const res = await fetch('/.netlify/functions/statut-abonnement', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) actifSurServeur = (await res.json()).actif !== false
      } catch {
        // pas de réseau : on se fie au téléphone
      }

      if (!actifSurServeur) {
        await subscription.unsubscribe()
        return false
      }
      return true
    } catch {
      return false
    }
  }

  async function testerNotification() {
    setErreur('')
    try {
      const res = await fetchAvecSession('/.netlify/functions/envoyer-notification', {
        method: 'POST',
        body: JSON.stringify({
          user_id: session.user.id,
          titre: 'Test 🏒',
          corps: 'Si tu vois ça, les notifications fonctionnent!',
        }),
      })
      const data = await res.json()
      if (!data.envoye) {
        setErreur(
          `Test échoué: ${data.raison || 'raison inconnue'}. Essaie de cliquer "Activer" à nouveau.`
        )
      }
    } catch (err) {
      setErreur('Erreur lors du test: ' + err.message)
    }
  }

  async function desactiverNotifications() {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()

      const res = await fetch('/.netlify/functions/desactiver-abonnement', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`Erreur ${res.status}`)

      setNotifsActivees(false)
    } catch (err) {
      setErreur("Impossible de désactiver les notifications: " + err.message)
    }
  }

  // Première fois : on envoie la personne lire l'aide dans Règlements (boutons
  // rouges qui clignotent). Ensuite, le switch active directement.
  function fermerRappelNotifs() {
    setRappelNotifsFerme(true)
    try {
      localStorage.setItem('rappelNotifsVu', '1')
    } catch {
      // pas grave
    }
  }

  function demarrerActivation() {
    if (!aideVue) {
      setRappelNotifsFerme(true)
      setOnglet('reglements')
      setClignoteAide(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    activerNotifications()
  }

  function choisirAide(type) {
    setAideNotifs(aideNotifs === type ? '' : type)
    setClignoteAide(false)
    setAideVue(true)
    try {
      localStorage.setItem('aideNotifsVue', '1')
    } catch {
      // pas grave
    }
  }

  async function activerNotifications() {
    try {
      // Détection iOS : Apple exige que le site soit installé sur l'écran
      // d'accueil (PWA) avant que les notifications push fonctionnent.
      const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const estStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true

      if (estIOS && !estStandalone) {
        setGuideIphone(true)
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setErreur('Notifications refusées. Tu peux les activer dans les réglages du navigateur.')
        return
      }

      await navigator.serviceWorker.register('/sw.js')
      const registration = await navigator.serviceWorker.ready

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: VAPID_PUBLIC_KEY,
        })
      }

      const resAbonnement = await fetchAvecSession('/.netlify/functions/enregistrer-abonnement', {
        method: 'POST',
        // user_id reste envoyé pour l'ancienne version de la fonction; la nouvelle
        // l'ignore et prend la personne connectée.
        body: JSON.stringify({ user_id: session.user.id, subscription }),
      })
      // Si l'enregistrement échoue, on ne montre pas « ON » pour rien
      await lireReponseFonction(resAbonnement, 'enregistrer-abonnement')

      setNotifsActivees(true)

      // Notification de test pour confirmer que ça marche
      fetch('/.netlify/functions/notif-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {})
      setConfirmTest('demande')
    } catch (err) {
      setErreur("Impossible d'activer les notifications: " + err.message)
    }
  }

  async function chargerStatsEquipe() {
    setChargementStats(true)
    try {
      const res = await fetch('/.netlify/functions/stats-equipe')
      const data = await res.json()
      setStatsEquipe(data.joueurs || [])
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargementStats(false)
    }
  }

  async function chargerCalendrier() {
    setChargementCalendrier(true)
    try {
      const res = await fetch('/.netlify/functions/calendrier-saison')
      const data = await res.json()
      setCalendrier(data.matchs || [])
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargementCalendrier(false)
    }
  }

  async function chargerClassementNhl() {
    setChargementClassementNhl(true)
    try {
      const res = await fetch('/.netlify/functions/classement-nhl')
      const data = await res.json()
      setClassementNhl(data.equipes || [])
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargementClassementNhl(false)
    }
  }

  async function chargerStatsLigue() {
    setChargementStatsLigue(true)
    try {
      const res = await fetch('/.netlify/functions/stats-ligue')
      const data = await res.json()
      setStatsLigue(data.joueurs || [])
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargementStatsLigue(false)
    }
  }

  async function chargerHistorique() {
    setChargementHistorique(true)
    try {
      const { debutSaison } = saisonEnCours()
      const { data: resultatsData, error: erreurResultatsHistorique } = await supabase
        .from('resultats')
        .select('*, joueurs(nom, nhl_id), matchs(date_match, adversaire)')
        .order('calcule_le', { ascending: false })
      // En cas d'erreur on garde l'historique déjà affiché (au lieu de le vider)
      if (erreurResultatsHistorique) throw erreurResultatsHistorique

      // Filtrer sur la saison en cours (le "reset" se fait tout seul chaque
      // nouvelle saison, sans jamais supprimer l'historique des anciennes)
      const filtre = (resultatsData || []).filter(
        (r) => r.matchs?.date_match && new Date(r.matchs.date_match) >= debutSaison
      )

      setHistorique(filtre)

      // Confettis si on a gagné le dernier match calculé — une seule fois
      // par visite, pour que ça reste une surprise et pas un tic.
      if (!celebrationVictoireFaite.current && filtre.length > 0) {
        const dernierMatchId = filtre[0].match_id
        const lignesDuDernier = filtre.filter((r) => r.match_id === dernierMatchId)
        const gagnant = [...lignesDuDernier].sort((a, b) => b.points - a.points)[0]
        if (gagnant && gagnant.user_id === session.user.id && gagnant.points > 0) {
          celebrationVictoireFaite.current = true
          lancerCelebration()
        }
      }
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargementHistorique(false)
    }
  }

  if (chargement) {
    return (
      <div className="conteneur">
        <ConfirmationTest
        etat={confirmTest}
        onReponse={(r) => setConfirmTest(r === 'fin' ? '' : r)}
      />
      <header className="entete">
          <div className="entete-titre">
            <Crest taille={36} />
            <h1>Pool de Hockey</h1>
          </div>
        </header>
        <Squelette lignes={5} />
      </div>
    )
  }

  return (
    <div className="conteneur">
      {celebration && <Confettis />}
      <FicheJoueur joueur={ficheJoueur} onFermer={() => setFicheJoueur(null)} />
      <PartageResume texte={resumePartage} onFermer={() => setResumePartage(null)} />
      {session.user.id === ADMIN_ID && (
        <AnnonceModal
          ouverte={annonceOuverte}
          accessToken={session.access_token}
          onFermer={() => setAnnonceOuverte(false)}
        />
      )}
      <GuideIphone
        ouverte={guideIphone}
        horsSafari={horsSafariIOS}
        onFermer={() => setGuideIphone(false)}
      />
      <ConfirmationTest
        etat={confirmTest}
        onReponse={(r) => setConfirmTest(r === 'fin' ? '' : r)}
      />
      <header className="entete">
        <div className="entete-haut">
          <div className="entete-titre">
            <Crest taille={36} />
            <h1>Pool de Hockey</h1>
          </div>
          <div className="menu-wrap">
            <button
              type="button"
              className="menu-bouton"
              aria-label="Menu"
              aria-expanded={menuOuvert}
              onClick={() => setMenuOuvert(!menuOuvert)}
            >
              {menuOuvert ? '✕' : '☰'}
            </button>
            {menuOuvert && (
              <>
                <div className="menu-fond" onClick={() => setMenuOuvert(false)} />
                <div className="menu-liste" role="menu">
                  {session.user.id === ADMIN_ID && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOuvert(false)
                        setAnnonceOuverte(true)
                      }}
                    >
                      📣 Annonce
                    </button>
                  )}
                  <button role="menuitem" onClick={() => supabase.auth.signOut()}>
                    🚪 Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="entete-dock">
          {EST_MOBILE && (
            <div className="notif-switch-groupe">
              <button
                type="button"
                role="switch"
                aria-checked={notifsActivees}
                aria-label="Notifications"
                className={notifsActivees ? 'notif-switch on' : 'notif-switch off'}
                onClick={notifsActivees ? desactiverNotifications : demarrerActivation}
              >
                <span className="notif-switch-texte">{notifsActivees ? 'ON' : 'OFF'}</span>
                <span className="notif-switch-bouton" aria-hidden="true">
                  {notifsActivees ? '🔔' : '🔕'}
                </span>
              </button>
            </div>
          )}
          <div className="dock-maj-groupe">
          <button
            className={majGlobaleEnCours ? 'dock-maj en-cours' : 'dock-maj'}
            onClick={toutMettreAJour}
            disabled={majGlobaleEnCours || rafraichissementEnCours}
            title="Calcule les points du match (si terminé) et met tout à jour avec les dernières infos de la NHL, sans recharger la page"
          >
            <span className="dock-maj-icone">🔄</span>
            {majResultat === 'version'
              ? 'Nouvelle version...'
              : majGlobaleEnCours
                ? 'Mise à jour...'
                : majResultat === 'ok'
                  ? '✓ À jour!'
                  : majResultat === 'partiel'
                    ? '⚠️ Partiel'
                    : 'Bouton à Pa!'}
          </button>
          <button
            className={rafraichissementEnCours ? 'dock-maj dock-maj-score en-cours' : 'dock-maj dock-maj-score'}
            onClick={rafraichirPointage}
            disabled={majGlobaleEnCours || rafraichissementEnCours}
            title="Relit le score du match, recalcule les points si un match est terminé, et met à jour le classement du pool et les stats. Pendant un match, affiche le classement provisoire (buts et passes en direct) et prévient tout le monde par notification quand un joueur choisi marque ou fait une passe."
          >
            {rafraichissementEnCours ? '⏳ En cours...' : 'Mise à jour'}
          </button>
          </div>
          <BoutonTheme />
        </div>
        {messageMaj && (
          <p className="dock-message" role="status">
            {messageMaj}
          </p>
        )}
      </header>

      {EST_MOBILE && verifNotifsFaite && !notifsActivees && !estNavigateurIntegre() && (
        <div className="bandeau-notifs">
          <span>🔕 Tes notifications sont désactivées</span>
          <button className="bouton-copier" onClick={demarrerActivation}>
            Activer
          </button>
        </div>
      )}

      <div className="onglets">
        <button
          className={onglet === 'pool' ? 'onglet actif' : 'onglet'}
          onClick={() => setOnglet('pool')}
        >
          <span className="onglet-icone" aria-hidden="true">🏒</span>
          <span className="onglet-texte">Pool</span>
        </button>
        <button
          className={onglet === 'stats' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('stats')
            if (statsEquipe.length === 0) chargerStatsEquipe()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">📊</span>
          <span className="onglet-texte">Stats CH</span>
        </button>
        <button
          className={onglet === 'calendrier' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('calendrier')
            if (calendrier.length === 0) chargerCalendrier()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">📅</span>
          <span className="onglet-texte">Calendrier</span>
        </button>
        <button
          className={onglet === 'historique' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('historique')
            if (historique.length === 0) chargerHistorique()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">🕘</span>
          <span className="onglet-texte">Historique</span>
        </button>
        <button
          className={onglet === 'classement' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('classement')
            if (historique.length === 0) chargerHistorique()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">🏆</span>
          <span className="onglet-texte">Classement</span>
        </button>
        <button
          className={onglet === 'classement-nhl' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('classement-nhl')
            if (classementNhl.length === 0) chargerClassementNhl()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">📈</span>
          <span className="onglet-texte">Classement LNH</span>
        </button>
        <button
          className={onglet === 'stats-ligue' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('stats-ligue')
            if (statsLigue.length === 0) chargerStatsLigue()
          }}
        >
          <span className="onglet-icone" aria-hidden="true">🌐</span>
          <span className="onglet-texte">Stats LNH</span>
        </button>
        <button
          className={onglet === 'reglements' ? 'onglet actif' : 'onglet'}
          onClick={() => setOnglet('reglements')}
        >
          <span className="onglet-icone" aria-hidden="true">📜</span>
          <span className="onglet-texte">Règlements</span>
        </button>
      </div>

      {erreur && <Alerte key={erreur} message={erreur} onFermer={() => setErreur('')} />}

      <div key={onglet} className="contenu-onglet">
      {onglet === 'classement' && (
        <section className="carte">
          <div className="classement-entete-section">
            <h2>🏆 Classement</h2>
            {classement.length > 0 && (
              <button
                className="bouton-partager"
                onClick={() =>
                  setResumePartage(
                    genererResumeClassement(classement, dernierMatchDeHistorique(historique))
                  )
                }
              >
                📤 Partager les résultats
              </button>
            )}
          </div>
          {classement.length === 0 ? (
            <p className="info">Aucun résultat encore</p>
          ) : (
            <>
              <details className="repliable" open>
                <summary className="repliable-titre">🏆 Classement du pool</summary>
              <Podium classement={classement} />
              <ol className="classement">
                {classement.map((c, i) => {
                  const maxPoints = classement[0]?.points || 0
                  const pourcentage =
                    maxPoints > 0 ? Math.max(4, Math.round((c.points / maxPoints) * 100)) : 0
                  return (
                    <li
                      key={c.user_id}
                      className={
                        'cascade-item ' +
                        (i === 0 ? 'rang-or' : i === 1 ? 'rang-argent' : i === 2 ? 'rang-bronze' : '')
                      }
                      style={{ animationDelay: `${i * 70}ms` }}
                    >
                      <div className="classement-ligne-haut">
                        <span className="classement-nom">
                          <Pastille userId={c.user_id} nom={NOMS[c.user_id]} taille={26} />
                          {NOMS[c.user_id] || 'Inconnu'}
                          {c.enSerie && (
                            <span
                              className="badge-serie"
                              title="Le plus de points dans les 3 derniers matchs"
                            >
                              🔥
                            </span>
                          )}
                        </span>
                        <span className="classement-droite">
                          {c.tendance > 0 && (
                            <span className="tendance tendance-hausse" title="A gagné des rangs">
                              ▲
                            </span>
                          )}
                          {c.tendance < 0 && (
                            <span className="tendance tendance-baisse" title="A perdu des rangs">
                              ▼
                            </span>
                          )}
                          <span className="points">{c.points} pts</span>
                        </span>
                      </div>
                      <div className="barre-progression">
                        <div
                          className="barre-progression-remplissage"
                          style={{ width: `${pourcentage}%` }}
                        />
                      </div>
                      <div className="classement-detail">
                        {c.buts} {c.buts > 1 ? 'buts' : 'but'} · {c.passes} {c.passes > 1 ? 'passes' : 'passe'} · {c.tc}{' '}
                        {c.tc > 1 ? 'tours' : 'tour'} du chapeau
                      </div>
                    </li>
                  )
                })}
              </ol>
              </details>
              {historique.length > 0 && (
                <>
                  <CourbeClassement historique={historique} />
                  <Trophees historique={historique} />
                </>
              )}
            </>
          )}
        </section>
      )}

      {onglet === 'reglements' && (
        <section className="carte">
          {EST_MOBILE && !notifsActivees && (
            <>
          <p className="regle-alerte">
            ⚠️ Les notifications sont obligatoires pour une bonne communication dans le pool ⚠️
          </p>
          {clignoteAide && !notifsActivees && (
            <p className="aide-invite">👇 Choisis ton téléphone et suis les étapes, puis reviens appuyer sur le switch en haut</p>
          )}
          <div className="aide-notifs-boutons">
            <button
              className={
                (aideNotifs === 'iphone' ? 'bouton-copier aide-actif' : 'bouton-copier') +
                (clignoteAide && !notifsActivees ? ' aide-clignote' : '')
              }
              onClick={() => choisirAide('iphone')}
            >
              <IconeAppareil type="iphone" /> Comment activer sur iPhone
            </button>
            <button
              className={
                (aideNotifs === 'android' ? 'bouton-copier aide-actif' : 'bouton-copier') +
                (clignoteAide && !notifsActivees ? ' aide-clignote' : '')
              }
              onClick={() => choisirAide('android')}
            >
              <IconeAppareil type="android" /> Comment activer sur Android
            </button>
          </div>
          {aideNotifs === 'iphone' && (
            <ol className="aide-notifs-etapes">
              <li>Copie le lien : <strong>{URL_SITE}</strong></li>
              <li>Ouvre <strong>Safari</strong> (la boussole bleue, pas Messenger)</li>
              <li>Appuie dans la <strong>barre de recherche en haut</strong>, colle le lien (appui long → Coller), puis <strong>Aller</strong></li>
              <li>Appuie sur <strong>Partager</strong> (le carré avec la flèche ⬆️ en bas)</li>
              <li>Descends et choisis <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong></li>
              <li>Ferme Safari et ouvre <strong>Pool de Hockey</strong> avec la <strong>nouvelle icône</strong></li>
              <li>Appuie sur le <strong>switch</strong> en haut pour qu'il devienne <strong>vert (ON)</strong>, puis <strong>Autoriser</strong></li>
            </ol>
          )}
          {aideNotifs === 'android' && (
            <ol className="aide-notifs-etapes">
              <li>Ouvre le site dans <strong>Chrome</strong> : <strong>{URL_SITE}</strong></li>
              <li>Appuie sur le <strong>switch</strong> en haut pour qu'il devienne <strong>vert (ON)</strong>, puis <strong>Autoriser</strong></li>
              <li>
                <strong>Mettre le site sur ta page d'accueil</strong> (facultatif) : appuie sur les <strong>⋮</strong> (3 points) en haut à droite de Chrome, puis <strong>« Ajouter à l'écran d'accueil »</strong> (ou <strong>« Installer l'application »</strong>), puis <strong>Ajouter</strong>
              </li>
            </ol>
          )}
            </>
          )}
          <h2>📜 Règlement du pool</h2>
          <p className="reglement-sous-titre">Saison {saisonEnCours().libelle} · Canadiens de Montréal</p>

          <article className="article">
            <span className="article-numero">Article 1</span>
            <h3 className="article-titre">Choix des joueurs</h3>
            <p>
              Chaque participant choisit un joueur du Canadien avant chaque match. L'ordre de choix
              tourne à chaque match ({ORDRE_BASE.map((_, i) => ORDRE_BASE.length - i).join('-')}) pour
              toute la saison.
            </p>
          </article>

          <article className="article">
            <span className="article-numero">Article 2</span>
            <h3 className="article-titre">Pointage</h3>
            <div className="bareme">
              <div className="bareme-case">
                <span className="bareme-valeur">2</span>
                <span className="bareme-libelle">points par but</span>
              </div>
              <div className="bareme-case">
                <span className="bareme-valeur">1</span>
                <span className="bareme-libelle">point par passe</span>
              </div>
              <div className="bareme-case">
                <span className="bareme-valeur">+3</span>
                <span className="bareme-libelle">tour du chapeau</span>
              </div>
              <div className="bareme-case">
                <span className="bareme-valeur">+2</span>
                <span className="bareme-libelle">pointage deviné</span>
              </div>
            </div>
            <p>
              <strong>Pointage deviné :</strong> avant chaque match, chacun peut deviner le
              pointage final. Si le pointage est exact (prolongation et fusillade incluses),
              tu gagnes <strong>2 points</strong> en plus de ceux de ton joueur. Tu peux changer
              ton pointage jusqu'au début du match; ceux des autres ne se montrent qu'à ce
              moment-là (deux personnes peuvent avoir le même pointage).
            </p>
          </article>

          <article className="article">
            <span className="article-numero">Article 3</span>
            <h3 className="article-titre">Choix automatique</h3>
            <p>
              <strong>Si tu ne choisis pas à temps, le système choisit pour toi</strong>{' '}
              automatiquement : ton joueur du match précédent (s'il est encore libre), sinon le
              meilleur pointeur du CH encore disponible.
            </p>
            <p>
              Chacun a sa propre limite : {texteDelaisChoix()}. Ça laisse toujours une marge de
              30 minutes avant le début du match.
            </p>
          </article>

          <article className="article">
            <span className="article-numero">Article 4</span>
            <h3 className="article-titre">Verrouillage</h3>
            <p>
              Une fois le match commencé, il n'est plus possible de changer de joueur ni de
              pointage deviné.
            </p>
          </article>

          <article className="article">
            <span className="article-numero">Article 5</span>
            <h3 className="article-titre">Activer les notifications</h3>
            {EST_MOBILE && (
              <p className={notifsActivees ? 'statut-notifs statut-on' : 'statut-notifs statut-off'}>
                {notifsActivees ? '🔔 NOTIFICATIONS ACTIVÉES' : '🔕 NOTIFICATIONS DÉSACTIVÉES'}
              </p>
            )}
            <p>
              <strong>Les notifications sont obligatoires</strong> pour une bonne communication
              dans le pool : c'est par elles qu'on t'avertit quand c'est ton tour de choisir et
              quand tes points changent. Une notification de test confirme que tout fonctionne.
            </p>
            <details className="repliable">
              <summary className="repliable-titre">
                <span>
                  <IconeAppareil type="iphone" /> iPhone
                </span>
              </summary>
              <ol className="aide-notifs-etapes">
                <li>Copie le lien : <strong>{URL_SITE}</strong></li>
                <li>Ouvre <strong>Safari</strong> (la boussole bleue, pas Messenger)</li>
                <li>Appuie dans la <strong>barre de recherche en haut</strong>, colle le lien, puis <strong>Aller</strong></li>
                <li>Appuie sur <strong>Partager</strong> (le carré avec la flèche ⬆️ en bas)</li>
                <li>Choisis <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong></li>
                <li>Ouvre <strong>Pool de Hockey</strong> avec la <strong>nouvelle icône</strong></li>
                <li>Appuie sur le <strong>switch</strong> en haut pour qu'il devienne <strong>vert (ON)</strong>, puis <strong>Autoriser</strong></li>
              </ol>
            </details>
            <details className="repliable">
              <summary className="repliable-titre">
                <span>
                  <IconeAppareil type="android" /> Android
                </span>
              </summary>
              <ol className="aide-notifs-etapes">
                <li>Ouvre le site dans <strong>Chrome</strong> : <strong>{URL_SITE}</strong></li>
                <li>Appuie sur le <strong>switch</strong> en haut pour qu'il devienne <strong>vert (ON)</strong>, puis <strong>Autoriser</strong></li>
                <li>Facultatif, pour l'avoir sur ta page d'accueil : <strong>⋮</strong> en haut à droite de Chrome, puis <strong>« Ajouter à l'écran d'accueil »</strong></li>
              </ol>
            </details>
          </article>
        </section>
      )}

      {onglet === 'historique' && (
        <HistoriqueOnglet
          historique={historique}
          chargement={chargementHistorique}
          session={session}
        />
      )}

      {onglet === 'calendrier' && (
        <section className="carte carte-rouge">
          <h2>📅 Calendrier {saisonEnCours().libelle}</h2>
          {chargementCalendrier && <Squelette lignes={8} hauteur={34} />}
          {!chargementCalendrier && (() => {
            const joues = calendrier.filter((m) => matchTermine(m.statut))
            const aVenir = calendrier.filter((m) => !matchTermine(m.statut))
            // Un match en cours n'est pas « le prochain » : on le marque « en cours »
            // et le badge « prochain match » passe au match d'après.
            const enCoursId =
              aVenir[0] && ['LIVE', 'CRIT'].includes(aVenir[0].statut)
                ? aVenir[0].nhl_game_id
                : null
            const prochainId = (enCoursId ? aVenir[1] : aVenir[0])?.nhl_game_id
            const dernierId = joues[joues.length - 1]?.nhl_game_id

            const tuile = (m, i) => {
              const d = new Date(m.date_match)
              const termine = matchTermine(m.statut)
              const gagne = termine && m.score_mtl > m.score_adversaire
              return (
                <li
                  key={m.nhl_game_id}
                  id={
                    m.nhl_game_id === prochainId
                      ? 'cal-prochain'
                      : m.nhl_game_id === dernierId
                        ? 'cal-dernier'
                        : undefined
                  }
                  className={
                    'cal-tuile cascade-item' +
                    (termine ? ' joue' : '') +
                    (m.nhl_game_id === prochainId ? ' prochain' : '')
                  }
                  style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                >
                  <div className="cal-jour">
                    <span className="cal-jour-num">
                      {formaterDateHeureMontreal(d, { day: 'numeric' })}
                    </span>
                    <span className="cal-jour-sem">
                      {formaterDateHeureMontreal(d, { weekday: 'short' })}
                    </span>
                  </div>
                  <div className="cal-centre">
                    <LogoEquipe abbrev={m.adversaire} taille={32} />
                    <div className="cal-centre-texte">
                      {m.nhl_game_id === prochainId && (
                        <span className="cal-badge">PROCHAIN MATCH</span>
                      )}
                      {m.nhl_game_id === enCoursId && (
                        <span className="cal-badge cal-badge-direct">🔴 EN COURS</span>
                      )}
                      <span className="cal-adv">{m.adversaire}</span>
                      <span className="cal-lieu">{m.domicile ? 'À domicile' : 'À l’étranger'}</span>
                    </div>
                  </div>
                  <div className="cal-droite">
                    {termine ? (
                      <>
                        <span className={'cal-resultat ' + (gagne ? 'cal-v' : 'cal-d')}>
                          {gagne ? 'V' : 'D'}
                        </span>
                        <span className="cal-score-final">
                          {m.score_mtl}-{m.score_adversaire}
                        </span>
                      </>
                    ) : m.nhl_game_id === enCoursId ? (
                      <span className="cal-score-final">
                        {m.score_mtl ?? 0}-{m.score_adversaire ?? 0}
                      </span>
                    ) : (
                      <span className="cal-heure">
                        {formaterDateHeureMontreal(d, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </li>
              )
            }

            // Matchs à venir regroupés par mois
            const mois = []
            for (const m of aVenir) {
              const cle = formaterDateHeureMontreal(new Date(m.date_match), {
                month: 'long',
                year: 'numeric',
              })
              let g = mois[mois.length - 1]
              if (!g || g.cle !== cle) {
                g = { cle, matchs: [] }
                mois.push(g)
              }
              g.matchs.push(m)
            }

            return (
              <>
                {aVenir.length === 0 && <p className="info">Aucun match à venir.</p>}
                {mois.map((g) => (
                  <div key={g.cle} className="cal-mois-bloc">
                    <h3 className="cal-mois">{g.cle}</h3>
                    <ul className="liste-calendrier">{g.matchs.map((m, i) => tuile(m, i))}</ul>
                  </div>
                ))}
                {joues.length > 0 && (
                  <details className="repliable" id="cal-joues">
                    <summary className="repliable-titre">
                      ✅ Matchs joués ({joues.length})
                    </summary>
                    <ul className="liste-calendrier">
                      {[...joues].reverse().map((m, i) => tuile(m, i))}
                    </ul>
                  </details>
                )}
                {createPortal(
                  <div className="cal-flottants">
                    {prochainId && (
                      <button
                        type="button"
                        className="cal-flottant cal-flottant-prochain"
                        onClick={() => allerAuMatch('cal-prochain', false)}
                        aria-label="Aller au prochain match"
                      >
                        <span className="cal-flottant-icone">⏭️</span>
                        <span className="cal-flottant-texte">Prochain match</span>
                      </button>
                    )}
                    {dernierId && (
                      <button
                        type="button"
                        className="cal-flottant cal-flottant-dernier"
                        onClick={() => allerAuMatch('cal-dernier', true)}
                        aria-label="Aller au dernier match joué"
                      >
                        <span className="cal-flottant-icone">⏮️</span>
                        <span className="cal-flottant-texte">Dernier joué</span>
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
              </>
            )
          })()}
        </section>
      )}

      {onglet === 'classement-nhl' && (
        <section className="carte carte-rouge">
          <h2>📈 Classement LNH</h2>
          {chargementClassementNhl && <Squelette lignes={8} hauteur={34} />}
          {!chargementClassementNhl &&
            (() => {
              const qualifs = calculerQualifications(classementNhl)
              const parDivision = {}
              for (const e of classementNhl) {
                if (!parDivision[e.division]) parDivision[e.division] = []
                parDivision[e.division].push(e)
              }
              const ordrePrefere = ['Atlantique', 'Métropolitaine', 'Centrale', 'Pacifique']
              const divisions = [
                ...ordrePrefere.filter((d) => parDivision[d]),
                ...Object.keys(parDivision).filter((d) => !ordrePrefere.includes(d)),
              ]

              // Conférences : les qualifiées (par points) puis les autres
              const parPoints = (a, b) =>
                b.points - a.points || b.victoires - a.victoires || b.differentiel - a.differentiel
              const conferences = ['Est', 'Ouest']
                .map((nom) => {
                  const liste = classementNhl.filter((e) => conferenceDe(e) === nom)
                  const q = liste.filter((e) => qualifs[e.abbrev]).sort(parPoints)
                  const hors = liste.filter((e) => !qualifs[e.abbrev]).sort(parPoints)
                  return { nom, equipes: [...q, ...hors], nbQualifiees: q.length }
                })
                .filter((c) => c.equipes.length > 0)

              // Ligue : les 32 équipes par points
              const ligue = [...classementNhl].sort((a, b) =>
                a.rang_ligue !== b.rang_ligue && a.rang_ligue < 99 && b.rang_ligue < 99
                  ? a.rang_ligue - b.rang_ligue
                  : parPoints(a, b)
              )

              return (
                <>
                  <p className="note-tc">
                    <span className="badge-series badge-div">✔</span> 3 premières de la division ·{' '}
                    <span className="badge-series badge-wc">WC</span> carte sauvage. 16 équipes sur
                    32 passent en séries.
                  </p>

                  {divisions.map((div) => (
                    <details key={div} className="repliable">
                      <summary className="repliable-titre">{div}</summary>
                      <TableauNhl
                        equipes={[...parDivision[div]].sort((a, b) => a.rang_division - b.rang_division)}
                        rangs={[...parDivision[div]]
                          .sort((a, b) => a.rang_division - b.rang_division)
                          .map((e) => e.rang_division)}
                        qualifs={qualifs}
                        tri={triClassementNhl}
                        onTrier={setTriClassementNhl}
                        ligneApres={3}
                      />
                    </details>
                  ))}

                  {conferences.map((c) => (
                    <details key={c.nom} className="repliable">
                      <summary className="repliable-titre">Conférence {c.nom}</summary>
                      <TableauNhl
                        equipes={c.equipes}
                        qualifs={qualifs}
                        tri={triClassementNhl}
                        onTrier={setTriClassementNhl}
                        ligneApres={c.nbQualifiees}
                      />
                    </details>
                  ))}

                  <details className="repliable">
                    <summary className="repliable-titre">🌍 Toute la ligue</summary>
                    <TableauNhl
                      equipes={ligue}
                      qualifs={qualifs}
                      tri={triClassementNhl}
                      onTrier={setTriClassementNhl}
                    />
                  </details>
                </>
              )
            })()}
        </section>
      )}

      {onglet === 'stats-ligue' && (
        <section className="carte carte-rouge">
          <h2>🌐 Statistiques des joueurs — LNH</h2>
          <p className="note-tc">
            Tous les patineurs de la ligue, triés par points. Pas de tours du chapeau ni de
            forme récente ici (ça, c'est juste pour le Canadien, dans Stats CH).
          </p>
          <input
            type="text"
            className="recherche-stats-ligue"
            placeholder="Chercher un joueur ou une équipe..."
            value={rechercheStatsLigue}
            onChange={(e) => setRechercheStatsLigue(e.target.value)}
          />
          {rechercheStatsLigue.trim() === '' && (
            <div className="invite-recherche">
              <span className="invite-recherche-icone">🔎</span>
              <p>Écris le nom d'un joueur ou d'une équipe pour afficher les stats.</p>
            </div>
          )}
          {rechercheStatsLigue.trim() !== '' && chargementStatsLigue && (
            <Squelette lignes={8} hauteur={34} />
          )}
          {rechercheStatsLigue.trim() !== '' &&
            !chargementStatsLigue &&
            (() => {
              const q = rechercheStatsLigue.trim().toLowerCase()
              const filtre = q
                ? statsLigue.filter(
                    (j) => j.nom.toLowerCase().includes(q) || j.equipe.toLowerCase().includes(q)
                  )
                : statsLigue
              const trie = appliquerTri(filtre, triStatsLigue, (j, col) => j[col]).map((j, i) => ({
                ...j,
                rang: i + 1,
              }))
              return (
                <div className="table-stats-conteneur">
                  <table className="table-stats">
                    <thead>
                      <tr>
                        <th>#</th>
                        <ThTriable colonne="nom" tri={triStatsLigue} onTrier={setTriStatsLigue} estTexte enfant="Joueur" />
                        <ThTriable colonne="equipe" tri={triStatsLigue} onTrier={setTriStatsLigue} estTexte enfant="Équipe" />
                        <ThTriable colonne="position" tri={triStatsLigue} onTrier={setTriStatsLigue} estTexte enfant="Pos" />
                        <ThTriable colonne="matchs_joues" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="PJ" />
                        <ThTriable colonne="buts" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="B" />
                        <ThTriable colonne="passes" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="A" />
                        <ThTriable colonne="points" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="Pts" />
                        <ThTriable colonne="plus_minus" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="+/-" />
                        <ThTriable colonne="pun" tri={triStatsLigue} onTrier={setTriStatsLigue} enfant="PUN" />
                      </tr>
                    </thead>
                    <tbody>
                      {trie.map((j) => (
                        <tr key={j.playerId} className={j.equipe === 'MTL' ? 'ligne-mtl' : ''}>
                          <td>{j.rang}</td>
                          <td>
                            <button
                              className="nom-joueur-cliquable"
                              onClick={() => setFicheJoueur(j)}
                            >
                              {j.nom}
                            </button>
                          </td>
                          <td className="classement-nhl-equipe">
                            <LogoEquipe abbrev={j.equipe} taille={18} />
                            {j.equipe}
                          </td>
                          <td>{j.position}</td>
                          <td>{j.matchs_joues}</td>
                          <td>{j.buts}</td>
                          <td>{j.passes}</td>
                          <td className="col-cle">{j.points}</td>
                          <td>{j.plus_minus > 0 ? `+${j.plus_minus}` : j.plus_minus}</td>
                          <td>{j.pun}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtre.length === 0 && (
                    <p className="info">Aucun joueur trouvé pour "{rechercheStatsLigue}".</p>
                  )}
                </div>
              )
            })()}
        </section>
      )}

      {onglet === 'stats' && (
        <section className="carte carte-rouge">
          <h2>📊 Statistiques des joueurs — saison</h2>
          <p className="note-tc">
            TC = tours du chapeau · <IconeFeu /> chaud / <IconeGlace /> froid (5 derniers matchs) ·{' '}
            <IconePlasteur /> possiblement blessé (source non-officielle, à valider)
          </p>
          {chargementStats && <Squelette lignes={7} hauteur={38} />}
          {!chargementStats && (
            <div className="table-stats-conteneur">
              <table className="table-stats">
                <thead>
                  <tr>
                    <th></th>
                    <ThTriable colonne="nom" tri={triStats} onTrier={setTriStats} estTexte enfant="Joueur" />
                    <ThTriable colonne="matchs_joues" tri={triStats} onTrier={setTriStats} enfant="PJ" />
                    <ThTriable colonne="buts" tri={triStats} onTrier={setTriStats} enfant="B" />
                    <ThTriable colonne="passes" tri={triStats} onTrier={setTriStats} enfant="A" />
                    <ThTriable colonne="points" tri={triStats} onTrier={setTriStats} enfant="Pts" />
                    <ThTriable colonne="tours_chapeau" tri={triStats} onTrier={setTriStats} enfant="TC" />
                    <ThTriable colonne="forme" tri={triStats} onTrier={setTriStats} enfant="Forme" />
                  </tr>
                </thead>
                <tbody>
                  {appliquerTri(statsEquipe, triStats, (j, col) =>
                    col === 'forme' ? { chaud: 1, froid: -1 }[j.forme] || 0 : j[col]
                  ).map((j, i) => (
                    <tr
                      key={j.nom}
                      className="cascade-item"
                      style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                    >
                      <td className="cellule-photo">
                        <Headshot nhlId={j.playerId} taille={30} />
                      </td>
                      <td>
                        <button
                          className="nom-joueur-cliquable"
                          onClick={() => setFicheJoueur({ ...j, equipe: 'MTL' })}
                        >
                          {j.nom}
                        </button>
                        {j.blesse ? <> <IconePlasteur /></> : ''}
                      </td>
                      <td>{j.matchs_joues}</td>
                      <td>{j.buts}</td>
                      <td>{j.passes}</td>
                      <td className="col-cle">{j.points}</td>
                      <td>{j.tours_chapeau}</td>
                      <td>
                        {j.forme === 'chaud' && <IconeFeu />}
                        {j.forme === 'froid' && <IconeGlace />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {onglet === 'pool' && (
        <>
      {!match && <p className="info">Pas de match prévu pour le Canadien présentement.</p>}

      {match && (
        <section className="carte carte-rouge pool-carte">
          {/* Pendant le match, le tableau « EN DIRECT » (équipes + pointage) remplace cette carte */}
          {!jumbotronMontreLePointage && (
          <div className="pool-hero">
          <h2>🏒 Prochain match</h2>
          <div className="affrontement">
            <div className="affrontement-equipe">
              <LogoEquipe abbrev="MTL" taille={54} />
              <span className="affrontement-nom">MTL</span>
            </div>
            <span className="affrontement-vs">VS</span>
            <div className="affrontement-equipe">
              <LogoEquipe abbrev={match.adversaire} taille={54} />
              <span className="affrontement-nom">{match.adversaire}</span>
            </div>
          </div>
          <p className="date-match">
            {formaterDateHeureMontreal(new Date(match.date_match), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>

          {!jumbotronMontreLePointage && (
            <Chrono
              ms={new Date(match.date_match) - maintenant}
              urgent={new Date(match.date_match) - maintenant < 60 * 60 * 1000}
            />
          )}
          </div>
          )}

          {match.ordre_choix && (
            <div className="pool-bloc">
              <h3 className="pool-titre"><span className="pool-titre-icone">🎯</span>Ordre de choix</h3>
              <p className="pool-info">
                <span className="pool-info-icone">ℹ️</span>
                <span>
                  Une fois tes choix faits, tu peux les changer <strong>en tout temps</strong> (ton
                  joueur et ton pointage deviné), sauf quand le match est commencé.
                </span>
              </p>
              <ol
                className={'ordre-choix nb-' + match.ordre_choix.length}
                style={{ '--nb': match.ordre_choix.length }}
              >
                {match.ordre_choix.map((uid, i) => {
                  const aChoisi = tousLesChoix.some((c) => c.user_id === uid)
                  return (
                    <li
                      key={uid}
                      className={
                        'ordre-tuile ' +
                        (uid === session.user.id ? 'moi ' : '') +
                        (uid === prochainAChoisir ? 'tour-actuel ' : '') +
                        (aChoisi ? 'a-choisi' : '')
                      }
                    >
                      <span className="ordre-rang">{i + 1}</span>
                      <Pastille userId={uid} nom={NOMS[uid]} taille={34} />
                      <span className="ordre-nom">
                        {NOMS[uid] || 'Inconnu'}
                        {uid === session.user.id ? ' (toi)' : ''}
                      </span>
                      <span className="ordre-etat">
                        {aChoisi ? '✅ Choisi' : uid === prochainAChoisir ? '⏳ Son tour' : 'En attente'}
                      </span>
                    </li>
                  )
                })}
              </ol>
              {session.user.id === ADMIN_ID && !jumbotronMontreLePointage && (
                <div className="rappels-admin">
                  {match.ordre_choix
                    .filter(
                      (uid) => uid !== session.user.id && !tousLesChoix.some((c) => c.user_id === uid)
                    )
                    .map((uid) => (
                      <button
                        key={uid}
                        className="bouton-rappel"
                        onClick={() => envoyerRappel(uid)}
                        disabled={rappelEnCours !== null || uid !== prochainAChoisir}
                        title={
                          uid === prochainAChoisir
                            ? `Envoyer un rappel à ${NOMS[uid]}`
                            : `Ce n'est pas encore le tour de ${NOMS[uid]}`
                        }
                      >
                        {rappelEnCours === uid ? '⏳' : '🔔'} Rappeler {NOMS[uid]}
                      </button>
                    ))}
                  {messageRappel && <p className="rappels-message">{messageRappel}</p>}
                </div>
              )}
            </div>
          )}

          {jumbotronMontreLePointage ? (
            <div className="pool-bloc">
              <TableauDirect infos={infosNhl} adversaire={match.adversaire} />
              <p className="verrou">🔒 Les choix sont verrouillés, le match a commencé.</p>
            </div>
          ) : (
            <div className="pool-bloc">
              <h3 className="pool-titre"><span className="pool-titre-icone">✅</span>Ton choix</h3>
              {maLigneDeChoix && (
                <div className="carte-joueur-choisi">
                  <Headshot nhlId={maLigneDeChoix.joueurs?.nhl_id} taille={90} />
                  <div className="carte-joueur-infos">
                    <span className="carte-joueur-nom">{maLigneDeChoix.joueurs?.nom}</span>
                    {monJoueurDetails && (
                      <span className="carte-joueur-meta">
                        #{monJoueurDetails.numero} · {monJoueurDetails.position}
                      </span>
                    )}
                    {monJoueurDetails?.forme === 'chaud' && (
                      <span className="carte-joueur-forme chaud">
                        <IconeFeu /> En feu
                      </span>
                    )}
                    {monJoueurDetails?.forme === 'froid' && (
                      <span className="carte-joueur-forme froid">
                        <IconeGlace /> Tranquille
                      </span>
                    )}
                    {monJoueurDetails?.blesse && (
                      <span className="carte-joueur-forme blesse">
                        <IconePlasteur /> Possiblement blessé
                      </span>
                    )}
                  </div>
                </div>
              )}
              {alignementEnErreur ? (
                <div className="alignement-erreur">
                  <p>
                    ⚠️ La liste des joueurs n'a pas pu être chargée. L'API de la NHL répond
                    parfois mal — c'est temporaire.
                  </p>
                  <button onClick={chargerAlignement}>🔄 Réessayer</button>
                  {raisonAlignement && (
                    <p className="alignement-raison">Détail technique : {raisonAlignement}</p>
                  )}
                </div>
              ) : (
                <SelecteurJoueur
                  joueurs={joueurs}
                  nomsPris={tousLesChoix
                    .filter((c) => c.user_id !== session.user.id)
                    .map((c) => c.joueurs?.nom)
                    .filter(Boolean)}
                  nhlIdChoisi={maLigneDeChoix?.joueurs?.nhl_id || null}
                  onChoisir={choisirJoueur}
                />
              )}
              <p className="note-tc">
                <IconeFeu /> chaud · <IconeGlace /> froid (5 derniers matchs) ·{' '}
                <IconePlasteur /> possiblement blessé
              </p>
            </div>
          )}

          <PronosticPointage
            session={session}
            match={match}
            ferme={jumbotronMontreLePointage}
            version={versionMaj}
          />

          <div className="pool-bloc">
          <h3 className="pool-titre"><span className="pool-titre-icone">👥</span>Choix de tout le monde</h3>
          <ul className="liste-choix">
            {tousLesChoix.map((c) => (
              <li key={c.id} className="liste-choix-ligne">
                <Pastille userId={c.user_id} nom={NOMS[c.user_id]} taille={24} />
                <Headshot nhlId={c.joueurs?.nhl_id} taille={34} />
                <span>
                  {NOMS[c.user_id] || 'Inconnu'} → {c.joueurs?.nom}
                </span>
                {matchEnCoursProvisoire && (
                  <span className="points-provisoires">
                    {pointsProvisoires(c, statsDirectEffectives).points} pts
                  </span>
                )}
              </li>
            ))}
            {match.ordre_choix &&
              match.ordre_choix
                .filter((uid) => !tousLesChoix.some((c) => c.user_id === uid))
                .map((uid) => (
                  <li key={uid} className="pas-choisi liste-choix-ligne">
                    <Pastille userId={uid} nom={NOMS[uid]} taille={24} />
                    <span>{NOMS[uid] || 'Inconnu'} → pas encore choisi</span>
                  </li>
                ))}
          </ul>
          </div>

          {matchEnCoursProvisoire && (
            <div className="classement-provisoire pool-bloc">
              <h3 className="pool-titre"><span className="pool-titre-icone">🔴</span>Classement provisoire</h3>
              <p className="note-tc">
                🔴 En direct, pas final : points officiels + buts et passes du match en cours.
                Le vrai classement se met à jour quand le match est terminé.
              </p>
              <ol className="classement-provisoire-liste">
                {classementProvisoire(classement, tousLesChoix, statsDirectEffectives).map((c) => (
                  <li key={c.user_id}>
                    <span>
                      <Pastille userId={c.user_id} nom={NOMS[c.user_id]} taille={20} />{' '}
                      {NOMS[c.user_id] || 'Inconnu'}
                    </span>
                    <span className="points">{c.points} pts</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
        </>
      )}
      </div>
    </div>
  )
}

function HistoriqueOnglet({ historique, chargement, session }) {
  if (chargement) return <Squelette lignes={5} hauteur={60} />

  if (historique.length === 0) {
    return (
      <section className="carte carte-rouge">
        <h2>🕘 Historique</h2>
        <p className="info">
          Cette section va afficher, une fois le premier match calculé :
        </p>
        <ul className="liste-regles">
          <li>🏆 Le meilleur choix de la saison (le plus haut nombre de points en un match)</li>
          <li>Vos statistiques personnelles cumulées (points, buts, passes, tours du chapeau)</li>
          <li>Le joueur que chacun choisit le plus souvent</li>
          <li>L'historique complet, match par match</li>
        </ul>
        <p className="info">Revenez après le premier match calculé automatiquement!</p>
      </section>
    )
  }

  // Meilleur choix de la saison (plus haut nombre de points en un seul match)
  // (sans le bonus du pointage deviné : ça compte les points du joueur choisi)
  const pointsDuJoueur = (r) => r.points - (r.bonus || 0)
  const meilleurChoix = [...historique].sort((a, b) => pointsDuJoueur(b) - pointsDuJoueur(a))[0]

  // Stats personnelles agrégées par personne
  const statsParPersonne = {}
  for (const uid of ORDRE_BASE) {
    statsParPersonne[uid] = {
      matchs: 0,
      points: 0,
      buts: 0,
      passes: 0,
      tc: 0,
      joueursChoisis: {},
    }
  }
  for (const r of historique) {
    if (!statsParPersonne[r.user_id]) {
      statsParPersonne[r.user_id] = {
        matchs: 0,
        points: 0,
        buts: 0,
        passes: 0,
        tc: 0,
        joueursChoisis: {},
      }
    }
    const s = statsParPersonne[r.user_id]
    s.matchs += 1
    s.points += r.points
    s.buts += r.buts
    s.passes += r.passes
    s.tc += r.tour_chapeau ? 1 : 0
    const nomJoueur = r.joueurs?.nom || 'Inconnu'
    s.joueursChoisis[nomJoueur] = (s.joueursChoisis[nomJoueur] || 0) + 1
  }

  // Regrouper l'historique par match pour l'affichage chronologique
  const parMatch = {}
  for (const r of historique) {
    const cle = r.match_id
    if (!parMatch[cle]) {
      parMatch[cle] = {
        date: r.matchs?.date_match,
        adversaire: r.matchs?.adversaire,
        choix: [],
      }
    }
    parMatch[cle].choix.push(r)
  }
  const matchsTries = Object.values(parMatch).sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  )

  return (
    <>
      <section className="carte carte-rouge">
        <h2>🏆 Meilleur choix de la saison</h2>
        <div className="meilleur-choix-ligne">
          <Headshot nhlId={meilleurChoix.joueurs?.nhl_id} taille={52} />
          <p className="meilleur-choix">
            <strong>{NOMS[meilleurChoix.user_id] || 'Inconnu'}</strong> avec{' '}
            <strong>{meilleurChoix.joueurs?.nom}</strong> —{' '}
            <span className="points">{pointsDuJoueur(meilleurChoix)} points</span>
            <br />
            <span className="meilleur-choix-detail">
              {meilleurChoix.buts} buts, {meilleurChoix.passes} passes
              {meilleurChoix.tour_chapeau ? ', tour du chapeau 🎩' : ''} le{' '}
              {meilleurChoix.matchs?.date_match &&
                formaterDateHeureMontreal(new Date(meilleurChoix.matchs.date_match), {
                  day: 'numeric',
                  month: 'long',
                })}{' '}
              vs {meilleurChoix.matchs?.adversaire}
            </span>
          </p>
        </div>
      </section>

      <section className="carte carte-rouge">
        <h2>🙋 Statistiques personnelles</h2>
        {Object.entries(statsParPersonne).map(([uid, s]) => {
          const joueurFavori = Object.entries(s.joueursChoisis).sort((a, b) => b[1] - a[1])[0]
          return (
            <div key={uid} className="stats-perso-bloc">
              <h3 className="stats-perso-titre">
                <Pastille userId={uid} nom={NOMS[uid]} taille={24} /> {NOMS[uid] || 'Inconnu'}
              </h3>
              {joueurFavori && (
                <p className="stats-perso-ligne">
                  Joueur le plus choisi : <strong>{joueurFavori[0]}</strong> ({joueurFavori[1]}{' '}
                  fois)
                </p>
              )}
            </div>
          )
        })}
      </section>

      <section className="carte carte-rouge">
        <h2>🗂 Historique par match</h2>
        <ul className="liste-historique">
          {matchsTries.map((m, i) => (
            <li key={i}>
              <details>
                <summary className="historique-entete">
                  <span>
                    vs {m.adversaire} —{' '}
                    {m.date &&
                      formaterDateHeureMontreal(new Date(m.date), {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                  </span>
                  <span className="historique-chevron">▼</span>
                </summary>
                <div className="historique-contenu">
                  {m.choix
                    .slice()
                    .sort((a, b) => b.points - a.points)
                    .map((c) => (
                      <div key={c.id} className="historique-ligne">
                        <span className="historique-ligne-gauche">
                          <Pastille userId={c.user_id} nom={NOMS[c.user_id]} taille={20} />
                          <Headshot nhlId={c.joueurs?.nhl_id} taille={26} />
                          {NOMS[c.user_id] || 'Inconnu'} → {c.joueurs?.nom}
                        </span>
                        <span className="points">
                          {c.bonus > 0 && <span className="bonus-tag">🎯 +{c.bonus}</span>}
                          {c.points} pts
                        </span>
                      </div>
                    ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

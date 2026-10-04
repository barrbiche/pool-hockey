import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login'
import Crest from './Crest'
import Headshot from './Headshot'
import LogoEquipe from './LogoEquipe'
import { IconeFeu, IconeGlace, IconePlasteur } from './Icones'
import SelecteurJoueur from './SelecteurJoueur'
import Pastille from './Pastille'
import BoutonTheme from './Theme'
import './App.css'

function saisonEnCours(date = new Date()) {
  const mois = date.getUTCMonth()
  const anneeDebut = mois >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
  return {
    libelle: `${anneeDebut}-${anneeDebut + 1}`,
    debutSaison: new Date(Date.UTC(anneeDebut, 6, 1)), // 1er juillet
  }
}

// Ordre de base (match 1). Rotation ensuite : le 1er tombe dernier chaque match.
const ORDRE_BASE = [
  '0918539e-788e-4ed9-9c84-b8f39b83f05c', // Père
  '58220e78-2226-4983-a026-3abefc8431a7', // Mike (frère)
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090', // Eric
]

const NOMS = {
  '58220e78-2226-4983-a026-3abefc8431a7': 'Mike',
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090': 'Eric',
  '0918539e-788e-4ed9-9c84-b8f39b83f05c': 'Père',
}

function ordreChoixPourMatch(numeroMatch) {
  // numeroMatch commence à 1. Rotation gauche à chaque match.
  const decalage = (numeroMatch - 1) % 3
  return [...ORDRE_BASE.slice(decalage), ...ORDRE_BASE.slice(0, decalage)]
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
function estHeureAvanceeEst(date) {
  // Approximation fiable pour nos besoins : l'heure avancée de l'Est (EDT,
  // UTC-4) s'applique de mi-mars à début novembre, l'heure normale (EST,
  // UTC-5) le reste de l'année. Un pool de hockey (saison sept-juin) tombe
  // presque toujours en EDT sauf de novembre à mi-mars (EST).
  const mois = date.getUTCMonth() // 0 = janvier
  if (mois >= 3 && mois <= 9) return true // avril à octobre : toujours EDT
  if (mois === 10) return date.getUTCDate() < 2 // début novembre, avant le changement
  if (mois === 2) return date.getUTCDate() >= 8 // mi-mars, après le changement
  return false // nov (après le 1er) à fév : EST
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
      .map((c) => `• ${NOMS[c.user_id] || 'Inconnu'} → ${c.joueurs?.nom || '?'} (${c.points} pts)`)
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

export default function App() {
  const [session, setSession] = useState(null)
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChargement(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (chargement) return <div className="ecran-centre">Chargement...</div>
  if (!session) return <Login />

  return <Pool session={session} />
}

function Pool({ session }) {
  const [match, setMatch] = useState(null)
  const [joueurs, setJoueurs] = useState([])
  const [infosNhl, setInfosNhl] = useState(null)
  const [rafraichissementEnCours, setRafraichissementEnCours] = useState(false)
  const [majGlobaleEnCours, setMajGlobaleEnCours] = useState(false)
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
    try {
      const res = await fetch('/.netlify/functions/prochain-match')
      const data = await res.json()
      if (data.match) setInfosNhl(data.match)
    } catch {
      // pas grave, on retentera au prochain passage
    } finally {
      setRafraichissementEnCours(false)
    }
  }

  // Bouton d'en-tête "Tout mettre à jour" : force le calcul des points (ce
  // qui va chercher le boxscore à l'API de la NHL, au cas où le cron
  // automatique des 15 minutes n'aurait pas encore tourné), puis recharge
  // la page au complet pour que chaque onglet reparte à zéro et relise des
  // données fraîches dès qu'on clique dessus.
  async function toutMettreAJour() {
    setMajGlobaleEnCours(true)
    try {
      await fetch('/.netlify/functions/calculer-points')
    } catch {
      // pas grave, on recharge quand même avec ce qu'on a déjà
    } finally {
      window.location.reload()
    }
  }

  // Plus aucun rafraîchissement automatique pendant un match : le pointage
  // vient du chargement de la page et du bouton 🔄 manuel sur le tableau
  // en direct, point final. Zéro appel à la NHL tant que personne ne clique.

  useEffect(() => {
    initialiser()
  }, [])

  useEffect(() => {
    verifierAbonnementExistant()
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

  async function initialiser() {
    setChargement(true)
    try {
      const resMatch = await fetch('/.netlify/functions/prochain-match')
      const dataMatch = await resMatch.json()

      if (!dataMatch.match) {
        setChargement(false)
        return
      }

      // Infos fraîches venant de la NHL (pointage, période, en direct) —
      // la ligne en base ne contient que ce qui est figé.
      setInfosNhl(dataMatch.match)

      let { data: matchExistant } = await supabase
        .from('matchs')
        .select('*')
        .eq('nhl_game_id', dataMatch.match.nhl_game_id)
        .maybeSingle()

      if (!matchExistant) {
        // Compter combien de matchs existent déjà pour savoir le numéro de rotation
        const { count } = await supabase
          .from('matchs')
          .select('*', { count: 'exact', head: true })

        const numeroMatch = (count || 0) + 1
        const ordre = ordreChoixPourMatch(numeroMatch)

        const { data: nouveauMatch, error } = await supabase
          .from('matchs')
          .insert({
            nhl_game_id: dataMatch.match.nhl_game_id,
            date_match: dataMatch.match.date_match,
            adversaire: dataMatch.match.adversaire,
            statut: 'a_venir',
            ordre_choix: ordre,
          })
          .select()
          .single()
        if (error) throw error
        matchExistant = nouveauMatch
      }
      setMatch(matchExistant)

      await chargerAlignement()

      const { data: choixExistants } = await supabase
        .from('choix')
        .select('*, joueurs(nom, nhl_id)')
        .eq('match_id', matchExistant.id)

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
    const { data: matchsSaison } = await supabase
      .from('matchs')
      .select('id, date_match')
      .gte('date_match', debutSaison.toISOString())

    const idsMatchsSaison = new Set((matchsSaison || []).map((m) => m.id))
    if (idsMatchsSaison.size === 0) {
      setClassement([])
      return
    }

    const { data } = await supabase
      .from('resultats')
      .select('user_id, match_id, points, buts, passes, tour_chapeau')
      .in('match_id', Array.from(idsMatchsSaison))
    if (!data) return

    function totaliser(lignes) {
      const totaux = {}
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

      await initialiser()
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
      await fetch('/.netlify/functions/notifier-changement', {
        method: 'POST',
        body: JSON.stringify({
          user_id: session.user.id,
          nouveau_joueur: nouveauNomJoueur,
        }),
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
      await fetch('/.netlify/functions/envoyer-notification', {
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

  async function verifierAbonnementExistant() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      if (Notification.permission !== 'granted') return

      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      if (!registration) return

      const subscription = await registration.pushManager.getSubscription()
      if (subscription) setNotifsActivees(true)
    } catch {
      // pas grave, le bouton "Activer" reste juste disponible
    }
  }

  async function testerNotification() {
    setErreur('')
    try {
      const res = await fetch('/.netlify/functions/envoyer-notification', {
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

  async function activerNotifications() {
    try {
      // Détection iOS : Apple exige que le site soit installé sur l'écran
      // d'accueil (PWA) avant que les notifications push fonctionnent.
      const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const estStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true

      if (estIOS && !estStandalone) {
        setErreur(
          "📱 Sur iPhone, ajoute d'abord le site à l'écran d'accueil (bouton Partager → " +
            "\"Sur l'écran d'accueil\"), puis ouvre l'app depuis l'icône et réessaie."
        )
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

      await fetch('/.netlify/functions/enregistrer-abonnement', {
        method: 'POST',
        body: JSON.stringify({ user_id: session.user.id, subscription }),
      })

      setNotifsActivees(true)
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
      const { data: resultatsData } = await supabase
        .from('resultats')
        .select('*, joueurs(nom, nhl_id), matchs(date_match, adversaire)')
        .order('calcule_le', { ascending: false })

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
      <header className="entete">
        <div className="entete-titre">
          <Crest taille={36} />
          <h1>Pool de Hockey</h1>
        </div>
        <div className="entete-actions">
          <BoutonTheme />
          {!notifsActivees && (
            <button className="bouton-lien" onClick={activerNotifications}>
              🔔 Activer
            </button>
          )}
          <button
            className="bouton-lien"
            onClick={toutMettreAJour}
            disabled={majGlobaleEnCours}
            title="Calcule les points du match (si terminé) et recharge tout le site avec les dernières infos de la NHL"
          >
            {majGlobaleEnCours ? '⏳ Mise à jour...' : '🔄 Bouton à Pa!'}
          </button>
          <button className="bouton-lien" onClick={() => supabase.auth.signOut()}>
            Déconnexion
          </button>
        </div>
      </header>

      <div className="onglets">
        <button
          className={onglet === 'pool' ? 'onglet actif' : 'onglet'}
          onClick={() => setOnglet('pool')}
        >
          Pool
        </button>
        <button
          className={onglet === 'stats' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('stats')
            if (statsEquipe.length === 0) chargerStatsEquipe()
          }}
        >
          Stats CH
        </button>
        <button
          className={onglet === 'calendrier' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('calendrier')
            if (calendrier.length === 0) chargerCalendrier()
          }}
        >
          Calendrier
        </button>
        <button
          className={onglet === 'historique' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('historique')
            if (historique.length === 0) chargerHistorique()
          }}
        >
          Historique
        </button>
        <button
          className={onglet === 'classement' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('classement')
            if (historique.length === 0) chargerHistorique()
          }}
        >
          Classement
        </button>
        <button
          className={onglet === 'classement-nhl' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('classement-nhl')
            if (classementNhl.length === 0) chargerClassementNhl()
          }}
        >
          Classement LNH
        </button>
        <button
          className={onglet === 'stats-ligue' ? 'onglet actif' : 'onglet'}
          onClick={() => {
            setOnglet('stats-ligue')
            if (statsLigue.length === 0) chargerStatsLigue()
          }}
        >
          Stats LNH
        </button>
        <button
          className={onglet === 'reglements' ? 'onglet actif' : 'onglet'}
          onClick={() => setOnglet('reglements')}
        >
          Règlements
        </button>
      </div>

      {erreur && <Alerte key={erreur} message={erreur} onFermer={() => setErreur('')} />}

      <div key={onglet} className="contenu-onglet">
      {onglet === 'classement' && (
        <section className="carte">
          <div className="classement-entete-section">
            <h2>Classement</h2>
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
                        {c.buts} buts · {c.passes} passes · {c.tc} tours du chapeau
                      </div>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </section>
      )}

      {onglet === 'reglements' && (
        <section className="carte">
          <h2>Comment ça marche</h2>
          <ul className="liste-regles">
            <li>Chacun choisit un joueur du Canadien avant chaque match.</li>
            <li>1 but = 2 points, 1 passe = 1 point, tour du chapeau = +3 points bonus.</li>
            <li>L'ordre de choix tourne à chaque match (3-2-1) pour toute la saison.</li>
            <li>
              <strong>Si tu ne choisis pas à temps, le système choisit pour toi</strong>{' '}
              automatiquement : ton joueur du match précédent (s'il est encore libre), sinon le
              meilleur pointeur du CH encore disponible. Chacun a sa propre limite : le 1er choix
              doit être fait 1h30 avant le match, le 2e 1h avant, le 3e 30 min avant — ça laisse
              toujours une marge de 30 minutes avant le début du match.
            </li>
            <li>Une fois le match commencé, plus moyen de changer de joueur.</li>
          </ul>
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
          <h2>Calendrier {saisonEnCours().libelle}</h2>
          {chargementCalendrier && <Squelette lignes={8} hauteur={34} />}
          {!chargementCalendrier && (
            <ul className="liste-calendrier">
              {calendrier.map((m, i) => (
                <li
                  key={m.nhl_game_id}
                  className={'cascade-item ' + (matchTermine(m.statut) ? 'joue' : '')}
                  style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                >
                  <span className="cal-date">
                    {formaterDateHeureMontreal(new Date(m.date_match), {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="cal-adversaire">
                    <LogoEquipe abbrev={m.adversaire} taille={22} />
                    {m.domicile ? 'vs' : '@'} {m.adversaire}
                  </span>
                  <span className="cal-score">
                    {matchTermine(m.statut)
                      ? `${m.score_mtl} - ${m.score_adversaire}`
                      : formaterDateHeureMontreal(new Date(m.date_match), {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {onglet === 'classement-nhl' && (
        <section className="carte carte-rouge">
          <h2>Classement LNH</h2>
          {chargementClassementNhl && <Squelette lignes={8} hauteur={34} />}
          {!chargementClassementNhl &&
            (() => {
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
              return divisions.map((div) => (
                <div key={div} className="classement-nhl-division">
                  <h3 className="classement-nhl-titre-division">{div}</h3>
                  <div className="table-stats-conteneur">
                    <table className="table-stats">
                      <thead>
                        <tr>
                          <th>#</th>
                          <ThTriable colonne="nom" tri={triClassementNhl} onTrier={setTriClassementNhl} estTexte enfant="Équipe" />
                          <ThTriable colonne="matchs_joues" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="PJ" />
                          <ThTriable colonne="victoires" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="V" />
                          <ThTriable colonne="defaites" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="D" />
                          <ThTriable colonne="defaites_prolongation" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="DP" />
                          <ThTriable colonne="points" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="Pts" />
                          <ThTriable colonne="differentiel" tri={triClassementNhl} onTrier={setTriClassementNhl} enfant="Diff" />
                        </tr>
                      </thead>
                      <tbody>
                        {appliquerTri(parDivision[div], triClassementNhl, (e, col) => e[col]).map(
                          (e, i) => (
                            <tr key={e.abbrev} className={e.abbrev === 'MTL' ? 'ligne-mtl' : ''}>
                              <td>{triClassementNhl ? i + 1 : e.rang_division}</td>
                              <td className="classement-nhl-equipe">
                                <LogoEquipe abbrev={e.abbrev} taille={22} />
                                {e.nom}
                              </td>
                              <td>{e.matchs_joues}</td>
                              <td>{e.victoires}</td>
                              <td>{e.defaites}</td>
                              <td>{e.defaites_prolongation}</td>
                              <td>{e.points}</td>
                              <td>{e.differentiel > 0 ? `+${e.differentiel}` : e.differentiel}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            })()}
        </section>
      )}

      {onglet === 'stats-ligue' && (
        <section className="carte carte-rouge">
          <h2>Statistiques des joueurs — LNH</h2>
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
          {chargementStatsLigue && <Squelette lignes={8} hauteur={34} />}
          {!chargementStatsLigue &&
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
                          <td>{j.points}</td>
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
          <h2>Statistiques des joueurs — saison</h2>
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
                      <td>{j.points}</td>
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
        <section className="carte carte-rouge">
          <h2>Prochain match</h2>
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

          {match.ordre_choix && (
            <>
              <h3>Ordre de choix ce match</h3>
              <ol className="ordre-choix">
                {match.ordre_choix.map((uid) => (
                  <li
                    key={uid}
                    className={
                      (uid === session.user.id ? 'moi ' : '') +
                      (uid === prochainAChoisir ? 'tour-actuel' : '')
                    }
                  >
                    <Pastille userId={uid} nom={NOMS[uid]} taille={20} />
                    {NOMS[uid] || 'Inconnu'}
                    {uid === prochainAChoisir ? ' 👈' : ''}
                  </li>
                ))}
              </ol>
            </>
          )}

          {jumbotronMontreLePointage ? (
            <>
              <TableauDirect infos={infosNhl} adversaire={match.adversaire} />
              <p className="verrou">🔒 Les choix sont verrouillés, le match a commencé.</p>
            </>
          ) : (
            <>
              <h3>Ton choix</h3>
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
            </>
          )}

          <h3>Choix de tout le monde</h3>
          <ul className="liste-choix">
            {tousLesChoix.map((c) => (
              <li key={c.id} className="liste-choix-ligne">
                <Pastille userId={c.user_id} nom={NOMS[c.user_id]} taille={24} />
                <Headshot nhlId={c.joueurs?.nhl_id} taille={34} />
                <span>
                  {NOMS[c.user_id] || 'Inconnu'} → {c.joueurs?.nom}
                </span>
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

          <div className="actualiser-bloc">
            <button
              className="bouton-actualiser"
              onClick={rafraichirPointage}
              disabled={rafraichissementEnCours}
            >
              {rafraichissementEnCours ? '⏳ Mise à jour en cours...' : '🔄 Mise à jour'}
            </button>
            <p className="actualiser-note">
              À utiliser seulement si le score ou les points ne semblent pas à jour. Ce bouton
              aide à garder l'information à jour sur le site, sans surcharger l'API de la NHL —
              question de ne pas risquer de s'en faire couper l'accès aux données automatiques du
              site.
            </p>
          </div>
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
        <h2>Historique</h2>
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
  const meilleurChoix = [...historique].sort((a, b) => b.points - a.points)[0]

  // Stats personnelles agrégées par personne
  const statsParPersonne = {}
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
            <span className="points">{meilleurChoix.points} points</span>
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
        <h2>Statistiques personnelles</h2>
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
        <h2>Historique par match</h2>
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
                        <span className="points">{c.points} pts</span>
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

import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login'
import Crest from './Crest'
import Headshot from './Headshot'
import LogoEquipe from './LogoEquipe'
import { IconeFeu, IconeGlace, IconePlasteur } from './Icones'
import SelecteurJoueur from './SelecteurJoueur'
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
  const [celebration, setCelebration] = useState(false)
  const celebrationVictoireFaite = useRef(false)

  // Lance les confettis pour quelques secondes
  function lancerCelebration() {
    setCelebration(true)
    setTimeout(() => setCelebration(false), 4200)
  }

  const matchCommence = match ? maintenant >= new Date(match.date_match) : false

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

  useEffect(() => {
    initialiser()
  }, [])

  useEffect(() => {
    verifierAbonnementExistant()
  }, [])

  async function initialiser() {
    setChargement(true)
    try {
      const resMatch = await fetch('/.netlify/functions/prochain-match')
      const dataMatch = await resMatch.json()

      if (!dataMatch.match) {
        setChargement(false)
        return
      }

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

      const resRoster = await fetch('/.netlify/functions/roster')
      const dataRoster = await resRoster.json()
      setJoueurs(dataRoster.joueurs || [])

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
    const { data: matchsSaison } = await supabase
      .from('matchs')
      .select('id')
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

    const totaux = {}
    for (const r of data) {
      if (!totaux[r.user_id]) {
        totaux[r.user_id] = { user_id: r.user_id, points: 0, buts: 0, passes: 0, tc: 0 }
      }
      totaux[r.user_id].points += r.points
      totaux[r.user_id].buts += r.buts || 0
      totaux[r.user_id].passes += r.passes || 0
      totaux[r.user_id].tc += r.tour_chapeau ? 1 : 0
    }
    const liste = Object.values(totaux).sort((a, b) => b.points - a.points)
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
      <header className="entete">
        <div className="entete-titre">
          <Crest taille={36} />
          <h1>Pool de Hockey</h1>
        </div>
        <div className="entete-actions">
          {!notifsActivees && (
            <button className="bouton-lien" onClick={activerNotifications}>
              🔔 Activer
            </button>
          )}
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
          onClick={() => setOnglet('classement')}
        >
          Classement
        </button>
        <button
          className={onglet === 'reglements' ? 'onglet actif' : 'onglet'}
          onClick={() => setOnglet('reglements')}
        >
          Règlements
        </button>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}

      <div key={onglet} className="contenu-onglet">
      {onglet === 'classement' && (
        <section className="carte">
          <h2>Classement</h2>
          <ol className="classement">
            {classement.map((c, i) => {
              const maxPoints = classement[0]?.points || 0
              const pourcentage = maxPoints > 0 ? Math.max(4, Math.round((c.points / maxPoints) * 100)) : 0
              return (
                <li
                  key={c.user_id}
                  className={
                    i === 0 ? 'rang-or' : i === 1 ? 'rang-argent' : i === 2 ? 'rang-bronze' : ''
                  }
                >
                  <div className="classement-ligne-haut">
                    <span className="classement-nom">
                      {i === 0 && '🥇 '}
                      {i === 1 && '🥈 '}
                      {i === 2 && '🥉 '}
                      {NOMS[c.user_id] || 'Inconnu'}
                    </span>
                    <span className="points">{c.points} pts</span>
                  </div>
                  <div className="barre-progression">
                    <div className="barre-progression-remplissage" style={{ width: `${pourcentage}%` }} />
                  </div>
                  <div className="classement-detail">
                    {c.buts} buts · {c.passes} passes · {c.tc} tours du chapeau
                  </div>
                </li>
              )
            })}
            {classement.length === 0 && <li>Aucun résultat encore</li>}
          </ol>
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
              {calendrier.map((m) => (
                <li key={m.nhl_game_id} className={matchTermine(m.statut) ? 'joue' : ''}>
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
                    <th>Joueur</th>
                    <th>PJ</th>
                    <th>B</th>
                    <th>A</th>
                    <th>Pts</th>
                    <th>TC</th>
                    <th>Forme</th>
                  </tr>
                </thead>
                <tbody>
                  {statsEquipe.map((j) => (
                    <tr key={j.nom}>
                      <td className="cellule-photo">
                        <Headshot nhlId={j.playerId} taille={30} />
                      </td>
                      <td>
                        {j.nom}
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

          {!matchCommence && (
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
                    {NOMS[uid] || 'Inconnu'}
                    {uid === prochainAChoisir ? ' 👈' : ''}
                  </li>
                ))}
              </ol>
            </>
          )}

          {matchCommence ? (
            <p className="verrou">🔒 Les choix sont verrouillés, le match a commencé.</p>
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
              <SelecteurJoueur
                joueurs={joueurs}
                nomsPris={tousLesChoix
                  .filter((c) => c.user_id !== session.user.id)
                  .map((c) => c.joueurs?.nom)
                  .filter(Boolean)}
                nhlIdChoisi={maLigneDeChoix?.joueurs?.nhl_id || null}
                onChoisir={choisirJoueur}
              />
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
                  <li key={uid} className="pas-choisi">
                    {NOMS[uid] || 'Inconnu'} → pas encore choisi
                  </li>
                ))}
          </ul>
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
              <h3>{NOMS[uid] || 'Inconnu'}</h3>
              <p className="stats-perso-ligne">
                {s.matchs} matchs · {s.points} points au total · {s.buts} buts · {s.passes} passes
                · {s.tc} tours du chapeau
              </p>
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
              <div className="historique-entete">
                vs {m.adversaire} —{' '}
                {m.date &&
                  formaterDateHeureMontreal(new Date(m.date), { day: 'numeric', month: 'short' })}
              </div>
              {m.choix
                .slice()
                .sort((a, b) => b.points - a.points)
                .map((c) => (
                  <div key={c.id} className="historique-ligne">
                    <span className="historique-ligne-gauche">
                      <Headshot nhlId={c.joueurs?.nhl_id} taille={26} />
                      {NOMS[c.user_id] || 'Inconnu'} → {c.joueurs?.nom}
                    </span>
                    <span className="points">{c.points} pts</span>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

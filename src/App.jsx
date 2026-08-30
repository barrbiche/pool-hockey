import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login'
import './App.css'

// Ordre de base (match 1). Rotation ensuite : le 1er tombe dernier chaque match.
const ORDRE_BASE = [
  '06b2700c-e470-491e-b384-c77e2f3f25bb', // Père
  'a8e88366-d2dd-4ecb-abde-076c8aead8e5', // Mike (frère)
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090', // Eric
]

const NOMS = {
  'a8e88366-d2dd-4ecb-abde-076c8aead8e5': 'Mike',
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090': 'Eric',
  '06b2700c-e470-491e-b384-c77e2f3f25bb': 'Père',
}

function ordreChoixPourMatch(numeroMatch) {
  // numeroMatch commence à 1. Rotation gauche à chaque match.
  const decalage = (numeroMatch - 1) % 3
  return [...ORDRE_BASE.slice(decalage), ...ORDRE_BASE.slice(0, decalage)]
}

function formaterCompteARebours(ms) {
  if (ms <= 0) return null
  const totalSecondes = Math.floor(ms / 1000)
  const heures = Math.floor(totalSecondes / 3600)
  const minutes = Math.floor((totalSecondes % 3600) / 60)
  const secondes = totalSecondes % 60
  if (heures > 0) return `${heures}h ${minutes}m ${secondes}s`
  if (minutes > 0) return `${minutes}m ${secondes}s`
  return `${secondes}s`
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
  const [monChoix, setMonChoix] = useState(null)
  const [tousLesChoix, setTousLesChoix] = useState([])
  const [classement, setClassement] = useState([])
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(true)
  const [onglet, setOnglet] = useState('pool')
  const [statsEquipe, setStatsEquipe] = useState([])
  const [chargementStats, setChargementStats] = useState(false)
  const [calendrier, setCalendrier] = useState([])
  const [chargementCalendrier, setChargementCalendrier] = useState(false)
  const [maintenant, setMaintenant] = useState(new Date())

  const matchCommence = match ? maintenant >= new Date(match.date_match) : false

  const prochainAChoisir =
    match?.ordre_choix?.find((uid) => !tousLesChoix.some((c) => c.user_id === uid)) || null
  const monTour = !prochainAChoisir || prochainAChoisir === session.user.id

  useEffect(() => {
    const intervalle = setInterval(() => setMaintenant(new Date()), 1000)
    return () => clearInterval(intervalle)
  }, [])

  useEffect(() => {
    initialiser()
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
        .select('*, joueurs(nom)')
        .eq('match_id', matchExistant.id)

      setTousLesChoix(choixExistants || [])
      const mienChoix = (choixExistants || []).find((c) => c.user_id === session.user.id)
      if (mienChoix) setMonChoix(mienChoix.joueur_id)

      await chargerClassement()
    } catch (err) {
      setErreur(err.message)
    } finally {
      setChargement(false)
    }
  }

  async function chargerClassement() {
    const { data } = await supabase.from('resultats').select('user_id, points')
    if (!data) return

    const totaux = {}
    for (const r of data) {
      totaux[r.user_id] = (totaux[r.user_id] || 0) + r.points
    }
    const liste = Object.entries(totaux)
      .map(([user_id, points]) => ({ user_id, points }))
      .sort((a, b) => b.points - a.points)
    setClassement(liste)
  }

  async function choisirJoueur(joueurNhl) {
    setErreur('')

    if (!monTour) {
      setErreur(`⏳ ATTENDS TON TOUR TRICHEUR ! 😄 C'est à ${NOMS[prochainAChoisir]} de choisir.`)
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

      setMonChoix(joueurDb.id)
      initialiser()
    } catch (err) {
      setErreur(err.message)
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

  if (chargement) return <div className="ecran-centre">Chargement...</div>

  return (
    <div className="conteneur">
      <header className="entete">
        <h1>Pool de Hockey 🏒</h1>
        <button className="bouton-lien" onClick={() => supabase.auth.signOut()}>
          Déconnexion
        </button>
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
      </div>

      {erreur && <p className="erreur">{erreur}</p>}

      {onglet === 'calendrier' && (
        <section className="carte carte-rouge">
          <h2>Calendrier 2026-2027</h2>
          {chargementCalendrier && <p className="info">Chargement...</p>}
          {!chargementCalendrier && (
            <ul className="liste-calendrier">
              {calendrier.map((m) => (
                <li key={m.nhl_game_id} className={m.statut === 'OFF' ? 'joue' : ''}>
                  <span className="cal-date">
                    {new Date(m.date_match).toLocaleDateString('fr-CA', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="cal-adversaire">
                    {m.domicile ? 'vs' : '@'} {m.adversaire}
                  </span>
                  <span className="cal-score">
                    {m.statut === 'OFF'
                      ? `${m.score_mtl} - ${m.score_adversaire}`
                      : new Date(m.date_match).toLocaleTimeString('fr-CA', {
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
          <p className="note-tc">TC = tours du chapeau</p>
          {chargementStats && <p className="info">Chargement...</p>}
          {!chargementStats && (
            <div className="table-stats-conteneur">
              <table className="table-stats">
                <thead>
                  <tr>
                    <th>Joueur</th>
                    <th>PJ</th>
                    <th>B</th>
                    <th>A</th>
                    <th>Pts</th>
                    <th>TC</th>
                  </tr>
                </thead>
                <tbody>
                  {statsEquipe.map((j) => (
                    <tr key={j.nom}>
                      <td>{j.nom}</td>
                      <td>{j.matchs_joues}</td>
                      <td>{j.buts}</td>
                      <td>{j.passes}</td>
                      <td>{j.points}</td>
                      <td>{j.tours_chapeau}</td>
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
          <h2>Prochain match vs {match.adversaire}</h2>
          <p className="date-match">
            {new Date(match.date_match).toLocaleString('fr-CA', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>

          {!matchCommence && (
            <p
              className={
                new Date(match.date_match) - maintenant < 60 * 60 * 1000
                  ? 'compte-a-rebours urgent'
                  : 'compte-a-rebours'
              }
            >
              ⏱️ Temps restant pour choisir : {formaterCompteARebours(new Date(match.date_match) - maintenant)}
            </p>
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
              <select
                className="selecteur-joueur"
                value={monChoix || ''}
                onChange={(e) => {
                  const j = joueurs.find((j) => j.nhl_id === parseInt(e.target.value))
                  if (j) choisirJoueur(j)
                }}
              >
                <option value="">-- Choisis un joueur --</option>
                {joueurs.map((j) => (
                  <option key={j.nhl_id} value={j.nhl_id}>
                    #{j.numero} {j.nom} ({j.position})
                  </option>
                ))}
              </select>
            </>
          )}

          <h3>Choix de tout le monde</h3>
          <ul className="liste-choix">
            {tousLesChoix.map((c) => (
              <li key={c.id}>
                {NOMS[c.user_id] || 'Inconnu'} → {c.joueurs?.nom}
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

      <section className="carte">
        <h2>Classement</h2>
        <ol className="classement">
          {classement.map((c, i) => (
            <li key={c.user_id}>
              <span>{NOMS[c.user_id] || 'Inconnu'}</span>
              <span className="points">{c.points} pts</span>
            </li>
          ))}
          {classement.length === 0 && <li>Aucun résultat encore</li>}
        </ol>
      </section>
        </>
      )}
    </div>
  )
}

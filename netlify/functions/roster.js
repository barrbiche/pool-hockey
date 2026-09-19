// Retourne l'alignement actuel du Canadien de Montréal, trié par points
// de la saison précédente, avec la forme récente (5 derniers matchs) et le
// statut de blessure (best-effort, source non-officielle gratuite).
// Tout est calculé dynamiquement par rapport à la date du jour — aucune
// mise à jour manuelle requise d'une année à l'autre.
//
// IMPORTANT : les fonctions Netlify sont coupées après ~10 secondes. Les
// enrichissements (forme, blessures) ont donc chacun un budget de temps
// strict. S'ils dépassent, on retourne quand même l'alignement de base :
// mieux vaut une liste sans les icônes 🔥❄️ qu'une liste vide.
import { saisonEnCours } from './_participants.js'

// fetch avec limite de temps stricte. Retourne { data, raison } : la
// raison sert au diagnostic quand ça échoue, pour ne jamais être aveugle.
async function fetchJson(url, delaiMs) {
  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), delaiMs)
  try {
    const res = await fetch(url, {
      signal: controleur.signal,
      headers: {
        // Certaines API refusent les requêtes sans User-Agent identifiable.
        'User-Agent': 'pool-hockey/1.0',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return { data: null, raison: `HTTP ${res.status} ${res.statusText}` }
    return { data: await res.json(), raison: null }
  } catch (err) {
    const estDelai = err.name === 'AbortError'
    return {
      data: null,
      raison: estDelai ? `délai dépassé après ${delaiMs} ms` : `réseau: ${err.message}`,
    }
  } finally {
    clearTimeout(minuterie)
  }
}

// Le chargement de l'alignement est l'appel critique : on lui donne deux
// chances avant d'abandonner, une panne passagère étant fréquente.
async function chargerAlignement(delaiParEssai) {
  let derniereRaison = 'inconnue'
  for (let essai = 1; essai <= 2; essai++) {
    const { data, raison } = await fetchJson(
      'https://api-web.nhle.com/v1/roster/MTL/current',
      delaiParEssai
    )
    if (data) return { data, raison: null }
    derniereRaison = `essai ${essai}: ${raison}`
  }
  return { data: null, raison: derniereRaison }
}

// Laisse une tâche s'exécuter au maximum `delaiMs`, sinon abandonne et
// continue avec ce qu'on a. Un budget nul ou négatif abandonne tout de suite.
function avecBudget(promesse, delaiMs) {
  if (delaiMs <= 0) return Promise.resolve(null)
  return Promise.race([
    promesse,
    new Promise((resoudre) => setTimeout(() => resoudre(null), delaiMs)),
  ])
}

// Découpe en lots pour ne pas envoyer 50 requêtes d'un coup à l'API du NHL
// (ce qui la faisait ralentir ou limiter le débit).
async function formeRecente(joueurs) {
  const TAILLE_LOT = 8
  for (let debut = 0; debut < joueurs.length; debut += TAILLE_LOT) {
    const lot = joueurs.slice(debut, debut + TAILLE_LOT)
    const resultats = await Promise.all(
      lot.map((j) => fetchJson(`https://api-web.nhle.com/v1/player/${j.nhl_id}/game-log/now`, 2500))
    )
    resultats.forEach(({ data }, i) => {
      const derniers5 = (data?.gameLog || []).slice(0, 5)
      if (derniers5.length === 0) return
      const totalPoints = derniers5.reduce((acc, g) => acc + (g.points || 0), 0)
      const moyenne = totalPoints / derniers5.length
      if (moyenne >= 1) lot[i].forme = 'chaud'
      else if (moyenne === 0) lot[i].forme = 'froid'
    })
  }
  return true
}

// Points de la saison précédente
async function pointsSaisonPrecedente(joueurs, delaiMs) {
  const { codeApi } = saisonEnCours(new Date())
  const anneeDebutPrecedente = parseInt(codeApi.slice(0, 4)) - 1
  const codeApiPrecedente = `${anneeDebutPrecedente}${anneeDebutPrecedente + 1}`
  const { data: dataStats } = await fetchJson(
    `https://api-web.nhle.com/v1/club-stats/MTL/${codeApiPrecedente}/2`,
    delaiMs
  )
  if (!dataStats) return null
  const pointsParJoueur = {}
  for (const s of dataStats.skaters || []) {
    pointsParJoueur[s.playerId] = s.points || 0
  }
  for (const j of joueurs) {
    j.points_saison_derniere = pointsParJoueur[j.nhl_id] || 0
  }
  return true
}

// Blessures (source non-officielle ESPN, best-effort)
async function blessures(joueurs, delaiMs) {
  const { data } = await fetchJson(
    'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/mtl/injuries',
    delaiMs
  )
  if (!data) return null
  const liste = data?.injuries || data?.team?.injuries || []
  for (const item of liste) {
    const nomBlesse = (item.athlete?.displayName || item.displayName || '').toLowerCase()
    const joueurTrouve = joueurs.find((j) => nomBlesse.includes(j.nom.toLowerCase()))
    if (joueurTrouve) {
      joueurTrouve.blesse = true
      joueurTrouve.statut_blessure = item.status || item.type?.description || 'Blessé'
    }
  }
  return true
}

export async function handler() {
  // Échéance globale sous la coupure de ~10s de Netlify. L'alignement a
  // droit à deux essais de 4 s : c'est l'appel sans lequel rien ne marche,
  // et l'API du NHL est lente depuis les serveurs de Netlify.
  const debut = Date.now()
  const LIMITE_MS = 8500
  const tempsRestant = () => LIMITE_MS - (Date.now() - debut)

  try {
    const { data, raison } = await chargerAlignement(4000)
    if (!data) {
      return {
        statusCode: 503,
        // Surtout ne pas mettre un échec en cache: il serait resservi
        // à tout le monde pendant 15 minutes.
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          error: "L'API de la NHL ne répond pas présentement.",
          // Raison technique exacte, pour pouvoir diagnostiquer au lieu de
          // deviner quand ça se reproduit.
          raison,
          duree_ms: Date.now() - debut,
          joueurs: [],
        }),
      }
    }

    const joueurs = [
      ...(data.forwards || []),
      ...(data.defensemen || []),
      ...(data.goalies || []),
    ].map((j) => ({
      nhl_id: j.id,
      nom: `${j.firstName.default} ${j.lastName.default}`,
      numero: j.sweaterNumber,
      position: j.positionCode,
      points_saison_derniere: 0,
      forme: null, // 'chaud' | 'froid' | null
      blesse: false,
      statut_blessure: null,
    }))

    // Si l'alignement lui-même est vide, inutile de continuer
    if (joueurs.length === 0) {
      return {
        statusCode: 503,
        // Surtout ne pas mettre un échec en cache: il serait resservi
        // à tout le monde pendant 15 minutes.
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Alignement vide reçu de la NHL.', joueurs: [] }),
      }
    }

    // Les trois enrichissements sont indépendants : on les lance en
    // parallèle, chacun plafonné par le temps qu'il reste. Si l'un traîne,
    // on retourne quand même la liste sans son apport.
    const reste = tempsRestant()
    await Promise.all([
      avecBudget(pointsSaisonPrecedente(joueurs, Math.min(2500, reste)), Math.min(2500, reste)),
      avecBudget(formeRecente(joueurs), Math.min(4000, reste)),
      avecBudget(blessures(joueurs, Math.min(2000, reste)), Math.min(2000, reste)),
    ])

    joueurs.sort(
      (a, b) => b.points_saison_derniere - a.points_saison_derniere || a.nom.localeCompare(b.nom)
    )

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // L'alignement du CH change quelques fois par saison, pas aux
        // 10 secondes. On laisse le réseau de Netlify garder la réponse
        // 15 minutes : les visites suivantes sont servies instantanément
        // sans toucher à l'API du NHL, qui est lente et capricieuse depuis
        // les serveurs de Netlify. C'est ce qui rend la liste fiable.
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
      },
      body: JSON.stringify({ joueurs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: err.message, joueurs: [] }),
    }
  }
}

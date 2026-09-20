// Retourne tout le calendrier de la saison du Canadien de Montréal
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const data = await res.json()

    // Garder seulement les vrais matchs de saison régulière ou séries
    // (gameType 2 = régulière, 3 = séries) avec de vraies équipes connues
    // (pas des "places réservées" pour des séries pas encore déterminées),
    // et dédupliquer par id au cas où l'API renvoie des doublons.
    const vus = new Set()
    const matchsUniques = (data.games || []).filter((g) => {
      if (g.gameType !== 2 && g.gameType !== 3) return false
      if (!g.homeTeam?.abbrev || !g.awayTeam?.abbrev) return false
      if (vus.has(g.id)) return false
      vus.add(g.id)
      return true
    })

    const matchs = matchsUniques.map((g) => {
      const domicile = g.homeTeam.abbrev === 'MTL'
      const adversaire = domicile ? g.awayTeam.abbrev : g.homeTeam.abbrev
      return {
        nhl_game_id: g.id,
        date_match: g.startTimeUTC,
        adversaire,
        domicile,
        statut: g.gameState,
        score_mtl: domicile ? g.homeTeam.score : g.awayTeam.score,
        score_adversaire: domicile ? g.awayTeam.score : g.homeTeam.score,
      }
    })

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Le calendrier de la saison ne change pratiquement jamais (un
        // match reporté de temps en temps). On le laisse en cache 15 min
        // sur le réseau de Netlify plutôt que de redemander à l'API du NHL
        // à chaque ouverture de l'onglet.
        'Cache-Control': 'public, max-age=120',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=7200',
      },
      body: JSON.stringify({ matchs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}

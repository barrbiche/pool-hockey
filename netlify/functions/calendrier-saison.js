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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

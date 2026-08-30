// Retourne tout le calendrier de la saison du Canadien de Montréal
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const data = await res.json()

    const matchs = (data.games || []).map((g) => {
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

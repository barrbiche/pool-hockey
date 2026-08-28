// Retourne le prochain match (ou le match du jour) du Canadien de Montréal
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule/MTL/week/now')
    const data = await res.json()

    const maintenant = new Date()
    const matchs = data.games || []

    // Trouve le match d'aujourd'hui ou le prochain à venir
    const prochain = matchs.find((m) => {
      const dateMatch = new Date(m.startTimeUTC)
      return dateMatch >= new Date(maintenant.toDateString()) && m.gameState !== 'OFF'
    })

    if (!prochain) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: null }),
      }
    }

    const adversaireEstDom = prochain.homeTeam.abbrev === 'MTL'
    const adversaire = adversaireEstDom
      ? prochain.awayTeam.abbrev
      : prochain.homeTeam.abbrev

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match: {
          nhl_game_id: prochain.id,
          date_match: prochain.startTimeUTC,
          adversaire,
          statut: prochain.gameState,
        },
      }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

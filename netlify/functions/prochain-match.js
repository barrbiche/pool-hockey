// Retourne le prochain match (ou le match du jour) du Canadien de Montréal.
// Utilise le calendrier complet de la saison plutôt que juste 7 jours
// d'avance, pour que ça affiche toujours le prochain match peu importe le
// nombre de jours qui restent avant (ex: avant le début de saison).
import { matchTermine } from './_participants.js'

export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const data = await res.json()

    const maintenant = new Date()
    const matchs = data.games || []

    // Trouve le prochain match à venir — seulement saison régulière (2)
    // ou séries (3), jamais la pré-saison (1), trié par date
    const matchsAVenir = matchs
      .filter(
        (m) =>
          new Date(m.startTimeUTC) >= new Date(maintenant.toDateString()) &&
          !matchTermine(m.gameState) &&
          (m.gameType === 2 || m.gameType === 3)
      )
      .sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))

    const prochain = matchsAVenir[0]

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

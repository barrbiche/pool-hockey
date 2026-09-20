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
    // ou séries (3), jamais la pré-saison (1), trié par date. Les matchs
    // reportés (PPD), annulés (CNCL) et suspendus (SUSP) sont écartés :
    // sans ça, le site annoncerait comme « prochain match » une partie
    // qui n'aura pas lieu, et tout le monde choisirait un joueur pour rien.
    const matchsAVenir = matchs
      .filter(
        (m) =>
          new Date(m.startTimeUTC) >= new Date(maintenant.toDateString()) &&
          !matchTermine(m.gameState) &&
          !['PPD', 'CNCL', 'SUSP'].includes(m.gameState) &&
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

    const mtlEstDomicile = prochain.homeTeam.abbrev === 'MTL'
    const adversaire = mtlEstDomicile ? prochain.awayTeam.abbrev : prochain.homeTeam.abbrev

    // "LIVE" = match en cours, "CRIT" = fin de match serrée (dernières
    // minutes d'un match d'un but ou moins, ou prolongation).
    const enDirect = prochain.gameState === 'LIVE' || prochain.gameState === 'CRIT'

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Un match en cours change aux minutes : jamais de cache. Sinon on
        // peut garder la réponse une minute.
        'Cache-Control': enDirect ? 'no-store' : 'public, max-age=60',
      },
      body: JSON.stringify({
        match: {
          nhl_game_id: prochain.id,
          date_match: prochain.startTimeUTC,
          adversaire,
          statut: prochain.gameState,
          domicile: mtlEstDomicile,
          en_direct: enDirect,
          score_mtl: mtlEstDomicile ? prochain.homeTeam.score : prochain.awayTeam.score,
          score_adversaire: mtlEstDomicile ? prochain.awayTeam.score : prochain.homeTeam.score,
          periode: prochain.periodDescriptor?.number ?? null,
          type_periode: prochain.periodDescriptor?.periodType ?? null,
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

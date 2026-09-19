// Retourne les statistiques de la saison pour tous les joueurs du Canadien,
// incluant le nombre de tours du chapeau, la forme récente (5 derniers
// matchs) et le statut de blessure (best-effort, source non-officielle).
import { matchTermine } from './_participants.js'

export async function handler() {
  try {
    const resStats = await fetch('https://api-web.nhle.com/v1/club-stats/MTL/now')
    const dataStats = await resStats.json()

    const joueurs = (dataStats.skaters || []).map((j) => ({
      playerId: j.playerId,
      nom: `${j.firstName.default} ${j.lastName.default}`,
      position: j.positionCode,
      buts: j.goals || 0,
      passes: j.assists || 0,
      points: j.points || 0,
      matchs_joues: j.gamesPlayed || 0,
      tours_chapeau: 0,
      forme: null,
      blesse: false,
    }))

    // Récupérer le calendrier de la saison pour trouver les matchs terminés
    const resSaison = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const dataSaison = await resSaison.json()
    const matchsTermines = (dataSaison.games || [])
      .filter((g) => matchTermine(g.gameState) && (g.gameType === 2 || g.gameType === 3))
      .sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))

    // Aller chercher les boxscores en parallèle (par lots pour ne pas surcharger)
    const tailleLot = 10
    const tcParJoueur = {}
    const pointsParJoueurParMatch = {} // playerId -> [points du match1, match2, ...]

    for (let i = 0; i < matchsTermines.length; i += tailleLot) {
      const lot = matchsTermines.slice(i, i + tailleLot)
      const boxscores = await Promise.all(
        lot.map((m) =>
          fetch(`https://api-web.nhle.com/v1/gamecenter/${m.id}/boxscore`).then((r) => r.json())
        )
      )

      for (const box of boxscores) {
        const cotesMTL =
          box.awayTeam?.abbrev === 'MTL'
            ? box.playerByGameStats?.awayTeam
            : box.playerByGameStats?.homeTeam
        if (!cotesMTL) continue

        const skaters = [...(cotesMTL.forwards || []), ...(cotesMTL.defense || [])]
        for (const s of skaters) {
          if ((s.goals || 0) >= 3) {
            tcParJoueur[s.playerId] = (tcParJoueur[s.playerId] || 0) + 1
          }
          const pts = (s.goals || 0) + (s.assists || 0)
          if (!pointsParJoueurParMatch[s.playerId]) pointsParJoueurParMatch[s.playerId] = []
          pointsParJoueurParMatch[s.playerId].push(pts)
        }
      }
    }

    for (const j of joueurs) {
      j.tours_chapeau = tcParJoueur[j.playerId] || 0

      const historiquePoints = pointsParJoueurParMatch[j.playerId] || []
      const derniers5 = historiquePoints.slice(-5)
      if (derniers5.length > 0) {
        const moyenne = derniers5.reduce((a, b) => a + b, 0) / derniers5.length
        if (moyenne >= 1) j.forme = 'chaud'
        else if (moyenne === 0) j.forme = 'froid'
      }
    }

    // Blessures : source non-officielle (ESPN), best-effort seulement
    try {
      const resBlessures = await fetch(
        'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/mtl/injuries'
      )
      const dataBlessures = await resBlessures.json()
      const listeBlessures = dataBlessures?.injuries || dataBlessures?.team?.injuries || []
      for (const item of listeBlessures) {
        const nomBlesse = (item.athlete?.displayName || item.displayName || '').toLowerCase()
        const joueurTrouve = joueurs.find((j) => nomBlesse.includes(j.nom.toLowerCase()))
        if (joueurTrouve) joueurTrouve.blesse = true
      }
    } catch {
      // source non-officielle indisponible, on n'affiche juste rien
    }

    joueurs.sort((a, b) => b.points - a.points)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joueurs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

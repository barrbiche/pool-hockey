// Retourne les statistiques de la saison pour tous les joueurs du Canadien,
// incluant le nombre de tours du chapeau (calculé match par match).
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
    }))

    // Récupérer le calendrier de la saison pour trouver les matchs terminés
    const resSaison = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const dataSaison = await resSaison.json()
    const matchsTermines = (dataSaison.games || []).filter((g) => g.gameState === 'OFF')

    // Aller chercher les boxscores en parallèle (par lots pour ne pas surcharger)
    const tailleLot = 10
    const parJoueur = {}

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
            parJoueur[s.playerId] = (parJoueur[s.playerId] || 0) + 1
          }
        }
      }
    }

    for (const j of joueurs) {
      j.tours_chapeau = parJoueur[j.playerId] || 0
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

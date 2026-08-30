// Retourne les statistiques de la saison pour tous les joueurs du Canadien
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-stats/MTL/now')
    const data = await res.json()

    const joueurs = [
      ...(data.skaters || []).map((j) => ({
        nom: `${j.firstName.default} ${j.lastName.default}`,
        position: j.positionCode,
        buts: j.goals || 0,
        passes: j.assists || 0,
        points: j.points || 0,
        matchs_joues: j.gamesPlayed || 0,
      })),
    ]

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

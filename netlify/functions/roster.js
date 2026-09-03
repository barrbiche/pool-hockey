// Retourne l'alignement actuel du Canadien de Montréal, trié par points
// de la saison 2025-2026 (meilleur pointeur en premier).
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/roster/MTL/current')
    const data = await res.json()

    const joueurs = [
      ...data.forwards,
      ...data.defensemen,
      ...data.goalies,
    ].map((j) => ({
      nhl_id: j.id,
      nom: `${j.firstName.default} ${j.lastName.default}`,
      numero: j.sweaterNumber,
      position: j.positionCode,
      points_saison_derniere: 0,
    }))

    // Aller chercher les points de la saison 2025-2026 (régulière)
    try {
      const resStats = await fetch('https://api-web.nhle.com/v1/club-stats/MTL/20252026/2')
      const dataStats = await resStats.json()
      const pointsParJoueur = {}
      for (const s of dataStats.skaters || []) {
        pointsParJoueur[s.playerId] = s.points || 0
      }
      for (const j of joueurs) {
        j.points_saison_derniere = pointsParJoueur[j.nhl_id] || 0
      }
    } catch {
      // si ça échoue, on garde 0 partout et on trie par nom en fallback
    }

    joueurs.sort((a, b) => b.points_saison_derniere - a.points_saison_derniere || a.nom.localeCompare(b.nom))

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

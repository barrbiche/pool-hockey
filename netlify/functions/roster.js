// Retourne l'alignement actuel du Canadien de Montréal, trié par points
// de la saison 2025-2026, avec la forme récente (5 derniers matchs) et le
// statut de blessure (best-effort, source non-officielle gratuite).
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
      forme: null, // 'chaud' | 'froid' | null
      blesse: false,
      statut_blessure: null,
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

    // Forme récente : moyenne de points sur les 5 derniers matchs joués
    // (source officielle NHL, un appel par joueur en parallèle)
    try {
      const resultatsForme = await Promise.all(
        joueurs.map((j) =>
          fetch(`https://api-web.nhle.com/v1/player/${j.nhl_id}/game-log/now`)
            .then((r) => r.json())
            .catch(() => null)
        )
      )
      resultatsForme.forEach((data, i) => {
        const derniers5 = (data?.gameLog || []).slice(0, 5)
        if (derniers5.length === 0) return
        const totalPoints = derniers5.reduce((acc, g) => acc + (g.points || 0), 0)
        const moyenne = totalPoints / derniers5.length
        if (moyenne >= 1) joueurs[i].forme = 'chaud'
        else if (moyenne === 0) joueurs[i].forme = 'froid'
      })
    } catch {
      // pas grave si ça échoue, la forme reste juste vide
    }

    // Blessures : source non-officielle (ESPN), best-effort seulement.
    // Si cette source échoue ou change, on n'affiche simplement rien.
    try {
      const resBlessures = await fetch(
        'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/mtl/injuries'
      )
      const dataBlessures = await resBlessures.json()
      const listeBlessures = dataBlessures?.injuries || dataBlessures?.team?.injuries || []
      for (const item of listeBlessures) {
        const nomBlesse = (item.athlete?.displayName || item.displayName || '').toLowerCase()
        const joueurTrouve = joueurs.find((j) => nomBlesse.includes(j.nom.toLowerCase()))
        if (joueurTrouve) {
          joueurTrouve.blesse = true
          joueurTrouve.statut_blessure = item.status || item.type?.description || 'Blessé'
        }
      }
    } catch {
      // source non-officielle indisponible, on n'affiche juste rien
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

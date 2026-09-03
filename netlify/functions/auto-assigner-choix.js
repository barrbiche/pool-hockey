import { createClient } from '@supabase/supabase-js'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

// À déclencher (cron) régulièrement. Pour tout match qui commence dans
// moins d'1h, assigne automatiquement un joueur à ceux qui n'ont pas choisi :
// 1) leur joueur du match précédent, si encore libre
// 2) sinon, le joueur du CH avec le plus de points cette saison encore libre
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const maintenant = new Date()
    const dansUneHeure = new Date(maintenant.getTime() + 60 * 60 * 1000)

    // Matchs qui commencent dans la prochaine heure et pas encore "verrouillés"
    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .gte('date_match', maintenant.toISOString())
      .lte('date_match', dansUneHeure.toISOString())
      .eq('statut', 'a_venir')

    if (erreurMatchs) throw erreurMatchs
    if (!matchs || matchs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Aucun match à traiter' }) }
    }

    // Stats de la saison pour trouver le meilleur pointeur en cas de besoin
    const resStats = await fetch('https://api-web.nhle.com/v1/club-stats/MTL/now')
    const dataStats = await resStats.json()
    const classementPoints = (dataStats.skaters || [])
      .slice()
      .sort((a, b) => (b.points || 0) - (a.points || 0))

    const resultatsAssignations = []

    for (const match of matchs) {
      if (!match.ordre_choix) continue

      // Choix déjà faits pour ce match
      const { data: choixExistants } = await supabase
        .from('choix')
        .select('user_id, joueur_id')
        .eq('match_id', match.id)

      const usersAvecChoix = new Set((choixExistants || []).map((c) => c.user_id))
      const joueursDejaPris = new Set((choixExistants || []).map((c) => c.joueur_id))
      const usersManquants = match.ordre_choix.filter((uid) => !usersAvecChoix.has(uid))

      if (usersManquants.length === 0) continue

      // Important : on assigne SEULEMENT à la prochaine personne dans l'ordre
      // (celle dont c'est le tour), pas à tout le monde en même temps. Ça
      // laisse une chance aux suivants de choisir eux-mêmes avant leur tour
      // d'être aussi auto-assigné (le cron repasse toutes les 15 min).
      const userId = usersManquants[0]

      // Trouver le match précédent (le plus récent avant celui-ci)
      const { data: matchPrecedent } = await supabase
        .from('matchs')
        .select('id')
        .lt('date_match', match.date_match)
        .order('date_match', { ascending: false })
        .limit(1)
        .maybeSingle()

      let joueurIdAssigne = null

      // 1) Essayer de reprendre le joueur du match précédent
      if (matchPrecedent) {
        const { data: choixPrecedent } = await supabase
          .from('choix')
          .select('joueur_id')
          .eq('match_id', matchPrecedent.id)
          .eq('user_id', userId)
          .maybeSingle()

        if (choixPrecedent && !joueursDejaPris.has(choixPrecedent.joueur_id)) {
          joueurIdAssigne = choixPrecedent.joueur_id
        }
      }

      // 2) Sinon, prendre le meilleur pointeur encore libre
      if (!joueurIdAssigne) {
        for (const skater of classementPoints) {
          const { data: joueurDb } = await supabase
            .from('joueurs')
            .upsert(
              { nhl_id: skater.playerId, nom: `${skater.firstName.default} ${skater.lastName.default}` },
              { onConflict: 'nhl_id' }
            )
            .select()
            .single()

          if (joueurDb && !joueursDejaPris.has(joueurDb.id)) {
            joueurIdAssigne = joueurDb.id
            break
          }
        }
      }

      if (joueurIdAssigne) {
        await supabase.from('choix').insert({
          match_id: match.id,
          user_id: userId,
          joueur_id: joueurIdAssigne,
        })
        resultatsAssignations.push({ match_id: match.id, user_id: userId, joueur_id: joueurIdAssigne })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignations: resultatsAssignations }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}

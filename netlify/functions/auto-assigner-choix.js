import { createClient } from '@supabase/supabase-js'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

// Délais (en minutes avant le match) pour chaque position dans l'ordre de
// choix : la 1re personne doit avoir choisi 1h30 avant le match, la 2e 1h
// avant, la 3e 30 min avant. Une personne qui manque son délai se fait
// auto-assigner (son joueur du match précédent, sinon le meilleur pointeur
// encore libre), et le suivant garde son propre délai.
const DELAIS_MINUTES = [90, 60, 30]

export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const maintenant = new Date()
    const dansUneHeureTrente = new Date(maintenant.getTime() + 90 * 60 * 1000)

    // Matchs qui commencent dans les prochaines 1h30 et pas encore "verrouillés"
    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .gte('date_match', maintenant.toISOString())
      .lte('date_match', dansUneHeureTrente.toISOString())
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

      const dateMatch = new Date(match.date_match)

      // Choix déjà faits pour ce match
      const { data: choixExistants } = await supabase
        .from('choix')
        .select('user_id, joueur_id')
        .eq('match_id', match.id)

      const usersAvecChoix = new Set((choixExistants || []).map((c) => c.user_id))
      const joueursDejaPris = new Set((choixExistants || []).map((c) => c.joueur_id))

      // Trouver le match précédent (le plus récent avant celui-ci)
      const { data: matchPrecedent } = await supabase
        .from('matchs')
        .select('id')
        .lt('date_match', match.date_match)
        .order('date_match', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Pour chaque position dans l'ordre, vérifier si son délai est dépassé
      for (let position = 0; position < match.ordre_choix.length; position++) {
        const userId = match.ordre_choix[position]
        if (usersAvecChoix.has(userId)) continue

        const delaiMinutes = DELAIS_MINUTES[position] ?? 30
        const heureLimite = new Date(dateMatch.getTime() - delaiMinutes * 60 * 1000)
        if (maintenant < heureLimite) continue // délai pas encore dépassé pour cette personne

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
                {
                  nhl_id: skater.playerId,
                  nom: `${skater.firstName.default} ${skater.lastName.default}`,
                },
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
          joueursDejaPris.add(joueurIdAssigne)
          usersAvecChoix.add(userId)
          resultatsAssignations.push({
            match_id: match.id,
            user_id: userId,
            joueur_id: joueurIdAssigne,
          })
        }
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

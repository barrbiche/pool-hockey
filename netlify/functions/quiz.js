import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, ORDRE_BASE } from './_participants.js'

// Quiz du pool : Eric écrit une question à choix de réponse (+ une explication), les autres
// y répondent UNE fois, et ils voient la bonne réponse et l'explication seulement après.
//   GET  -> { quiz: [...], joueurs: [...], stats: { <user_id>: { repondues, bonnes } }, table_ok }
//   POST { action: 'repondre', quiz_id, choix }                                   (les autres)
//   POST { action: 'creer', question, choix: [...], bonne_reponse, explication, piege }  (Eric seulement)
//        (« piege » = pourquoi c'est un piège : facultatif, montré après la réponse comme l'explication)
//   POST { action: 'supprimer', quiz_id }                                         (Eric seulement)
//
// La bonne réponse et l'explication ne quittent JAMAIS le serveur avant que la personne ait
// répondu (les tables sont fermées au navigateur : seul ce fichier les lit). Eric, qui fait
// les questions, voit tout tout de suite et ne joue pas.
// Tables Supabase « quiz » et « quiz_reponses ». Si elles n'existent pas encore, le GET répond
// « aucun quiz » (jamais d'erreur pour les autres) et Eric voit le SQL à rouler.
export const QUESTION_MAX = 300
export const CHOIX_MAX = 120
export const EXPLICATION_MAX = 800
export const PIEGE_MAX = 800
export const NB_CHOIX_MIN = 2
export const NB_CHOIX_MAX = 6

const tableManquante = (message) =>
  /could not find the table|schema cache|relation .* does not exist/i.test(String(message || ''))

const MESSAGE_TABLE =
  'Les tables du quiz n’existent pas encore dans Supabase : roule le SQL du quiz (dans Admin), puis réessaie.'

// Participants qui répondent aux quiz (Eric les écrit, il ne joue pas)
const JOUEURS = ORDRE_BASE.filter((id) => id !== ADMIN_ID)

async function identifier(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (!ORDRE_BASE.includes(data.user.id)) return { erreur: { statut: 403, erreur: 'Pas dans le pool.' } }
  return { userId: data.user.id }
}

// La colonne « choix » est du JSON : on se protège d'une valeur bizarre
function listeDeChoix(valeur) {
  let v = valeur
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      v = []
    }
  }
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

export async function lireQuiz({ supabase, token }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  const estAdmin = userId === ADMIN_ID
  const vide = { statut: 200, quiz: [], joueurs: JOUEURS, stats: {}, table_ok: false, piege_ok: true, admin: estAdmin }

  const lireTout = (colonnes) =>
    supabase
      .from('quiz')
      .select(colonnes)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(200)
  const COLONNES = 'id, question, choix, bonne_reponse, explication, created_at'
  let piegeOk = true
  let { data: quiz, error } = await lireTout(`${COLONNES}, piege`)
  if (error && /piege/i.test(String(error.message || ''))) {
    // Table créée avant l'ajout du champ « piège » : on lit sans, et Eric voit le SQL à rouler
    piegeOk = false
    ;({ data: quiz, error } = await lireTout(COLONNES))
  }
  if (error) return vide // table pas créée (ou panne) : le site continue sans quiz

  const ids = (quiz || []).map((q) => q.id)
  let reponses = []
  if (ids.length > 0) {
    const r = await supabase.from('quiz_reponses').select('quiz_id, user_id, choix').in('quiz_id', ids)
    if (r.error) return vide
    reponses = r.data || []
  }

  const stats = Object.fromEntries(JOUEURS.map((u) => [u, { repondues: 0, bonnes: 0 }]))
  const parQuiz = new Map()
  for (const q of quiz || []) parQuiz.set(q.id, [])
  for (const r of reponses) {
    if (!JOUEURS.includes(r.user_id) || !parQuiz.has(r.quiz_id)) continue
    parQuiz.get(r.quiz_id).push(r)
  }

  const liste = (quiz || []).map((q) => {
    const rQuiz = parQuiz.get(q.id)
    for (const r of rQuiz) {
      stats[r.user_id].repondues += 1
      if (r.choix === q.bonne_reponse) stats[r.user_id].bonnes += 1
    }
    const moi = rQuiz.find((r) => r.user_id === userId)
    const revele = estAdmin || !!moi
    const item = {
      id: q.id,
      question: q.question,
      choix: listeDeChoix(q.choix),
      created_at: q.created_at,
      nb_reponses: rQuiz.length,
      ma_reponse: moi ? moi.choix : null,
      revele,
    }
    if (revele) {
      item.bonne_reponse = q.bonne_reponse
      item.explication = q.explication || ''
      item.piege = q.piege || ''
      item.reponses = rQuiz.map((r) => ({ user_id: r.user_id, choix: r.choix }))
    }
    return item
  })

  return { statut: 200, quiz: liste, joueurs: JOUEURS, stats, table_ok: true, piege_ok: piegeOk, admin: estAdmin }
}

export async function repondreQuiz({ supabase, token, quizId, choix }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  if (userId === ADMIN_ID) {
    return { statut: 403, erreur: 'C’est toi qui as fait le quiz : tu connais déjà la réponse!' }
  }
  const id = Number(quizId)
  if (!Number.isInteger(id) || !Number.isInteger(choix)) {
    return { statut: 400, erreur: 'Réponse invalide.' }
  }

  const lireUn = (colonnes) => supabase.from('quiz').select(colonnes).eq('id', id).maybeSingle()
  let { data: q, error } = await lireUn('id, choix, bonne_reponse, explication, piege')
  if (error && /piege/i.test(String(error.message || ''))) {
    ;({ data: q, error } = await lireUn('id, choix, bonne_reponse, explication'))
  }
  if (error) {
    if (tableManquante(error.message)) return { statut: 500, erreur: MESSAGE_TABLE }
    throw error
  }
  if (!q) return { statut: 404, erreur: 'Ce quiz n’existe plus.' }
  const options = listeDeChoix(q.choix)
  if (choix < 0 || choix >= options.length) return { statut: 400, erreur: 'Choix invalide.' }

  // insert (pas upsert) : la clé (quiz, personne) empêche de changer sa réponse après coup
  const { error: erreurInsert } = await supabase
    .from('quiz_reponses')
    .insert({ quiz_id: id, user_id: userId, choix })
  if (erreurInsert) {
    if (erreurInsert.code === '23505' || /duplicate key/i.test(String(erreurInsert.message || ''))) {
      return { statut: 409, erreur: 'Tu as déjà répondu à ce quiz.' }
    }
    if (tableManquante(erreurInsert.message)) return { statut: 500, erreur: MESSAGE_TABLE }
    throw erreurInsert
  }
  return {
    statut: 200,
    ok: true,
    correct: choix === q.bonne_reponse,
    bonne_reponse: q.bonne_reponse,
    explication: q.explication || '',
    piege: q.piege || '',
  }
}

export async function creerQuiz({ supabase, token, question, choix, bonneReponse, explication, piege }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  if (userId !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }

  const q = typeof question === 'string' ? question.trim() : ''
  if (!q) return { statut: 400, erreur: 'Écris la question.' }
  if (q.length > QUESTION_MAX) return { statut: 400, erreur: `Question trop longue (${QUESTION_MAX} max).` }

  if (!Array.isArray(choix)) return { statut: 400, erreur: 'Choix invalides.' }
  const options = choix.map((c) => (typeof c === 'string' ? c.trim() : ''))
  if (options.length < NB_CHOIX_MIN) return { statut: 400, erreur: `Il faut au moins ${NB_CHOIX_MIN} choix.` }
  if (options.length > NB_CHOIX_MAX) return { statut: 400, erreur: `${NB_CHOIX_MAX} choix maximum.` }
  if (options.some((o) => o === '')) return { statut: 400, erreur: 'Un des choix est vide.' }
  if (options.some((o) => o.length > CHOIX_MAX)) {
    return { statut: 400, erreur: `Un choix est trop long (${CHOIX_MAX} max).` }
  }
  const minuscules = options.map((o) => o.toLowerCase())
  if (new Set(minuscules).size !== minuscules.length) {
    return { statut: 400, erreur: 'Deux choix sont identiques.' }
  }
  if (!Number.isInteger(bonneReponse) || bonneReponse < 0 || bonneReponse >= options.length) {
    return { statut: 400, erreur: 'Choisis la bonne réponse.' }
  }

  const expl = typeof explication === 'string' ? explication.trim() : ''
  if (expl.length > EXPLICATION_MAX) {
    return { statut: 400, erreur: `Explication trop longue (${EXPLICATION_MAX} max).` }
  }
  const pie = typeof piege === 'string' ? piege.trim() : ''
  if (pie.length > PIEGE_MAX) {
    return { statut: 400, erreur: `Le texte « pourquoi c’est un piège » est trop long (${PIEGE_MAX} max).` }
  }

  const ligne = { question: q, choix: options, bonne_reponse: bonneReponse, explication: expl }
  // Sans piège on n'envoie pas la colonne : ça marche même sur une table créée avant son ajout
  if (pie) ligne.piege = pie
  const { data, error } = await supabase.from('quiz').insert(ligne).select('id').single()
  if (error) {
    // (colonne manquante AVANT table manquante : les deux parlent de « schema cache »)
    if (/piege/i.test(String(error.message || ''))) {
      return {
        statut: 500,
        erreur:
          'La colonne « piege » n’existe pas encore dans Supabase : roule le SQL du quiz (dans Admin), puis réessaie.',
      }
    }
    if (tableManquante(error.message)) return { statut: 500, erreur: MESSAGE_TABLE }
    throw error
  }
  return { statut: 200, ok: true, id: data?.id ?? null }
}

export async function supprimerQuiz({ supabase, token, quizId }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  if (userId !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }
  const id = Number(quizId)
  if (!Number.isInteger(id)) return { statut: 400, erreur: 'Quiz invalide.' }

  // Les réponses d'abord (au cas où la table n'aurait pas le « on delete cascade »)
  const r1 = await supabase.from('quiz_reponses').delete().eq('quiz_id', id)
  if (r1.error) {
    if (tableManquante(r1.error.message)) return { statut: 500, erreur: MESSAGE_TABLE }
    throw r1.error
  }
  const r2 = await supabase.from('quiz').delete().eq('id', id)
  if (r2.error) throw r2.error
  return { statut: 200, ok: true }
}

// Reçoit la requête Netlify et un client Supabase (injectable pour les tests)
export async function gerer(event, supabase) {
  try {
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    let r
    if (event.httpMethod === 'GET') {
      r = await lireQuiz({ supabase, token })
    } else if (event.httpMethod === 'POST') {
      let c
      try {
        c = JSON.parse(event.body || '{}')
      } catch {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Requête illisible.' }) }
      }
      if (c.action === 'repondre') {
        r = await repondreQuiz({ supabase, token, quizId: c.quiz_id, choix: c.choix })
      } else if (c.action === 'creer') {
        r = await creerQuiz({
          supabase,
          token,
          question: c.question,
          choix: c.choix,
          bonneReponse: c.bonne_reponse,
          explication: c.explication,
          piege: c.piege,
        })
      } else if (c.action === 'supprimer') {
        r = await supprimerQuiz({ supabase, token, quizId: c.quiz_id })
      } else {
        r = { statut: 400, erreur: 'Action inconnue.' }
      }
    } else {
      return { statusCode: 405, body: JSON.stringify({ erreur: 'GET ou POST seulement' }) }
    }
    const { statut, ...corps } = r
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    return await gerer(event, supabase)
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}

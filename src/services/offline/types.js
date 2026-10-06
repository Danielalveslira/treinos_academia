// Só tipos (JSDoc) das estruturas guardadas no IndexedDB. Sem código em tempo de execução.

/**
 * Registro do catálogo público, já no formato do app (ver mapRow em exerciseCatalogService).
 * @typedef {Object} CachedCatalogExercise
 * @property {string} id
 * @property {string} provider
 * @property {string} providerExerciseId
 * @property {string} name
 * @property {string} nameKey   nome normalizado (minúsculas, sem acento) para busca local
 * @property {string[]} primaryMuscles
 * @property {string[]} secondaryMuscles
 * @property {string|null} equipment
 * @property {string|null} category
 * @property {string|null} level
 * @property {string|null} force
 * @property {string|null} mechanic
 * @property {string[]} instructions
 * @property {string[]} images
 * @property {number} cachedAt  epoch ms da última vez que o servidor confirmou o registro
 */

/**
 * Linha de public.workouts exatamente como o servidor devolve (snake_case). Uma linha por
 * exercício por dia; `set_details` é o jsonb de séries (força) e `date` o dia (YYYY-MM-DD).
 * @typedef {Object} CachedWorkoutRow
 * @property {string} user_id
 * @property {string} id
 * @property {string} exercise_id
 * @property {string} date
 * @property {string} created_at
 * @property {'strength'|'cardio'} type
 * @property {Array<{weight:number, reps:number}>|null} set_details
 * @property {number|null} sets
 * @property {number|null} duration_minutes
 * @property {number|null} distance_km
 * @property {string|null} note
 */

/**
 * @typedef {Object} WorkoutCursor
 * @property {string} date
 * @property {string} createdAt
 */

/**
 * @typedef {Object} WorkoutFilters
 * @property {string} [exerciseId]
 * @property {string} [startDate]
 * @property {string} [endDate]
 */

export {}

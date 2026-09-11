import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase/config'

// Teto de defesa: ninguém cadastra centenas de exercícios de verdade, mas sem isso a
// leitura escala com o tamanho da coleção — o app já funciona bem dentro desse limite.
const MAX_EXERCISES = 300

function exercisesRef(userId) {
  return collection(db, 'users', userId, 'exercises')
}

export async function listExercises(userId) {
  const q = query(exercisesRef(userId), orderBy('name'), limit(MAX_EXERCISES))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export function createExercise(userId, exercise) {
  return addDoc(exercisesRef(userId), {
    name: exercise.name.trim(),
    muscleGroup: exercise.muscleGroup.trim(),
    note: exercise.note?.trim() || '',
    active: true,
  })
}

export function updateExercise(userId, exerciseId, exercise) {
  return updateDoc(doc(db, 'users', userId, 'exercises', exerciseId), {
    name: exercise.name.trim(),
    muscleGroup: exercise.muscleGroup.trim(),
    note: exercise.note?.trim() || '',
    active: exercise.active,
  })
}

export function deleteExercise(userId, exerciseId) {
  return deleteDoc(doc(db, 'users', userId, 'exercises', exerciseId))
}

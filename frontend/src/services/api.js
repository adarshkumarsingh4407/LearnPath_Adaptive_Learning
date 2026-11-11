import { QUESTIONS, SUBJECTS, TOPICS } from '../data/questions'

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as signOutFirebase,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth"

import {
  doc,
  setDoc,
  getDoc
} from "firebase/firestore"

import { auth, db, model } from "./firebase"


// ── Firebase Database ───────────────────────────────────

const WEAK_THRESHOLD = 60

const currentUid = () => auth.currentUser?.uid ?? null

const emptyData = () => ({
  pre: null,
  post: null,
  attempts: []
})

const loadData = async () => {
  const uid = currentUid()

  if (!uid) return emptyData()

  const userDoc = await getDoc(doc(db, "users", uid))
  const userData = userDoc.exists() ? userDoc.data() : {}

  return {
    pre: userData.pre ?? null,
    post: userData.post ?? null,
    attempts: userData.attempts ?? []
  }
}

const saveData = async (data) => {
  const uid = currentUid()

  if (!uid) {
    throw new Error("User is not logged in")
  }

  await setDoc(
    doc(db, "users", uid),
    data,
    { merge: true }
  )
}

const delay = (ms = 350) =>
  new Promise((resolve) => setTimeout(resolve, ms))


// ── Firebase Authentication ─────────────────────────────

export async function signUp({ name, email, password, grade }) {
  const result = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  )

  await updateProfile(result.user, {
    displayName: name
  })

  await setDoc(doc(db, "users", result.user.uid), {
    name,
    email,
    grade,
    pre: null,
    post: null,
    attempts: []
  })

  return { name, email, grade }
}

export async function signIn({ email, password }) {
  const result = await signInWithEmailAndPassword(
    auth,
    email,
    password
  )

  const userDoc = await getDoc(
    doc(db, "users", result.user.uid)
  )

  const userData = userDoc.exists()
    ? userDoc.data()
    : {}

  return {
    name: userData.name || result.user.displayName,
    email: result.user.email,
    grade: userData.grade || null
  }
}

export async function signOut() {
  await signOutFirebase(auth)
}

export async function getCurrentUser() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        unsubscribe()

        try {
          if (!user) {
            resolve(null)
            return
          }

          const userDoc = await getDoc(
            doc(db, "users", user.uid)
          )

          const userData = userDoc.exists()
            ? userDoc.data()
            : {}

          resolve({
            name: userData.name || user.displayName,
            email: user.email,
            grade: userData.grade || null
          })
        } catch (error) {
          reject(error)
        }
      },
      reject
    )
  })
}


// ── Content ──────────────────────────────────────────────

export function getSubjects() {
  return SUBJECTS
}

export function getTopics() {
  return TOPICS
}


// ── Test Questions ────────────────────────────────────────

export async function getTestQuestions(type) {
  await delay()

  return TOPICS.flatMap((t) =>
    [1, 2, 3].map((d) =>
      QUESTIONS.find(
        (q) =>
          q.topicId === t.id &&
          q.difficulty === d
      )
    ).filter(Boolean)
  ).map(({ answer, explanation, ...rest }) => rest)
}


// ── Submit Test ───────────────────────────────────────────

export async function submitTest(type, answers) {
  await delay(600)

  const byTopic = {}
  let score = 0
  let total = 0

  for (const [qid, selected] of Object.entries(answers)) {
    const question = QUESTIONS.find((q) => q.id === qid)

    if (!question) continue

    const correct = question.answer === selected

    byTopic[question.topicId] ??= {
      correct: 0,
      total: 0
    }

    byTopic[question.topicId].total++
    total++

    if (correct) {
      byTopic[question.topicId].correct++
      score++
    }
  }

  for (const t of Object.values(byTopic)) {
    t.percent = Math.round(
      (t.correct / t.total) * 100
    )
  }

  const weakTopics = Object.entries(byTopic)
    .filter(([, t]) => t.percent < WEAK_THRESHOLD)
    .map(([id]) => id)

  const result = {
    type,
    date: new Date().toISOString(),
    score,
    total,
    percent: total
      ? Math.round((score / total) * 100)
      : 0,
    byTopic,
    weakTopics
  }

  const data = await loadData()
  const before = computeStats(data)

  data[type] = result

  await saveData(data)

  return {
    ...result,
    ...rewards(before, computeStats(data))
  }
}


// ── Get Test Result ───────────────────────────────────────

export async function getTestResult(type) {
  await delay(150)

  const data = await loadData()

  return data[type]
}


// ── Adaptive Practice ─────────────────────────────────────

export async function getStartingDifficulty(topicId) {
  const { pre, post } = await loadData()

  const pct = (post ?? pre)?.byTopic?.[topicId]?.percent

  if (pct == null) return 2
  if (pct < 40) return 1
  if (pct < 75) return 2

  return 3
}

export function nextDifficulty(current, wasCorrect) {
  return Math.min(
    3,
    Math.max(1, current + (wasCorrect ? 1 : -1))
  )
}


// ── Practice Question ─────────────────────────────────────

export async function getPracticeQuestion(
  topicId,
  difficulty,
  seenIds = []
) {
  await delay(250)

  const pool = QUESTIONS.filter(
    (q) => q.topicId === topicId
  )

  const unseen = pool.filter(
    (q) => !seenIds.includes(q.id)
  )

  const candidates = unseen.filter(
    (q) => q.difficulty === difficulty
  )

  const list = candidates.length
    ? candidates
    : unseen.length
      ? unseen
      : pool

  if (!list.length) return null

  return list[
    Math.floor(Math.random() * list.length)
  ]
}


// ── Record Practice Attempt ───────────────────────────────

export async function recordAttempt({
  topicId,
  questionId,
  difficulty,
  correct
}) {
  const data = await loadData()

  const before = computeStats(data)

  data.attempts.push({
    topicId,
    questionId,
    difficulty,
    correct,
    date: new Date().toISOString()
  })

  await saveData(data)

  return rewards(
    before,
    computeStats(data)
  )
}


// ── Gemini AI Hints ───────────────────────────────────────

const HINTS = {
  algebra:
    'Try isolating the variable. Perform the same operation on both sides.',

  geometry:
    'Draw the shape and identify the formula related to the given values.',

  fractions:
    'Try converting the fractions to a common denominator.',

  physics:
    'Write down the known values and identify the suitable formula.',

  chemistry:
    'Think about the elements and count the atoms carefully.',

  biology:
    'Recall the function of the related cell part or biological structure.'
}

export async function getAIHint(question) {
  try {
    if (!model) {
      throw new Error("Gemini model is not initialized")
    }

    const questionText =
      typeof question === "string"
        ? question
        : question?.question ||
          question?.text ||
          question?.prompt ||
          question?.title ||
          "the given question"

    const topic =
      typeof question === "object"
        ? question?.topicId || "general"
        : "general"

    const prompt = `
You are LearnPath, a friendly educational AI tutor.

Topic: ${topic}
Question: ${questionText}

Instructions:
1. Give one useful hint.
2. Do not reveal the final answer.
3. Use simple English.
4. Explain in 2-3 short sentences.
5. Encourage independent thinking.
6. Keep the response suitable for school students.
7. Do not ask for personal information.

Give the hint now.
`

    console.log("Gemini request started")

    const result = await model.generateContent(prompt)

    const hint = result.response.text()

    if (!hint || !hint.trim()) {
      throw new Error("Gemini returned an empty response")
    }

    console.log("GEMINI SUCCESS:", hint)

    return hint.trim()

  } catch (error) {
    console.error("GEMINI AI ERROR DETAILS:", {
      message: error?.message,
      code: error?.code,
      name: error?.name,
      details: error?.customData
    })

    return (
      HINTS[topicFromQuestion(question)] ||
      'Break the question into smaller steps and try to solve it carefully.'
    )
  }
}

function topicFromQuestion(question) {
  return typeof question === "object"
    ? question?.topicId
    : null
}


// ── Gamification ──────────────────────────────────────────

export const XP_PER_LEVEL = 100

export const attemptXp = (difficulty, correct) =>
  correct ? difficulty * 10 : 2

const TEST_XP_PER_CORRECT = 5

export const BADGES = [
  {
    id: 'first-steps',
    name: 'First Steps',
    description: 'Complete the basic test',
    check: (d) => !!d.pre
  },
  {
    id: 'on-fire',
    name: 'On Fire',
    description: 'Get 5 answers right in a row',
    check: (d, s) => s.bestRun >= 5
  },
  {
    id: 'challenger',
    name: 'Challenger',
    description: 'Answer 3 hard questions correctly',
    check: (d) =>
      d.attempts.filter(
        (a) => a.correct && a.difficulty === 3
      ).length >= 3
  },
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Practise all 6 topics',
    check: (d) =>
      new Set(d.attempts.map((a) => a.topicId)).size >= TOPICS.length
  },
  {
    id: 'consistent',
    name: 'Consistent',
    description: 'Practise 3 days in a row',
    check: (d, s) => s.streak >= 3
  },
  {
    id: 'dedicated',
    name: 'Dedicated',
    description: 'Answer 30 practice questions',
    check: (d) => d.attempts.length >= 30
  },
  {
    id: 'master',
    name: 'Topic Master',
    description: 'Reach 90% mastery in a topic',
    check: (d, s) =>
      Object.values(s.mastery).some((m) => m >= 90)
  },
  {
    id: 'comeback',
    name: 'Comeback',
    description: 'Beat your pre-test score in the post-test',
    check: (d) =>
      !!d.post && !!d.pre && d.post.percent > d.pre.percent
  }
]


// ── Statistics ────────────────────────────────────────────

const dayKey = (iso) =>
  new Date(iso).toLocaleDateString('en-CA')

function computeMastery({ pre, post, attempts }) {
  const latest = post ?? pre
  const mastery = {}

  for (const t of TOPICS) {
    const testPct =
      latest?.byTopic?.[t.id]?.percent ?? null

    const recent = attempts
      .filter((a) => a.topicId === t.id)
      .slice(-10)

    const practicePct = recent.length
      ? Math.round(
          (
            recent.reduce(
              (s, a) => s + (a.correct ? a.difficulty : 0),
              0
            ) /
            recent.reduce(
              (s, a) => s + a.difficulty,
              0
            )
          ) * 100
        )
      : null

    mastery[t.id] =
      testPct == null && practicePct == null
        ? null
        : testPct == null
          ? practicePct
          : practicePct == null
            ? testPct
            : Math.round(
                testPct * 0.4 + practicePct * 0.6
              )
  }

  return mastery
}


function computeStats(data) {
  const {
    pre,
    post,
    attempts
  } = data

  const xp =
    attempts.reduce(
      (s, a) => s + attemptXp(a.difficulty, a.correct),
      0
    ) +
    [pre, post].reduce(
      (s, t) =>
        s + (t ? t.score * TEST_XP_PER_CORRECT : 0),
      0
    )

  let run = 0
  let bestRun = 0

  for (const a of attempts) {
    run = a.correct ? run + 1 : 0
    bestRun = Math.max(bestRun, run)
  }

  const days = new Set(
    [
      ...attempts.map((a) => a.date),
      pre?.date,
      post?.date
    ]
      .filter(Boolean)
      .map(dayKey)
  )

  const cursor = new Date()

  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }

  let streak = 0

  while (days.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  const mastery = computeMastery(data)

  const stats = {
    xp,
    level: Math.floor(xp / XP_PER_LEVEL) + 1,
    levelProgress: xp % XP_PER_LEVEL,
    currentRun: run,
    bestRun,
    streak,
    activeToday: days.has(dayKey(new Date())),
    mastery
  }

  stats.badges = BADGES.map(
    ({ check, ...b }) => ({
      ...b,
      earned: check(data, stats)
    })
  )

  return stats
}


// ── Rewards ───────────────────────────────────────────────

function rewards(before, after) {
  const had = new Set(
    before.badges
      .filter((b) => b.earned)
      .map((b) => b.id)
  )

  return {
    xpGained: after.xp - before.xp,

    levelUp:
      after.level > before.level
        ? after.level
        : null,

    newBadges: after.badges.filter(
      (b) => b.earned && !had.has(b.id)
    )
  }
}


// ── Progress ──────────────────────────────────────────────

export async function getProgress() {
  await delay(200)

  const data = await loadData()

  const stats = computeStats(data)

  const weakTopics = TOPICS
    .filter(
      (t) =>
        stats.mastery[t.id] != null &&
        stats.mastery[t.id] < WEAK_THRESHOLD
    )
    .map((t) => t.id)

  return {
    ...data,
    ...stats,
    weakTopics
  }
}
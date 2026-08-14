/**
 * Auto-grading + scoring for event tasks.
 *
 * Single source of truth shared by submitTask, evaluateSubmission,
 * getLeaderboard and distributeRewards — the old code duplicated this math
 * in three places and drifted.
 */

const AUTO_EVALUABLE_TYPES = ['text', 'url', 'mcq', 'true_false', 'checkboxes'];

/**
 * Loose normalization for flag-style answers (text/url). Strips protocol,
 * "www." prefix and trailing slashes so "https://example.com/flag" matches
 * "example.com/flag".
 */
function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function setEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const A = a.map(String).sort();
  const B = b.map(String).sort();
  return A.every((v, i) => v === B[i]);
}

/**
 * Evaluate a submission against a task's answer key.
 *
 * Content shapes:
 *   { text: "flag" }            — text / url tasks
 *   { selectedOptions: ["A"] }  — mcq / true_false / checkboxes tasks
 *
 * Returns { status, match }:
 *   "correct" / "wrong" when the task is auto-evaluated and evaluable,
 *   "pending" otherwise (file uploads, missing answer keys).
 */
function evaluateSubmissionContent(task, content) {
  const isAuto = task && task.isAutoEvaluated;
  const type = task ? task.submissionType : 'text';
  const payload = content || {};

  if (!isAuto || !AUTO_EVALUABLE_TYPES.includes(type)) {
    return { status: 'pending', match: false };
  }

  const config = task.submissionConfig || {};
  const exact = normalizeText(config.exactText);

  switch (type) {
    case 'text':
    case 'url': {
      if (!exact) return { status: 'pending', match: false };
      const match = normalizeText(payload.text) === exact;
      return { status: match ? 'correct' : 'wrong', match };
    }
    case 'mcq':
    case 'true_false':
    case 'checkboxes': {
      const correct = Array.isArray(config.correctOptions) ? config.correctOptions : [];
      if (correct.length === 0) return { status: 'pending', match: false };
      const match = setEquals(payload.selectedOptions, correct);
      return { status: match ? 'correct' : 'wrong', match };
    }
    default:
      return { status: 'pending', match: false };
  }
}

/**
 * Deterministic score for a single submission.
 *
 *   correct -> basePoints (linearly decaying with time when the task uses
 *              dynamic scoring; floored at 10% of basePoints)
 *   wrong   -> -(task penalty + event penalty)
 *   pending -> 0
 *
 * The returned value is what a submission contributes to the leaderboard.
 */
function computeScore({ task, event, submittedAt, status }) {
  if (!task) return 0;
  if (status === 'pending') return 0;
  if (status === 'wrong') {
    return -((task.wrongSubmissionPenalty || 0) + ((event && event.wrongSubmissionPenalty) || 0));
  }

  let score = task.basePoints || 0;
  if (task.isDynamicScore && submittedAt) {
    const start = (event && event.startDate) ? new Date(event.startDate) : null;
    const elapsedMinutes = start ? (new Date(submittedAt).getTime() - start.getTime()) / 60000 : 0;
    const decay = task.decayPercentage || 0;
    if (elapsedMinutes > 0 && decay > 0) {
      const penalty = score * (decay / 100) * elapsedMinutes;
      score = Math.max(score * 0.1, score - penalty);
    }
  }
  return Math.round(score);
}

module.exports = { evaluateSubmissionContent, computeScore, AUTO_EVALUABLE_TYPES };
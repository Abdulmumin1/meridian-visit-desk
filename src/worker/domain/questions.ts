import { logActivity } from "../lib/activity";
import { newQuestionId } from "../lib/ids";
import { ToolError, type Ctx, type QuestionRow } from "./context";
import { resolveListing } from "./listings";

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** R1 / J1: record a question the listing data cannot answer, for the coordinator's queue. */
export async function logUnanswered(ctx: Ctx, input: { listing_id: string; question: string }) {
  const question = (input.question ?? "").trim();
  if (question.length < 3) throw new ToolError("INVALID_INPUT", "question is required");
  if (question.length > 500) throw new ToolError("INVALID_INPUT", "question must be under 500 characters");
  const listing = await resolveListing(ctx.db, input.listing_id);
  const now = ctx.now();

  // The same gap asked twice is one item for the coordinator, not two.
  const open = await ctx.db
    .prepare("SELECT * FROM unanswered_questions WHERE listing_id = ? AND status = 'open'")
    .bind(listing.id)
    .all<QuestionRow>();
  const dupe = open.results.find((q) => normalise(q.question) === normalise(question));
  if (dupe) {
    return {
      question_id: dupe.id,
      status: "already_logged",
      listing: listing.title,
      message: "This question is already in the agency's queue. Tell the buyer the agency will confirm, and they can ask again later.",
    };
  }

  const id = newQuestionId();
  await ctx.db
    .prepare("INSERT INTO unanswered_questions (id, listing_id, question, asked_at, status) VALUES (?, ?, ?, ?, 'open')")
    .bind(id, listing.id, question, now)
    .run();
  await logActivity(ctx.db, now, { source: "agent", action: "question.logged", summary: `New question on ${listing.title}: "${question}"`, listingId: listing.id });
  return {
    question_id: id,
    status: "logged",
    listing: listing.title,
    message: "Logged for the agency. Tell the buyer the agency will confirm, and that if they ask again later you'll have the answer once it's added.",
  };
}

export async function answerQuestion(ctx: Ctx, id: string, answer: string) {
  const text = (answer ?? "").trim();
  if (!text) throw new ToolError("INVALID_INPUT", "answer is required");
  const q = await ctx.db.prepare("SELECT * FROM unanswered_questions WHERE id = ?").bind(id).first<QuestionRow>();
  if (!q) throw new ToolError("NOT_FOUND", "No such question", 404);
  const now = ctx.now();
  await ctx.db
    .prepare("UPDATE unanswered_questions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?")
    .bind(text, now, id)
    .run();
  await logActivity(ctx.db, now, { source: "console", action: "question.answered", summary: `Answered "${q.question}": ${text}`, listingId: q.listing_id });
  return { ...q, status: "answered" as const, answer: text, answered_at: now };
}

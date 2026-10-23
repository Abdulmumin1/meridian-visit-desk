import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Empty, PageTitle, Skeleton, Tabs } from "../components/ui";
import { api, type Question } from "../lib/api";
import { ago } from "../lib/format";
import { useNow } from "../lib/router";

export function QuestionsPage() {
  const now = useNow(15_000);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const q = useQuery({ queryKey: ["questions"], queryFn: () => api<{ questions: Question[] }>("/questions"), refetchInterval: 5000 });
  const open = useMemo(() => q.data?.questions.filter((x) => x.status === "open") ?? [], [q.data]);
  const answered = useMemo(() => q.data?.questions.filter((x) => x.status === "answered") ?? [], [q.data]);

  return (
    <>
      <PageTitle title="Questions">Asked by buyers, not in your listing data. Answers reach the agent immediately.</PageTitle>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "open", label: "To answer", count: open.length },
          { value: "answered", label: "Answered" },
        ]}
      />
      {!q.data ? (
        <Skeleton className="mt-6 h-32" />
      ) : tab === "open" ? (
        open.length === 0 ? (
          <Empty>All caught up.</Empty>
        ) : (
          <ul>
            {open.map((item) => (
              <OpenQuestion key={item.id} q={item} now={now} />
            ))}
          </ul>
        )
      ) : answered.length === 0 ? (
        <Empty>No answers yet.</Empty>
      ) : (
        <ul>
          {answered.map((item) => (
            <li key={item.id} className="border-t border-line py-4 first:border-t-0">
              <div className="text-[12.5px] text-muted">{item.listing_title}</div>
              <div className="mt-0.5 text-[14px]">{item.question}</div>
              <div className="mt-1 text-[13.5px] text-muted">{item.answer}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function OpenQuestion({ q, now }: { q: Question; now: number }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState("");
  const publish = useMutation({
    mutationFn: () => api(`/questions/${q.id}/answer`, { method: "POST", json: { answer } }),
    onSuccess: () => {
      toast("Answer saved. The agent will use it from the next message.");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li className="border-t border-line py-5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-4 text-[12.5px] text-muted">
        <span>{q.listing_title}</span>
        <span>{ago(q.asked_at, now)}</span>
      </div>
      <div className="mt-1 text-[15px]">{q.question}</div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) publish.mutate();
        }}
      >
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Write the answer as a fact"
          className="h-8 flex-1 rounded-md border border-line px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-ink"
        />
        <Button type="submit" variant="primary" loading={publish.isPending} disabled={!answer.trim()}>
          Save
        </Button>
      </form>
    </li>
  );
}

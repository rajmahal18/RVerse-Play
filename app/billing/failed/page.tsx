import { Button, Pill, Section } from "@/components/ui";

export default function BillingFailedPage() {
  return (
    <main className="mx-auto max-w-2xl px-3 py-8 sm:px-6">
      <Section title="Payment Not Completed" action={<Pill tone="amber">Retry anytime</Pill>}>
        <div className="space-y-3 text-sm text-slate-600">
          <div>No credits were added.</div>
          <div className="flex flex-wrap gap-2">
            <a href="/billing/upgrade"><Button>Try again</Button></a>
            <a href="/"><Button variant="soft">Back to sessions</Button></a>
          </div>
        </div>
      </Section>
    </main>
  );
}

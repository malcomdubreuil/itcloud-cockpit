import { MoneyInput } from "@/components/money-input";
import { InlineTextInput } from "@/components/inline-text-input";
import { TaskPeriodSelect } from "@/components/task-period-select";
import { TaskDateInput } from "@/components/task-date-input";
import { TaskActions } from "@/components/task-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  URGENCY_BORDER,
  URGENCY_TEXT,
  daysUntil,
  taskUrgency,
  yearlyRevenue,
} from "@/lib/taches";
import {
  updateTaskNotes,
  updateTaskPrice,
  updateTaskQbInvoiceNo,
  updateTaskTitle,
} from "@/app/(dashboard)/taches/actions";

// Carte d'une tâche récurrente. Même esprit que la carte de service : bande de
// couleur selon l'urgence (ici proportionnelle à la période), champs éditables
// en ligne, et le bouton « Facturer » qui duplique la facture QuickBooks.

const cad = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
});

export type TaskCardData = {
  id: string;
  title: string;
  price: number;
  periodDays: number;
  nextDueDate: Date | null;
  lastQbInvoiceNo: string | null;
  notes: string | null;
  active: boolean;
  client: { id: string; companyName: string };
};

export function TaskCard({ task: t }: { task: TaskCardData }) {
  const urgency = taskUrgency(t.nextDueDate, t.periodDays, t.active);
  const days = t.nextDueDate ? daysUntil(t.nextDueDate) : null;
  const yearly = yearlyRevenue(t.price, t.periodDays);
  // Note remplie = à prendre en compte à la prochaine facture (mise en évidence).
  const hasNote = !!t.notes?.trim();

  return (
    <Card
      className={cn(
        "border-l-4 py-3",
        urgency ? URGENCY_BORDER[urgency] : "border-l-transparent",
        !t.active && "opacity-60",
      )}
    >
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <div className="min-w-0 flex-1 basis-64">
          <p className="truncate font-medium">{t.client.companyName}</p>
          <InlineTextInput
            id={t.id}
            value={t.title}
            action={updateTaskTitle}
            label="Titre de la tâche"
            placeholder="titre…"
            copyButton={false}
            className="mt-0.5 w-full"
            inputClassName="w-full min-w-48 text-sm"
          />

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TaskPeriodSelect taskId={t.id} periodDays={t.periodDays} />
            {!t.active && <Badge variant="secondary">En pause</Badge>}
            <TaskDateInput
              taskId={t.id}
              value={t.nextDueDate ? t.nextDueDate.toISOString().slice(0, 10) : null}
              days={days}
              daysClassName={urgency ? URGENCY_TEXT[urgency] : "text-muted-foreground"}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Fact. QuickBooks
              <InlineTextInput
                id={t.id}
                value={t.lastQbInvoiceNo ?? ""}
                action={updateTaskQbInvoiceNo}
                label="N° facture QuickBooks"
                placeholder="n° facture"
              />
            </span>
            <span className="inline-flex min-w-0 flex-1 basis-52 items-center gap-1.5 text-xs text-muted-foreground">
              {hasNote ? (
                <span className="font-medium text-amber-600 dark:text-amber-400">Note</span>
              ) : (
                "Note"
              )}
              <InlineTextInput
                id={t.id}
                value={t.notes ?? ""}
                action={updateTaskNotes}
                label="Note de la tâche"
                placeholder="note…"
                copyButton={false}
                className="min-w-0 flex-1"
                inputClassName={cn("w-full min-w-32", hasNote && "note-breathe")}
              />
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Prix / occurrence</p>
            <MoneyInput
              id={t.id}
              value={t.price}
              action={updateTaskPrice}
              label="Prix par occurrence"
            />
          </div>
          <div className="w-28 text-right">
            <p className="text-xs text-muted-foreground">Équivaut à</p>
            <p className="tabular-nums font-medium">{cad.format(yearly)}/an</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {cad.format(yearly / 12)}/mois
            </p>
          </div>

          <TaskActions
            taskId={t.id}
            title={t.title}
            clientName={t.client.companyName}
            active={t.active}
            qbInvoiceNo={t.lastQbInvoiceNo}
          />
        </div>
      </CardContent>
    </Card>
  );
}

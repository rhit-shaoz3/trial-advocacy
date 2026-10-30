import { useState } from "react";
import { AlertTriangle, FileText, ScrollText } from "lucide-react";
import { DictationTextarea } from "../../components/Dictation";
import { FileViewer } from "../../components/FileViewer";
import { Modal } from "../../components/Modal";
import { SubpoenaForm } from "../../components/SubpoenaForm";
import { useCourseService } from "../../courses/CourseServiceContext";
import { SUBPOENA_TYPE_LABEL } from "../../courses/subpoenaForm";
import type {
  CaseMaterial,
  CourseSubpoena,
  ProducedDocument,
} from "../../courses/types";
import { ROLE_LABEL, worldLabel } from "../../courses/worldLabel";
import { CheckSummary } from "../../components/CheckSummary";

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const FLAG_TEXT = {
  quash: "The AI thinks a court would likely quash this subpoena.",
  modify:
    "The AI thinks a court would likely modify this subpoena (narrow it, or attach conditions).",
} as const;

/**
 * A subpoena a team served, with the AI's draft of the recipient's response
 * for the instructor to review. When the draft produces existing case files,
 * the instructor sends those, denies the subpoena, or asks for a new file
 * instead; otherwise they edit and send the draft, deny it, or have it
 * redrafted. Once answered, it shows what the team got.
 */
export function SubpoenaCard({
  courseId,
  subpoena,
  onAnswer,
  onChange,
  now = new Date(),
}: {
  courseId: string;
  subpoena: CourseSubpoena;
  /** Called with the answered subpoena; the page moves it to Completed. */
  onAnswer?(answered: CourseSubpoena): void;
  /** Called when a redraft starts, so the page can check back for it. */
  onChange?(updated: CourseSubpoena): void;
  now?: Date;
}) {
  const service = useCourseService();
  const s = subpoena;
  const team = `Team ${s.teamNumber}`;
  const answered = s.respondedAt !== null;
  const [draft, setDraft] = useState(s.draft ?? "");
  const [draftFor, setDraftFor] = useState(s.draft);
  const [dialog, setDialog] = useState<"deny" | "redraft" | null>(null);
  const [viewing, setViewing] = useState<CaseMaterial | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new draft replaces whatever was being edited.
  if (s.draft !== draftFor) {
    setDraftFor(s.draft);
    setDraft(s.draft ?? "");
  }

  async function act(
    run: () => Promise<CourseSubpoena>,
    done: (updated: CourseSubpoena) => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      const updated = await run();
      setDialog(null);
      done(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    act(
      () => service.approveSubpoena(courseId, s.id, draft),
      (u) => onAnswer?.(u),
    );
  const deny = (note: string) =>
    act(
      () => service.denySubpoena(courseId, s.id, note),
      (u) => onAnswer?.(u),
    );
  const redraft = (instructions: string, createNew: boolean) =>
    act(
      () =>
        service.redraftSubpoena(courseId, s.id, { instructions, createNew }),
      (u) => onChange?.(u),
    );

  async function open(doc: ProducedDocument) {
    try {
      const files = await service.listMaterials(courseId, s.caseId);
      const file = files.find((f) => f.id === doc.materialId);
      if (file) setViewing(file);
      else setError(`${doc.title} is no longer in the case file.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the file.");
    }
  }

  const overdue = !answered && new Date(s.dueAt) < now;
  const usesExisting = s.existing.length > 0;

  return (
    <article className="review-card" aria-labelledby={`subpoena-${s.id}`}>
      <header className="review-card-header">
        <span
          className="ws-icon-tile ws-tone-amber review-subpoena-icon"
          aria-hidden="true"
        >
          <ScrollText />
        </span>
        <div className="review-card-title">
          <span className="ws-eyebrow">
            {s.caseTitle} · {SUBPOENA_TYPE_LABEL[s.requestType]}
          </span>
          <h2 id={`subpoena-${s.id}`}>Subpoena to {s.recipient}</h2>
          <p className="review-meta">
            World {worldLabel(s.worldNumber)} · {ROLE_LABEL[s.side]} · {team}
            {s.team.length > 0 && ` (${s.team.join(", ")})`}
          </p>
        </div>
        <small className={overdue ? "review-overdue" : "muted"}>
          {answered && s.respondedAt
            ? `Answered ${dateTime(s.respondedAt)}`
            : `Served ${day(s.sentAt)} · ${overdue ? "overdue since" : "due"} ${day(s.dueAt)}`}
        </small>
      </header>

      <details className="review-subpoena-form-view">
        <summary>The subpoena {team} served</summary>
        {s.recipientDescription && (
          <p className="muted">
            <strong>Who they are:</strong> {s.recipientDescription}
          </p>
        )}
        <SubpoenaForm
          caseId={s.caseId}
          parties={s.parties}
          side={s.side}
          firm={s.firm}
          attorney={s.sentBy}
          recipient={s.recipient}
          requestType={s.requestType}
          records={s.records}
          servedAt={s.sentAt}
          dueAt={s.dueAt}
        />
        {s.justification && (
          <p className="review-subpoena-justification">
            <strong>Justification:</strong> {s.justification}
          </p>
        )}
      </details>
      <CheckSummary label={`${team}'s AI check before serving:`} check={s.check} />

      {answered ? (
        <div className="review-subpoena-answer">
          <span className={`badge review-subpoena-${s.outcome}`}>
            {s.outcome === "denied" ? "Denied" : "Response sent"}
          </span>
          {s.outcome === "denied" ? (
            s.response && <p>{s.response}</p>
          ) : (
            <Produced
              documents={s.documents}
              label={`Produced to ${team}`}
              onOpen={open}
            />
          )}
        </div>
      ) : s.status === "drafting" ? (
        <p className="review-note" role="status">
          Drafting {s.recipient}&rsquo;s response…
        </p>
      ) : s.status === "failed" ? (
        <div className="review-subpoena-answer">
          <p className="form-error" role="alert">
            The response couldn&rsquo;t be drafted. {s.error}
          </p>
          {onAnswer && (
            <div className="review-subpoena-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDialog("deny")}
                disabled={busy}
              >
                Deny
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => redraft(s.instructions, s.createNew)}
                disabled={busy}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        onAnswer && (
          <div className="review-subpoena-form">
            {s.flag && (
              <p className="review-warning review-subpoena-flag">
                <AlertTriangle aria-hidden="true" /> {FLAG_TEXT[s.flag]} Decide
                whether the response stands.
              </p>
            )}
            {s.unknownTitles.length > 0 && (
              <p className="review-warning">
                The draft names{" "}
                {s.unknownTitles.length === 1 ? "a file" : "files"} this case
                doesn&rsquo;t have: {s.unknownTitles.join(", ")}.
              </p>
            )}
            {usesExisting ? (
              <>
                <p className="muted">
                  {s.existing.some((d) => d.producedToTeam != null) &&
                    "This asks for what an earlier subpoena already got. "}
                  {s.recipient} would produce{" "}
                  {s.existing.length === 1 ? "a file" : "files"} already in the
                  case file. Sending shares{" "}
                  {s.existing.length === 1 ? "it" : "them"} with {team}, with
                  this response.
                </p>
                <Produced
                  documents={s.existing}
                  label="Existing case files"
                  onOpen={open}
                />
                <div className="review-subpoena-draft">
                  <span className="review-label">Response</span>
                  <p>{s.draft}</p>
                </div>
              </>
            ) : (
              <>
                {s.basedOn && (
                  <div className="review-subpoena-based">
                    <p className="muted">
                      Adapted from World {worldLabel(s.basedOn.worldNumber)}
                      &rsquo;s response to the same request, so teams asking for
                      the same thing get the same records. Compare:
                    </p>
                    <Produced documents={[s.basedOn]} label="" onOpen={open} />
                  </div>
                )}
                <label className="review-subpoena-response">
                  {s.recipient}&rsquo;s response (edit before sending)
                  <textarea
                    value={draft}
                    rows={16}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            {s.instructions && (
              <p className="muted review-subpoena-notes">
                <strong>Your notes for this draft:</strong> {s.instructions}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer className="review-subpoena-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDialog("deny")}
                disabled={busy}
              >
                Deny
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDialog("redraft")}
                disabled={busy}
              >
                {usesExisting ? "Create a new file instead" : "Regenerate"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={approve}
                disabled={busy || !draft.trim()}
              >
                {busy
                  ? "Sending…"
                  : usesExisting
                    ? s.existing.length === 1
                      ? "Respond with this file"
                      : "Respond with these files"
                    : "Approve and send"}
              </button>
            </footer>
          </div>
        )
      )}

      {dialog === "deny" && (
        <DenyDialog
          team={team}
          busy={busy}
          error={error}
          onDeny={deny}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "redraft" && (
        <RedraftDialog
          createNew={usesExisting}
          busy={busy}
          error={error}
          onSubmit={(notes) => redraft(notes, usesExisting || s.createNew)}
          onClose={() => setDialog(null)}
        />
      )}
      {viewing && (
        <FileViewer
          file={{
            id: viewing.id,
            title: viewing.description || viewing.filename,
            filename: viewing.filename,
            contentType: viewing.contentType,
            sizeBytes: viewing.sizeBytes,
          }}
          downloadUrl={service.materialDownloadUrl(
            courseId,
            s.caseId,
            viewing.id,
          )}
          loadText={async () => {
            const res = await fetch(
              service.materialTextUrl(courseId, s.caseId, viewing.id),
              { credentials: "same-origin" },
            );
            return res.ok
              ? { status: "ready", text: await res.text() }
              : { status: "none", text: null };
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </article>
  );
}

/** Case files, each opening in the viewer; an earlier subpoena response says which team it went to. */
function Produced({
  documents,
  label,
  onOpen,
}: {
  documents: (ProducedDocument & { producedToTeam?: number | null })[];
  label: string;
  onOpen(d: ProducedDocument): void;
}) {
  if (documents.length === 0) return null;
  return (
    <div className="review-subpoena-files">
      {label && <span className="review-label">{label}</span>}
      <ul>
        {documents.map((d) => (
          <li key={d.materialId}>
            <button
              type="button"
              className="review-file-chip"
              onClick={() => onOpen(d)}
            >
              <FileText aria-hidden="true" />
              {d.title}
            </button>
            {d.producedToTeam != null && (
              <small className="muted">
                {" "}
                Produced to Team {d.producedToTeam} earlier
              </small>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DenyDialog({
  team,
  busy,
  error,
  onDeny,
  onClose,
}: {
  team: string;
  busy: boolean;
  error: string | null;
  onDeny(note: string): void;
  onClose(): void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal
      eyebrow="Subpoena"
      title="Deny this subpoena?"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => onDeny(note)}
            disabled={busy}
          >
            {busy ? "Denying…" : "Deny subpoena"}
          </button>
        </>
      }
    >
      <p>
        {team} is told their subpoena was denied, and nothing is produced. It
        still counts toward their limit.
      </p>
      <label className="review-subpoena-response">
        Note to {team} (optional)
        <DictationTextarea
          value={note}
          rows={3}
          maxLength={4000}
          placeholder="Why the request is improper: overbroad, privileged, or not tied to the claims"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function RedraftDialog({
  createNew,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  /** Whether this asks for a new file rather than the existing ones. */
  createNew: boolean;
  busy: boolean;
  error: string | null;
  onSubmit(notes: string): void;
  onClose(): void;
}) {
  const [notes, setNotes] = useState("");
  return (
    <Modal
      eyebrow="Subpoena"
      title={createNew ? "Create a new file" : "Regenerate the response"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onSubmit(notes)}
            disabled={busy}
          >
            {busy ? "Starting…" : "Submit"}
          </button>
        </>
      }
    >
      <p>
        {createNew
          ? "The AI drafts a new record for this subpoena instead of producing the existing files."
          : "The AI drafts the response again."}
      </p>
      <label className="review-subpoena-response">
        What should the response look like? (optional)
        <DictationTextarea
          value={notes}
          rows={4}
          maxLength={4000}
          placeholder="What the response should produce or leave out"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

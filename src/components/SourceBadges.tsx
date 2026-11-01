import { Check, Minus, HelpCircle, History } from "lucide-react";
import { sourceState } from "../evidence";
import type { ComparisonRow } from "../evidence";
import type { EvidenceSnapshot } from "../types";
export function SourceBadges({
  row,
  snapshots,
}: {
  row: ComparisonRow;
  snapshots: EvidenceSnapshot[];
}) {
  const both = Boolean(
    row.observations.OpenAlex?.length && row.observations.IEEE?.length,
  );
  return (
    <div className="source-comparison">
      <div className="source-badges">
        {(["OpenAlex", "IEEE"] as const).map((provider) => {
          const state = sourceState(row, provider, snapshots);
          const Icon =
            state.state === "observed"
              ? state.historical
                ? History
                : Check
              : state.state === "absent"
                ? Minus
                : HelpCircle;
          return (
            <span
              key={provider}
              className={`source-badge ${state.state}`}
              title={state.detail}
              aria-label={`${provider}: ${state.text}`}
            >
              <Icon size={11} />
              {provider}
              <small>
                {state.state === "observed"
                  ? state.historical
                    ? "earlier"
                    : "observed"
                  : state.state === "absent"
                    ? "not observed"
                    : "unknown"}
              </small>
            </span>
          );
        })}
      </div>
      {both && <span className="caption">Reported by both sources</span>}
      {row.uncertain && (
        <span className="caption">
          Possible title match · kept separate for review
        </span>
      )}
    </div>
  );
}

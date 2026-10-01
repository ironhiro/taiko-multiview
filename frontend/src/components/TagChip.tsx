export const UNREGISTERED_TAG = '미등록';

/**
 * A note about the cabinet beside its label, in neutral colours only (design.md, "Tile
 * labels"): it describes the cabinet, not a state, so it never takes 돈, 카 or the venue's
 * colour. Today the only tag is 미등록, a cabinet on air that the settings do not list.
 */
export function TagChip({
  label = UNREGISTERED_TAG,
  title = '매장 설정에 아직 없는 기체입니다',
}: {
  label?: string;
  title?: string;
}) {
  return (
    <span className="tile__tag" title={title}>
      {label}
    </span>
  );
}

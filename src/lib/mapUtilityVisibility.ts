type Utility = 'services' | 'scope' | 'filters';
type StorageLike = Pick<Storage,'getItem'|'setItem'>;
const key = (utility: Utility) => `termfleet.ui.mapUtility.${utility}`;
// Services and scope start folded; the view options (sort/filter) start open and
// fold only when the operator hides them (TF-092).
const DEFAULT_COLLAPSED: Record<Utility, boolean> = { services: true, scope: true, filters: false };
export function mapUtilityCollapsed(utility: Utility, storage?: StorageLike): boolean {
  try {
    const stored = (storage ?? window.localStorage).getItem(key(utility));
    return stored === null ? DEFAULT_COLLAPSED[utility] : stored !== 'expanded';
  }
  catch { return DEFAULT_COLLAPSED[utility]; }
}
export function saveMapUtilityCollapsed(utility: Utility, collapsed: boolean, storage?: StorageLike) {
  try { (storage ?? window.localStorage).setItem(key(utility), collapsed ? 'collapsed' : 'expanded'); }
  catch { /* The deliberate choice still works for this mounted panel. */ }
}

/** Keep a CAS cash-flow estimate tied to the exact confirmed snapshot in this tab. */
function holdingFingerprint(row) {
  if (!row || typeof row.id !== 'string' || !row.id || row.entryOrigin !== 'cas') return null;
  return JSON.stringify([row.id, row.name, row.type, row.asset, row.value,
    row.asOf, row.isin || null, row.units || null]);
}

export function captureCasReturns(drafts, savedRows, previewForDraft) {
  if (!Array.isArray(drafts) || !Array.isArray(savedRows) ||
      drafts.length !== savedRows.length || typeof previewForDraft !== 'function') return [];
  return drafts.flatMap((draft, index) => {
    const saved = savedRows[index];
    const preview = previewForDraft(draft);
    const fingerprint = holdingFingerprint(saved);
    if (!fingerprint || !preview || !Number.isFinite(preview.annualPercent) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(preview.from || '') ||
        preview.to !== saved.asOf || preview.from >= preview.to ||
        draft.name !== saved.name || draft.value !== saved.value ||
        draft.asOf !== saved.asOf || draft.units !== saved.units ||
        draft.isin !== saved.isin) return [];
    return [{ id: saved.id, fingerprint, name: saved.name,
      annualPercent: preview.annualPercent, from: preview.from, to: preview.to }];
  });
}

export function currentCasReturns(records, holdings) {
  if (!Array.isArray(records) || !Array.isArray(holdings)) return [];
  const byId = new Map(holdings.map(row => [row.id, row]));
  return records.filter(record => record &&
    record.fingerprint === holdingFingerprint(byId.get(record.id)));
}

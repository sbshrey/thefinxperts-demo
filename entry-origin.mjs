export const ENTRY_ORIGINS = Object.freeze({
  manual: 'manual entry',
  active_statement: 'CAMS Active Statement',
  broker_xlsx: 'broker XLSX',
  broker_csv: 'broker CSV',
  simple_csv: 'simple CSV',
  cas: 'original mutual-fund CAS',
  demat_cas: 'demat CAS',
});

export function entryOriginFromImport(label) {
  return {
    'Active Statement': 'active_statement',
    'Broker XLSX': 'broker_xlsx',
    'Broker CSV': 'broker_csv',
    CSV: 'simple_csv',
    CAS: 'cas',
    'Demat CAS': 'demat_cas',
  }[label] || null;
}

export function entryOriginText(origin) {
  return ENTRY_ORIGINS[origin] || 'source not recorded';
}
